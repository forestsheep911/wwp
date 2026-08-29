import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSeriesVariantCoverage, episodeNumberFromVariant, normalizeSeriesSpecTitle } from "./film-series-coverage.mjs";

function row({ episode, title, state = "qc_passed", publication = "sync_ready", output, workId = 1 }) {
  return {
    work_id: workId,
    canonical_title: "Example Season 1",
    source_id: 10,
    source_missing: 0,
    spec_key: `spec:source-10:episode-${episode}`,
    display_title: title,
    output_path: output ?? `X:\\video\\example.s01e${String(episode).padStart(2, "0")}.mp4`,
    expected_filename: null,
    production_state: state,
    publication_state: publication
  };
}

test("extracts episode numbers from season filenames and ledger spec keys", () => {
  assert.equal(episodeNumberFromVariant({ output_path: "show.s02e13.mp4" }), 13);
  assert.equal(episodeNumberFromVariant({ spec_key: "high:source-3:episode-9" }), 9);
  assert.equal(episodeNumberFromVariant({ output_path: "movie.2009.mp4" }), null);
});

test("normalizes legacy per-episode suffixes before grouping a specification", () => {
  assert.equal(normalizeSeriesSpecTitle("Example 简 1GB/集 / Episode 01"), "Example 简 1GB/集");
  assert.equal(normalizeSeriesSpecTitle("Example 简 1GB/集 / 第02集"), "Example 简 1GB/集");
  const rows = [1, 2, 3].map((episode) => row({
    episode,
    title: `Example 简 1GB/集 / Episode ${String(episode).padStart(2, "0")}`
  }));
  rows.push(...[1, 2, 3].map((episode) => row({ episode, title: "Example 高配 3GB/集" })));
  assert.deepEqual(analyzeSeriesVariantCoverage(rows), []);
});

test("reports a partially published per-episode specification", () => {
  const rows = [1, 2, 3, 4].map((episode) => row({ episode, title: "Example 简 1GB/集" }));
  rows.push(...[1, 2].map((episode) => row({ episode, title: "Example 英语原声 简 3.5GB/集" })));
  const gaps = analyzeSeriesVariantCoverage(rows);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].missing_episodes, [3, 4]);
  assert.deepEqual(gaps[0].completed_episodes, [1, 2]);
});

test("deferred and cancelled episode decisions close the coverage gap", () => {
  const rows = [1, 2, 3, 4].map((episode) => row({ episode, title: "Example 简 1GB/集" }));
  rows.push(row({ episode: 1, title: "Example 英语原声 简 3.5GB/集" }));
  rows.push(row({ episode: 2, title: "Example 英语原声 简 3.5GB/集" }));
  rows.push(row({ episode: 3, title: "Example 英语原声 简 3.5GB/集", state: "deferred", publication: "not_ready" }));
  rows.push(row({ episode: 4, title: "Example 英语原声 简 3.5GB/集", state: "rejected", publication: "cancelled" }));
  assert.deepEqual(analyzeSeriesVariantCoverage(rows), []);
});

test("does not turn a lone smoke sample into a season-wide commitment", () => {
  const rows = [1, 2, 3].map((episode) => row({ episode, title: "Example 简 1GB/集" }));
  rows.push(row({ episode: 1, title: "Codec trial", output: "X:\\video\\example.s01e01.smoke.mp4" }));
  assert.deepEqual(analyzeSeriesVariantCoverage(rows), []);
});

test("keeps specials separate from the normal season episode universe", () => {
  const rows = [1, 2, 3].map((episode) => row({ episode, title: "Example 简 1GB/集" }));
  rows.push(row({ episode: 1, title: "Example SP 特别篇 3GB/集" }));
  rows.push(row({ episode: 2, title: "Example SP 特别篇 3GB/集" }));
  assert.deepEqual(analyzeSeriesVariantCoverage(rows), []);
});

test("allows commentary specifications to cover only episodes that expose commentary", () => {
  const rows = [1, 2, 3, 4].map((episode) => row({ episode, title: "Example 英语 简 3GB/集" }));
  rows.push(row({ episode: 1, title: "Example 评论音轨 简英" }));
  rows.push(row({ episode: 4, title: "Example 评论音轨 简英" }));
  assert.deepEqual(analyzeSeriesVariantCoverage(rows), []);
});
