import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireProductionLock } from "./wwp-production-lock.mjs";

test("production lock excludes a second live owner and releases cleanly", () => {
  const lockPath = path.join(mkdtempSync(path.join(tmpdir(), "wwp-lock-")), "network.lock");
  const first = acquireProductionLock({ lockPath, owner: "film", mode: "film-only" });
  assert.throws(() => acquireProductionLock({ lockPath, owner: "people", mode: "people-only" }), /owner=film/);
  first.release();
  const second = acquireProductionLock({ lockPath, owner: "people", mode: "people-only" });
  second.release();
});

test("production lock replaces a stale owner", () => {
  const lockPath = path.join(mkdtempSync(path.join(tmpdir(), "wwp-lock-")), "network.lock");
  writeFileSync(lockPath, JSON.stringify({ owner: "stale", mode: "people-only", pid: 99999999 }));
  const lock = acquireProductionLock({ lockPath, owner: "film", mode: "film-only" });
  assert.equal(lock.record.owner, "film");
  lock.release();
});
