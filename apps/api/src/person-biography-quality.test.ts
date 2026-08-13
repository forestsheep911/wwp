import assert from "node:assert/strict";
import test from "node:test";

import { reviewChineseBiography, reviewEnglishBiography, splitBiographySourceRefs } from "./person-biography-quality.js";

test("requires an editorial rewrite backed by two independent sources", () => {
  assert.deepEqual(splitBiographySourceRefs("douban:123; wikidata:Q1\nhttps://example.org/person"), [
    "douban:123", "wikidata:Q1", "https://example.org/person"
  ]);
  const review = reviewChineseBiography({
    text: "经核实后重新撰写的小传。",
    method: "editorial-rewrite",
    sourceRefs: ["douban:123", "wikidata:Q1"]
  });
  assert.equal(review.eligibleForVerified, true);
  assert.deepEqual(review.independentSources, ["douban", "wikidata"]);
});

test("does not verify copied, translated, or single-source Chinese biographies", () => {
  assert.equal(reviewChineseBiography({
    text: "只有一个来源。",
    method: "editorial-rewrite",
    sourceRefs: ["https://movie.douban.com/celebrity/1", "douban:1"]
  }).eligibleForVerified, false);
  assert.equal(reviewChineseBiography({
    text: "机器翻译。",
    method: "machine-translation",
    sourceRefs: ["tmdb:1", "wikidata:Q1"]
  }).eligibleForVerified, false);
});

test("verifies an independently sourced editorial English biography", () => {
  const review = reviewEnglishBiography({
    text: "An original English biography written from a checked factual brief.",
    method: "editorial-rewrite",
    sourceRefs: ["https://example.org/profile", "wikidata:Q1"]
  });
  assert.equal(review.eligibleForVerified, true);
  assert.deepEqual(review.independentSources, ["example.org", "wikidata"]);
});
