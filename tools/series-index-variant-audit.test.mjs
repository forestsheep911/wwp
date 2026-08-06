import assert from "node:assert/strict";
import test from "node:test";
import { duplicateEpisodeGroups, visiblePlayableEpisodeVariants } from "./series-index-variant-audit.mjs";

function variant(episodeNumber, label, overrides = {}) {
  return { label, metadata: { episodeNumber, playbackVerified: true, hideFromWebsite: false, ...overrides } };
}

test("series index audit accepts explicit compatible size tiers as a non-blocking duplicate", () => {
  const result = { variants: [
    variant(1, "Example H.265 0.8-1.1GB/集 / Episode 01"),
    variant(1, "Example H.265 0.9-1.3GB/集 / Episode 01")
  ] };
  assert.equal(visiblePlayableEpisodeVariants(result).length, 2);
  assert.deepEqual(duplicateEpisodeGroups(result).map((group) => ({ episodeNumber: group.episodeNumber, status: group.status })), [{ episodeNumber: 1, status: "distinct_size_tiers" }]);
});

test("series index audit excludes hidden variants and flags ambiguous visible duplicates", () => {
  const result = { variants: [
    variant(2, "Example H.265 / Episode 02"),
    variant(2, "Example H.265 / Episode 02 replacement"),
    variant(2, "Example H.265 0.8GB/集 / Episode 02", { hideFromWebsite: true })
  ] };
  assert.equal(visiblePlayableEpisodeVariants(result).length, 2);
  assert.equal(duplicateEpisodeGroups(result)[0].status, "review_required");
});

test("series index audit reports legacy size labels separately from ambiguous duplicates", () => {
  const result = { variants: [
    variant(3, "Example H.265 0.5-0.7GB / Episode 03"),
    variant(3, "Example H.265 0.37-0.49GB/集 / Episode 03")
  ] };
  assert.equal(duplicateEpisodeGroups(result)[0].status, "legacy_tier_title");
});
