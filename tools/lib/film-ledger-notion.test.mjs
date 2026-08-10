import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger } from "./film-ledger-schema.mjs";
import { createLedgerRepository } from "./film-ledger-repository.mjs";
import { createNotionTargetAdapter, reconcileDueTargets } from "./film-ledger-notion.mjs";

const NOW = "2026-07-12T00:00:00.000Z";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-notion-"));
  const db = openLedger(path.join(dir, "ledger.sqlite"));
  const repo = createLedgerRepository(db, { now: () => NOW });
  return { db, repo, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function seedTarget(repo, suffix, nextCheckAt = null) {
  const work = repo.ensureWork({ canonicalTitle: `Example ${suffix}`, year: 2025, workType: "movie" });
  const variant = repo.ensureVariant({ workId: work.id, specKey: `main-${suffix}`, displayTitle: `Example ${suffix}` });
  for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) repo.transitionProduction(variant.id, state);
  repo.transitionPublication(variant.id, "structure_pending");
  repo.registerNotionTarget(variant.id, {
    workPageId: `work-${suffix}`,
    specPageId: `spec-${suffix}`,
    episodePageId: suffix === "episode" ? `episode-${suffix}` : undefined,
    nextCheckAt
  });
  return variant;
}

function publishableAsset(overrides = {}) {
  return {
    id: "asset-1",
    properties: {
      Work: { type: "relation", relation: [{ id: "work-1" }] },
      "Source Page ID": { type: "rich_text", rich_text: [{ plain_text: "episode-1" }] },
      "Media Block ID": { type: "rich_text", rich_text: [{ plain_text: "media-1" }] },
      "Asset Type": { type: "select", select: { name: "playable_video" } },
      "Media Availability": { type: "select", select: { name: "playable" } },
      "Video Codec": { type: "select", select: { name: "hevc" } },
      Container: { type: "select", select: { name: "mp4" } },
      "Playback Verified": { type: "checkbox", checkbox: true },
      "Hide from Website": { type: "checkbox", checkbox: false },
      "Needs Review": { type: "checkbox", checkbox: false },
      ...overrides
    }
  };
}

test("reconciler checks only due recorded targets and stops at three", async () => {
  const f = fixture();
  try {
    for (const suffix of ["a", "b", "c", "d"]) seedTarget(f.repo, suffix);
    seedTarget(f.repo, "future", "2026-07-13T00:00:00.000Z");
    const visited = [];
    const adapter = { async inspectTarget(target) {
      visited.push(target.spec_page_id);
      return { structureVerified: true, mediaBlockId: null, mediaVerified: false, mediaAssetPageId: null, assetsVerified: false, evidence: {} };
    } };
    const result = await reconcileDueTargets(f.repo, adapter, { limit: 99, now: NOW });
    assert.equal(result.checked, 3);
    assert.deepEqual(visited, ["spec-a", "spec-b", "spec-c"]);
  } finally { f.close(); }
});

test("reconciler can target a bounded set of variants without scanning older due targets", async () => {
  const f = fixture();
  try {
    const old = seedTarget(f.repo, "old");
    const first = seedTarget(f.repo, "first");
    const second = seedTarget(f.repo, "second");
    const visited = [];
    const result = await reconcileDueTargets(f.repo, { async inspectTarget(target) {
      visited.push(target.variant_id);
      return { structureVerified: false, mediaVerified: false, assetsVerified: false, evidence: {} };
    } }, { now: NOW, limit: 2, variantIds: [second.id, first.id] });
    assert.equal(result.checked, 2);
    assert.deepEqual(visited.sort((a, b) => a - b), [first.id, second.id]);
    assert.equal(visited.includes(old.id), false);
  } finally { f.close(); }
});

test("explicit variant targeting bypasses that target's future retry time", async () => {
  const f = fixture();
  try {
    const future = seedTarget(f.repo, "future", "2099-01-01T00:00:00.000Z");
    let calls = 0;
    const result = await reconcileDueTargets(f.repo, { async inspectTarget(target) {
      calls += 1;
      assert.equal(target.variant_id, future.id);
      return { structureVerified: false, mediaVerified: false, assetsVerified: false, evidence: {} };
    } }, { now: NOW, limit: 1, variantIds: [future.id] });
    assert.equal(result.checked, 1);
    assert.equal(calls, 1);
  } finally { f.close(); }
});

test("429 persists a global sixty-minute breaker and force explicitly bypasses it", async () => {
  const f = fixture();
  try {
    seedTarget(f.repo, "a");
    seedTarget(f.repo, "b");
    let calls = 0;
    const adapter = { async inspectTarget() { calls += 1; throw Object.assign(new Error("rate limited"), { code: "rate_limited", status: 429 }); } };
    const result = await reconcileDueTargets(f.repo, adapter, { now: NOW });
    assert.equal(result.rateLimited, true);
    assert.equal(calls, 1);
    await assert.rejects(reconcileDueTargets(f.repo, adapter, { now: "2026-07-12T00:10:00.000Z" }), /circuit breaker open until 2026-07-12T01:00:00.000Z/);
    await reconcileDueTargets(f.repo, { async inspectTarget() { calls += 1; return { structureVerified: false, mediaVerified: false, assetsVerified: false, evidence: {} }; } },
      { now: "2026-07-12T00:10:00.000Z", forceAfter429: true, limit: 1 });
    assert.equal(calls, 2);
  } finally { f.close(); }
});

test("failed inspections mutate only retry metadata and authentication stops the batch", async () => {
  const f = fixture();
  try {
    const first = seedTarget(f.repo, "a");
    seedTarget(f.repo, "b");
    f.repo.recordNotionInspection(first.id, { structureVerified: true, mediaBlockId: "old-block", mediaVerified: true, assetsVerified: false }, NOW);
    let calls = 0;
    const result = await reconcileDueTargets(f.repo, { async inspectTarget() {
      calls += 1;
      throw Object.assign(new Error("unauthorized"), { code: "unauthorized", status: 401 });
    } }, { now: "2026-07-12T00:01:00.000Z" });
    assert.equal(result.authFailed, true);
    assert.equal(calls, 1);
    const target = f.db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(first.id);
    assert.equal(target.media_block_id, "old-block");
    assert.equal(target.media_verified_at, NOW);
    assert.equal(target.attempt_count, 1);
    assert.equal(target.next_check_at, "2026-07-12T00:06:00.000Z");
  } finally { f.close(); }
});

test("ordinary failures retry per target and continue the batch", async () => {
  const f = fixture();
  try {
    const first = seedTarget(f.repo, "a");
    const second = seedTarget(f.repo, "b");
    const visited = [];
    const result = await reconcileDueTargets(f.repo, { async inspectTarget(target) {
      visited.push(target.variant_id);
      if (target.variant_id === first.id) throw Object.assign(new Error("temporary"), { code: "service_unavailable" });
      return { structureVerified: false, mediaVerified: false, assetsVerified: false, evidence: {} };
    } }, { now: NOW, limit: 2 });
    assert.deepEqual(visited, [first.id, second.id]);
    assert.equal(result.failed, 1);
    assert.equal(result.pending, 1);
    const failed = f.db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(first.id);
    assert.equal(failed.next_check_at, "2026-07-12T00:05:00.000Z");
    assert.equal(failed.last_error_code, "service_unavailable");
  } finally { f.close(); }
});

test("all four evidence gates advance legally to sync_ready while incomplete evidence stays pending", async () => {
  const f = fixture();
  try {
    const complete = seedTarget(f.repo, "complete");
    const incomplete = seedTarget(f.repo, "incomplete");
    const adapter = { async inspectTarget(target) {
      if (target.variant_id === incomplete.id) return { structureVerified: true, mediaVerified: true, mediaBlockId: "m2", assetsVerified: false, evidence: {} };
      return { structureVerified: true, mediaVerified: true, mediaBlockId: "m1", assetsVerified: true, mediaAssetPageId: "asset-1", evidence: {} };
    } };
    await reconcileDueTargets(f.repo, adapter, { now: NOW });
    assert.equal(f.db.prepare("SELECT publication_state FROM variants WHERE id=?").get(complete.id).publication_state, "sync_ready");
    assert.equal(f.db.prepare("SELECT publication_state FROM variants WHERE id=?").get(incomplete.id).publication_state, "assets_pending");
    assert.deepEqual(f.repo.getEvents({ entityType: "variant", entityId: complete.id }).filter(event => event.event_type === "publication_state_changed").map(event => JSON.parse(event.payload_json).to),
      ["structure_pending", "upload_pending", "upload_seen", "assets_pending", "verification_pending", "sync_ready"]);
  } finally { f.close(); }
});

test("adapter uses only recorded pages and an exact Media Assets trace query", async () => {
  const calls = [];
  const client = {
    pages: { async retrieve(input) { calls.push(["pages.retrieve", input]); return { id: input.page_id, parent: input.page_id === "work-1" ? { type: "workspace", workspace: true } : { type: "page_id", page_id: input.page_id === "spec-1" ? "work-1" : "spec-1" } }; } },
    blocks: { children: { async list(input) { calls.push(["blocks.children.list", input]); return { results: [{ id: "media-1", type: "video", video: { caption: [{ plain_text: "Example.2025.mp4" }], file: { url: "https://example.test/video.mp4" } } }], has_more: false }; } } },
    dataSources: { async query(input) { calls.push(["dataSources.query", input]); return { results: [
      { id: "wrong-asset", properties: { Work: { type: "relation", relation: [{ id: "work-1" }] }, "Source Page ID": { type: "rich_text", rich_text: [{ plain_text: "other-episode" }] }, "Media Block ID": { type: "rich_text", rich_text: [{ plain_text: "other-media" }] } } },
      publishableAsset()
    ], has_more: false }; } },
    databases: { async query() { throw new Error("database-wide query forbidden"); } },
    search: async () => { throw new Error("search forbidden"); }
  };
  const adapter = createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" });
  const result = await adapter.inspectTarget({ work_page_id: "work-1", spec_page_id: "spec-1", episode_page_id: "episode-1", expected_filename: "Example.2025.mp4" });
  assert.equal(result.mediaVerified, true);
  assert.equal(result.assetsVerified, true);
  assert.deepEqual(calls.slice(0, 4), [
    ["pages.retrieve", { page_id: "work-1" }],
    ["pages.retrieve", { page_id: "spec-1" }],
    ["pages.retrieve", { page_id: "episode-1" }],
    ["blocks.children.list", { block_id: "episode-1", page_size: 100 }]
  ]);
  assert.deepEqual(calls[4], ["dataSources.query", {
    data_source_id: "assets-ds", page_size: 20,
    filter: { property: "Media Block ID", rich_text: { equals: "media-1" } }
  }]);
  assert.equal(result.mediaAssetPageId, "asset-1");
  assert.equal(calls.length, 5);
});

test("adapter accepts exact asset evidence when the recorded work page is temporarily inaccessible", async () => {
  const client = {
    pages: { async retrieve({ page_id }) {
      if (page_id === "work-1") throw Object.assign(new Error("object_not_found"), { code: "object_not_found" });
      return { id: page_id, parent: { type: "page_id", page_id: page_id === "spec-1" ? "work-1" : "spec-1" } };
    } },
    blocks: { children: { async list({ block_id }) {
      if (block_id !== "episode-1") return { results: [], has_more: false };
      return { results: [{ id: "media-1", type: "video", video: {
        caption: [{ plain_text: "Wages.of.Fear.mp4" }],
        file: { url: "https://example.test/video.mp4" }
      } }], has_more: false };
    } } },
    dataSources: { async query() {
      return { results: [publishableAsset({
        Work: { type: "relation", relation: [] },
        "Source Page ID": { type: "rich_text", rich_text: [{ plain_text: "episode-1" }] },
        "Media Block ID": { type: "rich_text", rich_text: [{ plain_text: "media-1" }] }
      })] };
    } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", episode_page_id: "episode-1", expected_filename: "Wages.of.Fear.mp4"
  });
  assert.equal(result.structureVerified, true);
  assert.equal(result.mediaVerified, true);
  assert.equal(result.assetsVerified, true);
  assert.equal(result.mediaAssetPageId, "asset-1");
});

test("adapter rejects an arbitrary sibling media block when expected filename does not match", async () => {
  const client = {
    pages: { async retrieve({ page_id }) { return { id: page_id, parent: page_id === "work-1" ? { type: "workspace", workspace: true } : { type: "page_id", page_id: "work-1" } }; } },
    blocks: { children: { async list() { return { results: [{ id: "sibling-media", type: "video", video: { caption: [{ plain_text: "Other.Movie.mp4" }], file: { url: "https://example.test/other.mp4" } } }] }; } } },
    dataSources: { async query() { return { results: [publishableAsset({ "Source Page ID": { type: "rich_text", rich_text: [{ plain_text: "spec-1" }] } })] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", expected_filename: "Expected.Movie.mp4"
  });
  assert.equal(result.mediaVerified, false);
  assert.equal(result.mediaBlockId, null);
  assert.equal(result.assetsVerified, false);
});

test("adapter accepts one captionless media block on the exact registered destination", async () => {
  const client = {
    pages: { async retrieve({ page_id }) { return { id: page_id, parent: page_id === "work-1" ? { type: "workspace", workspace: true } : { type: "page_id", page_id: "work-1" } }; } },
    blocks: { children: { async list() { return { results: [{ id: "manual-media", type: "video", video: { caption: [], file: { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/opaque-key" } } }] }; } } },
    dataSources: { async query() { return { results: [publishableAsset({
      "Source Page ID": { type: "rich_text", rich_text: [{ plain_text: "spec-1" }] },
      "Media Block ID": { type: "rich_text", rich_text: [{ plain_text: "manual-media" }] }
    })] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", expected_filename: "Expected.Movie.mp4"
  });
  assert.equal(result.mediaVerified, true);
  assert.equal(result.mediaBlockId, "manual-media");
  assert.equal(result.assetsVerified, true);
});

test("adapter rejects multiple captionless media blocks without a recorded block id", async () => {
  const client = {
    pages: { async retrieve({ page_id }) { return { id: page_id, parent: page_id === "work-1" ? { type: "workspace", workspace: true } : { type: "page_id", page_id: "work-1" } }; } },
    blocks: { children: { async list() { return { results: [
      { id: "manual-media-1", type: "video", video: { caption: [], file: { url: "https://example.test/opaque-1" } } },
      { id: "manual-media-2", type: "video", video: { caption: [], file: { url: "https://example.test/opaque-2" } } }
    ] }; } } },
    dataSources: { async query() { return { results: [] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", expected_filename: "Expected.Movie.mp4"
  });
  assert.equal(result.mediaVerified, false);
  assert.equal(result.mediaBlockId, null);
  assert.equal(result.assetsVerified, false);
});

test("adapter accepts an explicitly recorded media block when its filename differs", async () => {
  const client = {
    pages: { async retrieve({ page_id }) { return { id: page_id, parent: page_id === "work-1" ? { type: "workspace", workspace: true } : { type: "page_id", page_id: page_id === "spec-1" ? "work-1" : "spec-1" } }; } },
    blocks: { children: { async list() { return { results: [{ id: "3b420ac1-2f0a-813e-a0f2-c4646ee80b7c", type: "video", video: { caption: [{ plain_text: "Older.Name.mp4" }], file: { url: "https://example.test/older.mp4" } } }] }; } } },
    dataSources: { async query() { return { results: [publishableAsset({ "Media Block ID": { type: "rich_text", rich_text: [{ plain_text: "3b420ac1-2f0a-813e-a0f2-c4646ee80b7c" }] } })] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", episode_page_id: "episode-1",
    expected_filename: "New.Local.Output.mp4", media_block_id: "3b420ac12f0a813ea0f2c4646ee80b7c"
  });
  assert.equal(result.mediaVerified, true);
  assert.equal(result.mediaBlockId, "3b420ac1-2f0a-813e-a0f2-c4646ee80b7c");
  assert.equal(result.assetsVerified, true);
});

test("adapter verifies recorded page parent relationships instead of retrieval alone", async () => {
  const client = {
    pages: { async retrieve({ page_id }) { return { id: page_id, parent: { type: "page_id", page_id: "wrong-parent" } }; } },
    blocks: { children: { async list() { return { results: [] }; } } },
    dataSources: { async query() { return { results: [] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", episode_page_id: "episode-1"
  });
  assert.equal(result.structureVerified, false);
});

test("adapter blocks publication when ledger work type and Notion 影别 disagree", async () => {
  const client = {
    pages: { async retrieve({ page_id }) {
      if (page_id === "work-1") return {
        id: page_id,
        parent: { type: "workspace", workspace: true },
        properties: { "影别": { type: "select", select: { name: "Movie" } } }
      };
      return { id: page_id, parent: { type: "page_id", page_id: "work-1" } };
    } },
    blocks: { children: { async list() { return { results: [] }; } } },
    dataSources: { async query() { return { results: [] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1",
    spec_page_id: "spec-1",
    work_type: "series"
  });
  assert.equal(result.structureVerified, false);
  assert.equal(result.assetGateCode, "work_type_mismatch");
  assert.equal(result.evidence.expectedNotionMediaType, "TV Series");
  assert.equal(result.evidence.notionMediaType, "Movie");
});

test("adapter accepts an existing spec nested under a legacy callout without allowing arbitrary parents", async () => {
  const client = {
    pages: { async retrieve({ page_id }) {
      if (page_id === "work-1") return { id: page_id, parent: { type: "workspace", workspace: true } };
      return { id: "3b420ac1-2f0a-8002-8e66-fa5189c0b166", parent: { type: "block_id", block_id: "callout-1" } };
    } },
    blocks: { children: { async list({ block_id }) {
      if (block_id === "work-1") return { results: [{ id: "callout-1", type: "callout", callout: { rich_text: [] } }] };
      if (block_id === "callout-1") return { results: [{ id: "3b420ac1-2f0a-8002-8e66-fa5189c0b166", type: "child_page", child_page: { title: "Legacy spec" } }] };
      return { results: [] };
    } } },
    dataSources: { async query() { return { results: [] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "3b420ac12f0a80028e66fa5189c0b166"
  });
  assert.equal(result.structureVerified, true);
});

test("adapter rejects minimally linked or review-gated Media Assets rows", async () => {
  const client = {
    pages: { async retrieve({ page_id }) { return { id: page_id, parent: page_id === "work-1" ? { type: "workspace", workspace: true } : { type: "page_id", page_id: "work-1" } }; } },
    blocks: { children: { async list() { return { results: [{ id: "media-1", type: "video", video: { caption: [{ plain_text: "Expected.mp4" }], file: { url: "https://example.test/video.mp4" } } }] }; } } },
    dataSources: { async query() { return { results: [{
      id: "minimal-asset", properties: {
        Work: { type: "relation", relation: [{ id: "work-1" }] },
        "Source Page ID": { type: "rich_text", rich_text: [{ plain_text: "spec-1" }] },
        "Media Block ID": { type: "rich_text", rich_text: [{ plain_text: "media-1" }] },
        "Playback Verified": { type: "checkbox", checkbox: false },
        "Hide from Website": { type: "checkbox", checkbox: true },
        "Needs Review": { type: "checkbox", checkbox: true }
      }
    }] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", expected_filename: "Expected.mp4"
  });
  assert.equal(result.assetsVerified, false);
  assert.equal(result.mediaAssetPageId, "minimal-asset");
  assert.equal(result.assetGateCode, "visibility_gate");
});

test("adapter rejects same-work Media Assets rows without target-specific evidence", async () => {
  const client = {
    pages: { async retrieve(input) { return { id: input.page_id }; } },
    blocks: { children: { async list() { return { results: [{ id: "media-1", type: "video", video: { file: { url: "https://example.test/video.mp4" } } }], has_more: false }; } } },
    dataSources: { async query() { return { results: [{
      id: "other-spec-asset",
      properties: {
        Work: { type: "relation", relation: [{ id: "work-1" }] },
        "Source Page ID": { type: "rich_text", rich_text: [{ plain_text: "other-spec" }] },
        "Media Block ID": { type: "rich_text", rich_text: [{ plain_text: "other-media" }] }
      }
    }] }; } }
  };
  const result = await createNotionTargetAdapter(client, { mediaAssetsDataSourceId: "assets-ds" }).inspectTarget({
    work_page_id: "work-1", spec_page_id: "spec-1", episode_page_id: null
  });
  assert.equal(result.assetsVerified, false);
  assert.equal(result.mediaAssetPageId, null);
});
