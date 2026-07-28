import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSessionStore } from "./session-store.js";

const member = { role: "member" as const, memberId: "member-1", memberName: "Family" };

test("persists only a session-secret hash and authenticates the opaque cookie", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-session-"));
  const store = createSessionStore({ backend: "local", localDataDir: dir });
  const issued = await store.create(member);

  const authenticated = await store.authenticate(issued.cookieValue);
  const raw = await readFile(path.join(dir, "session-state.json"), "utf8");

  assert.equal(authenticated?.subject.role, "member");
  assert.equal(authenticated?.subject.role === "member" ? authenticated.subject.memberId : undefined, "member-1");
  assert.match(raw, /secretHash/);
  assert.doesNotMatch(raw, new RegExp(issued.secret));
});

test("rejects expired and revoked sessions and revokes all sessions for a subject", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-session-"));
  let now = new Date("2026-07-14T00:00:00.000Z");
  const store = createSessionStore({
    backend: "local",
    localDataDir: dir,
    now: () => now,
    idleTtlMs: 1_000,
    absoluteTtlMs: 2_000
  });
  const first = await store.create(member);
  const second = await store.create(member);

  await store.revokeSubject(member);
  assert.equal(await store.authenticate(first.cookieValue), undefined);
  assert.equal(await store.authenticate(second.cookieValue), undefined);

  const expiring = await store.create(member);
  now = new Date("2026-07-14T00:00:03.000Z");
  assert.equal(await store.authenticate(expiring.cookieValue), undefined);
});

test("serializes concurrent local session writes without losing records or leaving temp files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-session-"));
  const store = createSessionStore({ backend: "local", localDataDir: dir });

  const issued = await Promise.all(Array.from(
    { length: 40 },
    (_, index) => store.create({
      role: "member",
      memberId: `member-${index}`,
      memberName: `Family ${index}`
    })
  ));
  const state = JSON.parse(await readFile(path.join(dir, "session-state.json"), "utf8")) as {
    sessions: Record<string, unknown>;
  };
  const files = await readdir(dir);

  assert.equal(Object.keys(state.sessions).length, issued.length);
  assert.deepEqual(files.filter((file) => file.endsWith(".tmp")), []);
});
