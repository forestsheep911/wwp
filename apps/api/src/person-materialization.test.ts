import assert from "node:assert/strict";
import test from "node:test";
import { emptyPersonCatalogState } from "@wwpdw/cache-store";

import { materializePersonEvidence } from "./person-materialization.js";

const observedAt = "2026-08-10T00:00:00.000Z";

test("allocates one stable identity and links every role credit to it", () => {
  const result = materializePersonEvidence({
    state: emptyPersonCatalogState(observedAt),
    evidence: [{
      externalIds: { tmdb: "1337", imdb: "nm0504897", wikidata: "Q104049" },
      names: [{ value: "梁朝伟", language: "zh-cn", kind: "display", source: "wikidata", status: "strong", observedAt }],
      sourceRefs: [{ source: "wikidata", id: "Q104049", observedAt }],
      observedAt
    }],
    workCredits: [{ workId: "work-a", title: "A", credits: [
      { name: "Tony Leung", department: "acting", job: "Actor", externalIds: { tmdb: "1337" } },
      { name: "Tony Leung", department: "production", job: "Producer", externalIds: { tmdb: "1337" } }
    ] }],
    allocatePersonId: () => "person-new",
    now: observedAt
  });
  assert.equal(result.profiles.length, 1);
  assert.deepEqual(result.creditReplacements[0].credits.map((credit) => credit.personId), ["person-new", "person-new"]);
  assert.deepEqual(result.profiles[0].departments, ["acting", "production"]);
  assert.equal(result.unresolved.length, 0);
});

test("reuses existing stable IDs and preserves a locked English biography", () => {
  const state = emptyPersonCatalogState(observedAt);
  state.people["person-existing"] = {
    profile: {
      personId: "person-existing",
      names: [{ value: "Existing", language: "en", kind: "display", source: "manual", status: "verified", observedAt }],
      externalIds: { imdb: "nm0504897" },
      biography: { texts: [{ value: "Editor text", language: "en", source: "manual", status: "verified", observedAt }] },
      lockedFields: ["biographyEn"],
      dataQuality: { status: "verified", updatedAt: observedAt },
      createdAt: observedAt,
      updatedAt: observedAt
    },
    workIds: [],
    updatedAt: observedAt
  };
  state.externalIdIndex.imdb.nm0504897 = "person-existing";
  const result = materializePersonEvidence({
    state,
    evidence: [{
      externalIds: { tmdb: "1337", imdb: "nm0504897" },
      names: [{ value: "Tony Leung", language: "en", kind: "alternate", source: "tmdb", status: "strong", observedAt }],
      biography: { texts: [{ value: "Provider text", language: "en", source: "tmdb", status: "strong", observedAt }] },
      sourceRefs: [],
      observedAt
    }],
    workCredits: [],
    allocatePersonId: () => { throw new Error("must not allocate"); },
    now: observedAt
  });
  assert.equal(result.profiles[0].personId, "person-existing");
  assert.deepEqual(result.profiles[0].biography?.texts?.map((entry) => entry.value), ["Editor text"]);
  assert.equal(result.assignments["tmdb:1337"], "person-existing");
});

test("locks Chinese and English biography evidence independently", () => {
  const state = emptyPersonCatalogState(observedAt);
  state.people["person-existing"] = {
    profile: {
      personId: "person-existing",
      names: [],
      externalIds: { tmdb: "1337" },
      biography: { texts: [{ value: "编辑中文", language: "zh-CN", source: "notion", status: "verified", observedAt }] },
      lockedFields: ["biographyZh"],
      dataQuality: { status: "partial", updatedAt: observedAt },
      createdAt: observedAt,
      updatedAt: observedAt
    },
    workIds: [],
    updatedAt: observedAt
  };
  state.externalIdIndex.tmdb["1337"] = "person-existing";
  const result = materializePersonEvidence({
    state,
    evidence: [{
      externalIds: { tmdb: "1337" },
      names: [],
      biography: { texts: [
        { value: "数据源中文", language: "zh-CN", source: "wikidata", status: "strong", observedAt },
        { value: "Provider English", language: "en", source: "tmdb", status: "strong", observedAt }
      ] },
      sourceRefs: [],
      observedAt
    }],
    workCredits: [],
    allocatePersonId: () => { throw new Error("must not allocate"); },
    now: observedAt
  });
  const texts = result.profiles[0].biography?.texts ?? [];
  assert.equal(texts.some((entry) => entry.value === "编辑中文"), true);
  assert.equal(texts.some((entry) => entry.value === "数据源中文"), false);
  assert.equal(texts.some((entry) => entry.value === "Provider English"), true);
});

test("keeps cross-namespace conflicts unresolved instead of merging", () => {
  const state = emptyPersonCatalogState(observedAt);
  for (const [personId, externalIds] of [["person-a", { tmdb: "1" }], ["person-b", { imdb: "nm0000002" }]] as const) {
    state.people[personId] = {
      profile: { personId, names: [], externalIds, dataQuality: { status: "partial", updatedAt: observedAt }, createdAt: observedAt, updatedAt: observedAt },
      workIds: [], updatedAt: observedAt
    };
  }
  const result = materializePersonEvidence({
    state,
    evidence: [{ externalIds: { tmdb: "1", imdb: "nm0000002" }, names: [], sourceRefs: [], observedAt }],
    workCredits: [],
    allocatePersonId: () => "unexpected",
    now: observedAt
  });
  assert.equal(result.profiles.length, 0);
  assert.equal(result.issues[0].kind, "external_id_conflict");
  assert.equal(result.unresolved[0].reason, "ids_match_multiple_people");
});
