import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult } from "@wwpdw/shared";
import { publicLibraryResults } from "./public-library.js";
import { buildSiteStatistics } from "./site-statistics.js";

function work(key: string, metadata = {}, variants = [{ assetKey: `${key}-video`, sourceUrl: "https://example.test/movie.mp4" }]): SearchResult {
  return { assetKey: key, title: key, source: "notion", sourceUrl: "", summary: "", durationLabel: "", updatedAt: "2026-09-16", metadata, variants } as SearchResult;
}

test("browse and statistics include playable works regardless of editorial or cache readiness", () => {
  const rows = [work("ready", { dataQuality: { status: "partial" } }), work("hidden", { hideFromWebsite: true }), work("draft", {}, []), work("player-leaf", {}, [])];
  assert.deepEqual(publicLibraryResults(rows).map(row => row.assetKey), ["ready"]);
  assert.equal(buildSiteStatistics(rows).totals.titles, 1);
  assert.equal(buildSiteStatistics(rows).totals.instantPlay, 0);
});

test("one work with multiple specifications is one title with distinct playable variants", () => {
  const rows = [work("a", {workId: "canonical"}), work("b", {workId: "canonical"}), work("a", {workId: "canonical"})];
  assert.equal(publicLibraryResults(rows).length, 1);
  assert.equal(buildSiteStatistics(rows).totals.titles, 1);
  assert.equal(buildSiteStatistics(rows).totals.variants, 2);
  assert.equal(rows[0].variants?.length, 1);
});

test("hidden, non-playable, source-only and empty-source variants do not make a public work", () => {
  const variants = [
    {assetKey: "hidden", sourceUrl: "https://example.test/a", metadata: {hideFromWebsite: true}},
    {assetKey: "missing", sourceUrl: "https://example.test/b", metadata: {availability: "missing"}},
    {assetKey: "archive", sourceUrl: "https://example.test/c", metadata: {assetType: "source_archive"}},
    {assetKey: "empty", sourceUrl: ""}
  ];
  const row = work("excluded", {}, variants);
  assert.equal(publicLibraryResults([row]).length, 0);
  assert.equal(buildSiteStatistics([row]).totals.titles, 0);
  row.variants!.push(work("valid").variants![0]);
  assert.equal(buildSiteStatistics([row]).totals.variants, 1);
});

test("page ID formatting does not duplicate works without a maintained work ID", () => {
  const a = {...work("a"), sourcePageId: "AABB-CCDD"};
  const b = {...work("b"), sourcePageId: "aabbccdd"};
  assert.equal(publicLibraryResults([a,b]).length, 1);
});
