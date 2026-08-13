import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyPersonCatalogState, LocalPersonCatalogStore } from "@wwpdw/cache-store";
import { selectPersonBiographyTexts } from "@wwpdw/shared";
import type { NotionPeopleChange, NotionPeopleSnapshot } from "./notion-people-source.js";
import { emptyPeopleNotionSyncCheckpoint, planPeopleNotionSync, runPeopleNotionSync } from "./person-notion-sync.js";
import { getPublicPerson } from "./person-service.js";

const personId = "person_123e4567-e89b-42d3-a456-426614174000";
function catalog() {
  const state = emptyPersonCatalogState("2026-08-10T00:00:00.000Z");
  state.people[personId] = {
    profile: {
      personId,
      names: [{ value: "Old Name", language: "en", kind: "display", source: "tmdb", status: "strong", observedAt: "2026-08-01T00:00:00.000Z" }],
      externalIds: { tmdb: "1", imdb: "nm0000001" },
      departments: ["acting"],
      dataQuality: { status: "partial", updatedAt: "2026-08-01T00:00:00.000Z" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    },
    workIds: [],
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
  return state;
}

function row(overrides: Partial<NotionPeopleSnapshot> = {}): NotionPeopleSnapshot {
  return {
    pageId: "notion-page-a",
    lastEditedTime: "2026-08-10T01:00:00.000Z",
    archived: false,
    personId,
    name: "梁朝伟",
    chineseName: "梁朝伟",
    englishName: "Tony Leung",
    aliases: ["梁家辉不是此人"],
    externalIds: { tmdb: "1", imdb: "nm0000001" },
    primaryDepartments: ["acting", "directing"],
    biographyZh: "人工中文小传",
    biographyZhStatus: "verified",
    biographyZhMethod: "editorial-rewrite",
    biographyEnStatus: "verified",
    biographyEnMethod: "editorial-rewrite",
    sources: "douban:celebrity-1; wikidata:Q1",
    biographyEn: "Editorial English biography",
    profileUrl: "https://example.test/person.jpg",
    lockedFields: ["chineseName", "biographyZh", "biographyEn"],
    hideFromWebsite: false,
    nameStatus: "verified",
    dataStatus: "verified",
    ...overrides
  };
}

test("applies safe editorial fields and rebuilds aliases without changing identity", () => {
  const plan = planPeopleNotionSync(catalog(), [row()], "2026-08-10T02:00:00.000Z");
  const profile = plan.nextCatalog.people[personId].profile;
  assert.equal(plan.summary.applied, 1);
  assert.equal(profile.externalIds?.tmdb, "1");
  assert.deepEqual(selectPersonBiographyTexts(profile.biography), {
    chinese: "人工中文小传",
    english: "Editorial English biography",
    fallback: "人工中文小传"
  });
  assert.equal(profile.hiddenFromWebsite, false);
  const chineseBiography = profile.biography?.texts?.find((entry) => entry.language === "zh-CN");
  assert.equal(chineseBiography?.method, "editorial-rewrite");
  assert.deepEqual(chineseBiography?.supportingSourceRefs, ["douban:celebrity-1", "wikidata:Q1"]);
  assert.ok(plan.nextCatalog.aliasIndex["梁朝伟"].includes(personId));
  assert.ok(plan.nextCatalog.aliasIndex.tonyleung.includes(personId));
});

test("downgrades a claimed verified Chinese biography until cross-source rewrite evidence is complete", () => {
  const plan = planPeopleNotionSync(catalog(), [row({
    biographyZhMethod: "source-excerpt",
    biographyEnStatus: "partial",
    sources: "douban:celebrity-1"
  })]);
  const profile = plan.nextCatalog.people[personId].profile;
  const chineseBiography = profile.biography?.texts?.find((entry) => entry.language === "zh-CN");
  assert.equal(profile.dataQuality.status, "verified");
  assert.equal(chineseBiography?.status, "provisional");
  assert.equal(plan.summary.issueCount, 1);
  assert.equal(plan.nextCatalog.issues[0].kind, "biography_verification_incomplete");
});

test("replaces an identical collected biography with the audited Notion version", () => {
  const current = catalog();
  current.people[personId].profile.biography = {
    texts: [{
      value: "人工中文小传",
      language: "zh-CN",
      source: "manual",
      status: "verified",
      observedAt: "2026-08-09T00:00:00.000Z"
    }]
  };
  const plan = planPeopleNotionSync(current, [row()]);
  const matches = plan.nextCatalog.people[personId].profile.biography?.texts?.filter((entry) => entry.language === "zh-CN" && entry.value === "人工中文小传") ?? [];
  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, "notion");
});

test("quarantines external identity changes while publishing a review issue", () => {
  const plan = planPeopleNotionSync(catalog(), [row({ externalIds: { tmdb: "2", imdb: "nm0000001" }, chineseName: "不应应用" })]);
  assert.equal(plan.summary.quarantined, 1);
  assert.equal(plan.nextCatalog.people[personId].profile.names.some((name) => name.value === "不应应用"), false);
  assert.equal(plan.nextCatalog.issues[0].kind, "notion_identity_conflict");
  assert.equal(plan.nextCatalog.issues[0].notionPageId, "notion-page-a");
});

test("quarantines a second Notion page bound to an already synced Person ID", () => {
  const current = catalog();
  current.people[personId].profile.sourceRefs = [{ source: "notion", id: "original-page", observedAt: "2026-08-09T00:00:00.000Z" }];
  const plan = planPeopleNotionSync(current, [row({ pageId: "duplicate-page" })]);
  assert.equal(plan.summary.quarantined, 1);
  assert.match(plan.nextCatalog.issues[0].message, /different Notion row/);
});

test("unknown, duplicate, and malformed rows never create identities", () => {
  const changes: NotionPeopleChange[] = [
    row({ pageId: "one", personId: "unknown" }),
    row({ pageId: "two" }),
    row({ pageId: "three" }),
    { pageId: "bad", lastEditedTime: "2026-08-10T01:00:00.000Z", archived: false, error: "missing Person ID" }
  ];
  const plan = planPeopleNotionSync(catalog(), changes);
  assert.equal(Object.keys(plan.nextCatalog.people).length, 1);
  assert.equal(plan.summary.invalid, 1);
  assert.equal(plan.summary.quarantined, 2);
  assert.equal(plan.summary.issueCount, 4);
});

test("incremental runner advances checkpoint only after successful publish and replays unchanged", async () => {
  let state = catalog();
  let writes = 0;
  let persisted = 0;
  const checkpoint = emptyPeopleNotionSyncCheckpoint();
  const source = { async listChanged() { return [row()]; } };
  const store = {
    description: "fake",
    async getState() { return structuredClone(state); },
    async replaceState(next: typeof state) { writes += 1; state = structuredClone(next); }
  };
  const now = () => new Date("2026-08-10T02:00:00.000Z");
  const first = await runPeopleNotionSync({ source, store, checkpoint, apply: true, now, persistCheckpoint: async () => { persisted += 1; } });
  const second = await runPeopleNotionSync({ source, store, checkpoint, apply: true, now, persistCheckpoint: async () => { persisted += 1; } });
  assert.equal(first.catalogChanged, true);
  assert.equal(second.catalogChanged, false);
  assert.equal(writes, 1);
  assert.equal(persisted, 2);
  assert.equal(checkpoint.lastSuccessfulSyncAt, "2026-08-10T02:00:00.000Z");
});

test("dry-run never writes catalog or checkpoint", async () => {
  let writes = 0;
  const result = await runPeopleNotionSync({
    source: { async listChanged() { return [row()]; } },
    store: { description: "fake", async getState() { return catalog(); }, async replaceState() { writes += 1; } },
    checkpoint: emptyPeopleNotionSyncCheckpoint(),
    apply: false,
    persistCheckpoint: async () => { writes += 1; }
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(writes, 0);
});

test("failed catalog publication never advances the successful checkpoint", async () => {
  let checkpoints = 0;
  const checkpoint = emptyPeopleNotionSyncCheckpoint();
  await assert.rejects(() => runPeopleNotionSync({
    source: { async listChanged() { return [row()]; } },
    store: { description: "fake", async getState() { return catalog(); }, async replaceState() { throw new Error("publish failed"); } },
    checkpoint,
    apply: true,
    persistCheckpoint: async () => { checkpoints += 1; }
  }), /publish failed/);
  assert.equal(checkpoints, 0);
  assert.equal(checkpoint.lastSuccessfulSyncAt, undefined);
});

test("failed downstream publication never advances the successful checkpoint", async () => {
  const checkpoint = emptyPeopleNotionSyncCheckpoint();
  await assert.rejects(() => runPeopleNotionSync({
    source: { async listChanged() { return [row()]; } },
    store: { description: "fake", async getState() { return catalog(); }, async replaceState() {} },
    checkpoint,
    apply: true,
    beforeCheckpoint: async () => { throw new Error("search index failed"); }
  }), /search index failed/);
  assert.deepEqual(checkpoint, { schemaVersion: 1 });
});

test("a Notion editorial change reaches the persisted website read model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wwpdw-people-notion-sync-"));
  try {
    const store = new LocalPersonCatalogStore(path.join(directory, "person-catalog.json"));
    await store.replaceState(catalog());
    await runPeopleNotionSync({
      source: { async listChanged() { return [row()]; } },
      store,
      checkpoint: emptyPeopleNotionSyncCheckpoint(),
      apply: true
    });
    const persisted = await store.getState();
    const person = getPublicPerson(persisted, personId);
    assert.equal(person?.names.primary, "梁朝伟");
    assert.equal(person?.names.english, "Tony Leung");
    assert.equal(selectPersonBiographyTexts(person?.biography).chinese, "人工中文小传");
    assert.equal(selectPersonBiographyTexts(person?.biography).english, "Editorial English biography");
  } finally {
    const expectedPrefix = path.join(os.tmpdir(), "wwpdw-people-notion-sync-");
    if (!path.resolve(directory).startsWith(path.resolve(expectedPrefix))) throw new Error(`Unexpected test cleanup path: ${directory}`);
    await rm(directory, { recursive: true, force: true });
  }
});
