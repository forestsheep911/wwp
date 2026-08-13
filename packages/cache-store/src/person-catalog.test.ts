import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MovieWorkProfile, PersonProfile } from "@wwpdw/shared";

import {
  buildPersonCatalogFromWorks,
  LocalPersonCatalogStore,
  mergePersonCatalogEntries,
  resolvePersonId
} from "./person-catalog.js";

const generatedAt = "2026-08-10T00:00:00.000Z";

function profile(overrides: Partial<PersonProfile> = {}): PersonProfile {
  return {
    personId: "person-a",
    names: [{
      value: "梁朝伟",
      language: "zh-hans",
      script: "Hans",
      kind: "display",
      source: "wikidata",
      status: "verified",
      observedAt: generatedAt
    }],
    externalIds: { tmdb: "1337", imdb: "nm0504897" },
    dataQuality: { status: "verified", updatedAt: generatedAt },
    createdAt: generatedAt,
    updatedAt: generatedAt,
    ...overrides
  };
}

function work(overrides: Partial<MovieWorkProfile> = {}): MovieWorkProfile {
  return {
    workId: "work-a",
    kind: "movie",
    titles: [{ title: "花样年华", kind: "primary", source: "notion" }],
    credits: [
      { personId: "person-a", name: "梁朝伟", department: "acting", job: "Actor", character: "周慕云", order: 0, source: "tmdb" },
      { personId: "person-a", name: "梁朝伟", department: "production", job: "Producer", order: 8, source: "tmdb" },
      { name: "未确认演员", department: "acting", order: 9, source: "notion" }
    ],
    display: { title: "花样年华" },
    updatedAt: generatedAt,
    ...overrides
  };
}

test("builds exact external-id, alias, and bidirectional credit indexes", () => {
  const { state, summary } = buildPersonCatalogFromWorks([work()], [profile()], { generatedAt });

  assert.equal(state.externalIdIndex.tmdb["1337"], "person-a");
  assert.equal(state.externalIdIndex.imdb.nm0504897, "person-a");
  assert.deepEqual(state.aliasIndex["梁朝伟"], ["person-a"]);
  assert.equal(state.creditsByWorkId["work-a"].length, 2);
  assert.equal(state.creditsByPersonId["person-a"].length, 2);
  assert.deepEqual(state.people["person-a"].workIds, ["work-a"]);
  assert.deepEqual(summary, {
    workCount: 1,
    personCount: 1,
    linkedCreditCount: 2,
    unresolvedCreditCount: 1,
    issueCount: 1
  });
});

test("billing order updates do not create duplicate relationships", () => {
  const duplicateOrderWork = work({
    credits: [
      { personId: "person-a", name: "梁朝伟", department: "acting", job: "Actor", character: "周慕云", order: 8, source: "tmdb" },
      { personId: "person-a", name: "梁朝伟", department: "acting", job: "Actor", character: "周慕云", order: 0, source: "tmdb" }
    ]
  });
  const { state } = buildPersonCatalogFromWorks([duplicateOrderWork], [profile()], { generatedAt });

  assert.equal(state.creditsByWorkId["work-a"].length, 1);
  assert.equal(state.creditsByWorkId["work-a"][0].order, 0);
});

test("same aliases stay ambiguous while conflicting stable ids become issues", () => {
  const second = profile({ personId: "person-b", externalIds: { tmdb: "1337" } });
  const { state } = buildPersonCatalogFromWorks([], [profile(), second], { generatedAt });

  assert.deepEqual(state.aliasIndex["梁朝伟"], ["person-a", "person-b"]);
  assert.equal(state.externalIdIndex.tmdb["1337"], "person-a");
  assert.equal(state.issues[0].kind, "external_id_conflict");
});

test("a linked credit cannot silently replace a conflicting person id", () => {
  const conflictingWork = work({
    credits: [{
      personId: "person-a",
      name: "梁朝伟",
      department: "acting",
      externalIds: { tmdb: "9999" }
    }]
  });
  const { state } = buildPersonCatalogFromWorks([conflictingWork], [profile()], { generatedAt });

  assert.equal(state.people["person-a"].profile.externalIds?.tmdb, "1337");
  assert.equal(state.issues[0].kind, "external_id_conflict");
  assert.equal(state.issues[0].externalId?.id, "9999");
});

test("pure rebuild never allocates ids for unresolved credits", () => {
  const { state } = buildPersonCatalogFromWorks([work({ credits: [{ name: "同名演员", department: "acting" }] })], [], { generatedAt });

  assert.deepEqual(state.people, {});
  assert.equal(state.issues[0].kind, "unresolved_credit");
});

test("rebuild is deterministic for an already assigned identity state", () => {
  const first = buildPersonCatalogFromWorks([work()], [profile()], { generatedAt }).state;
  const second = buildPersonCatalogFromWorks([work()], [profile()], { generatedAt }).state;
  assert.deepEqual(second, first);
});

test("local store atomically persists and reloads person catalog state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wwpdw-people-"));
  const statePath = path.join(directory, "person-catalog.json");
  try {
    const store = new LocalPersonCatalogStore(statePath);
    const { state } = buildPersonCatalogFromWorks([work()], [profile()], { generatedAt });
    await store.replaceState(state);
    assert.deepEqual(await store.getState(), state);
    assert.match(await readFile(statePath, "utf8"), /"schemaVersion": 1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local store rejects an unknown person catalog schema", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wwpdw-people-schema-"));
  const statePath = path.join(directory, "person-catalog.json");
  try {
    await writeFile(statePath, JSON.stringify({ schemaVersion: 99 }), "utf8");
    const store = new LocalPersonCatalogStore(statePath);
    await assert.rejects(() => store.getState(), /Unsupported person catalog schema version: 99/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("guarded merge redirects the retired person and rewrites both credit indexes", () => {
  const second = profile({
    personId: "person-b",
    names: [{
      value: "Tony Leung Chiu-wai",
      language: "en",
      script: "Latn",
      kind: "display",
      source: "imdb",
      status: "verified",
      observedAt: generatedAt
    }],
    externalIds: { imdb: "nm0504897" }
  });
  const secondWork = work({
    workId: "work-b",
    titles: [{ title: "2046", kind: "primary", source: "notion" }],
    display: { title: "2046" },
    credits: [{ personId: "person-b", name: "Tony Leung Chiu-wai", department: "acting", character: "周慕云" }]
  });
  const initial = buildPersonCatalogFromWorks([work(), secondWork], [profile({ externalIds: { tmdb: "1337" } }), second], { generatedAt }).state;
  const merged = mergePersonCatalogEntries(initial, "person-a", "person-b");

  assert.equal(resolvePersonId(merged, "person-b"), "person-a");
  assert.equal(merged.people["person-b"], undefined);
  assert.deepEqual(merged.people["person-a"].workIds, ["work-a", "work-b"]);
  assert.equal(merged.externalIdIndex.imdb.nm0504897, "person-a");
  assert.equal(merged.creditsByWorkId["work-b"][0].personId, "person-a");
  assert.equal(merged.creditsByPersonId["person-a"].length, 3);
  assert.equal(merged.creditsByPersonId["person-a"].find((credit) => credit.workId === "work-b")?.workTitle, "2046");
});

test("guarded merge rejects conflicting ids in the same namespace", () => {
  const second = profile({ personId: "person-b", externalIds: { tmdb: "9999" } });
  const initial = buildPersonCatalogFromWorks([], [profile(), second], { generatedAt }).state;
  assert.throws(
    () => mergePersonCatalogEntries(initial, "person-a", "person-b"),
    /Cannot merge people with conflicting tmdb IDs/
  );
});
