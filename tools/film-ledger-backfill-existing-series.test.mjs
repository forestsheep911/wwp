import assert from "node:assert/strict";
import test from "node:test";

import {
  candidate,
  completeVariant,
  createRequestGate,
  episodeSpecMap,
  releaseItemFromCandidate
} from "./film-ledger-backfill-existing-series.mjs";

test("episodeSpecMap finds episode pages beneath a legacy toggle-wrapped spec", async () => {
  const children = new Map([
    ["work", [
      { id: "toggle", type: "toggle", has_children: true },
      { id: "note", type: "callout", has_children: false }
    ]],
    ["toggle", [{ id: "spec", type: "child_page", child_page: { title: "Example spec" } }]],
    ["spec", [
      { id: "episode-01", type: "child_page", child_page: { title: "Episode 01" } },
      { id: "metadata", type: "child_page", child_page: { title: "Notes" } }
    ]]
  ]);
  const notion = {
    blocks: {
      children: {
        async list({ block_id }) {
          return { results: children.get(block_id) ?? [], has_more: false };
        }
      }
    }
  };

  const mapping = await episodeSpecMap(notion, "work");
  assert.deepEqual([...mapping.entries()], [["episode-01", "spec"]]);
});

test("candidate can backfill a verified uploaded asset after local cleanup", () => {
  const asset = {
    id: "asset-01",
    properties: {
      "Source Page ID": { rich_text: [{ plain_text: "episode-01" }] },
      "Media Block ID": { rich_text: [{ plain_text: "block-01" }] },
      "Original File Name": { rich_text: [{ plain_text: "Show.E01.mp4" }] },
      "Episode Number": { number: 1 },
      "Playback Verified": { checkbox: true },
      "Hide from Website": { checkbox: false },
      "Media Availability": { select: { name: "playable" } },
      "Asset Type": { select: { name: "playable_video" } },
      "Display Label": { rich_text: [{ plain_text: "Show Episode 01" }] },
      "Audio Languages": { multi_select: [{ name: "英语原声" }] },
      "Subtitle Languages": { multi_select: [{ name: "简体烧录" }] }
    }
  };
  const episodeToSpec = new Map([["episode-01", "spec-01"]]);
  const files = { byName: new Map(), legacyEpisodes: new Map() };

  assert.deepEqual(candidate(asset, episodeToSpec, files, 0).issues, ["local_file_missing"]);
  const uploadedOnly = candidate(asset, episodeToSpec, files, 0, { allowUploadedOnly: true });
  assert.deepEqual(uploadedOnly.issues, []);
  assert.equal(uploadedOnly.outputPath, null);
  assert.equal(uploadedOnly.outputBytes, null);
});

test("uploaded-only completion never looks up a synthetic null output path", () => {
  const calls = [];
  const variant = { id: 7, production_state: "qc_passed", publication_state: "sync_ready" };
  const repo = {
    findVariantByOutputPath() { throw new Error("must not inspect an absent output path"); },
    refreshProductionEvidence(id, details) { calls.push(["refresh", id, details]); return variant; },
    registerNotionTarget(id, details) { calls.push(["target", id, details]); },
    recordNotionInspection(id, details) { calls.push(["inspection", id, details]); },
    transitionProduction() { throw new Error("already complete"); },
    transitionPublication() { throw new Error("already complete"); }
  };

  completeVariant(repo, 7, {
    outputPath: null,
    outputBytes: null,
    workPageId: "work",
    specPageId: "spec",
    episodePageId: "episode",
    fileName: "episode.mp4",
    mediaBlockId: "block",
    assetPageId: "asset",
    at: "2026-08-29T00:00:00.000Z"
  });

  const refresh = calls.find(([name]) => name === "refresh");
  assert.equal(refresh[2].outputPath, null);
});

test("the shared request gate serializes concurrent callers", async () => {
  const gate = createRequestGate(10);
  const starts = [];
  await Promise.all([1, 2, 3].map(value => gate(async () => starts.push([value, Date.now()]))));

  assert.deepEqual(starts.map(([value]) => value), [1, 2, 3]);
  assert.ok(starts[1][1] - starts[0][1] >= 8);
  assert.ok(starts[2][1] - starts[1][1] >= 8);
});

test("a verified playable hidden asset becomes an exactly guarded release item", () => {
  const item = {
    issues: ["asset_hidden"],
    assetPageId: "asset",
    episodePageId: "episode",
    mediaBlockId: "block",
    episodeNumber: 3,
    resolution: "1080p",
    videoCodec: "hevc",
    container: "mp4",
    approximateSizeGb: 0.81
  };

  assert.deepEqual(releaseItemFromCandidate(item, "work"), {
    pageId: "asset",
    expectedWorkPageId: "work",
    expectedSourcePageId: "episode",
    expectedMediaBlockId: "block",
    expectedEpisodeNumber: 3,
    expectedResolution: "1080p",
    expectedVideoCodec: "hevc",
    expectedContainer: "mp4",
    expectedApproxSizeGb: 0.81
  });
});
