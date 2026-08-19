import assert from "node:assert/strict";
import test from "node:test";

import { reviewChineseBiography, reviewEnglishBiography, reviewPersonCoreProfile, splitBiographySourceRefs } from "./person-biography-quality.js";

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

test("rejects database-process prose and vague award filler", () => {
  const sourceRefs = ["douban:123", "wikidata:Q1"];
  assert.equal(reviewChineseBiography({
    text: "某演员在本站影片中以主要演员身份参与创作或演出，相关作品关系由稳定外部身份记录核对。本小传依据资料综合改写。",
    method: "editorial-rewrite",
    sourceRefs
  }).eligibleForVerified, false);
  assert.equal(reviewEnglishBiography({
    text: "They contributed as an actor, linking their profile to the film through a documented creative credit. This summary was independently rewritten from the cited evidence.",
    method: "editorial-rewrite",
    sourceRefs
  }).eligibleForVerified, false);
});

test("defines verified core data without requiring optional portrait or exact dates", () => {
  const observedAt = "2026-08-14T00:00:00.000Z";
  const sourceRefs = ["douban:123", "wikidata:Q1"];
  const review = reviewPersonCoreProfile({
    personId: "person_123e4567-e89b-42d3-a456-426614174000",
    names: [
      { value: "新名", language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt },
      { value: "New Name", language: "en", kind: "display", source: "manual", status: "verified", observedAt }
    ],
    externalIds: { wikidata: "Q1" },
    departments: ["acting"],
    biography: { texts: [
      { value: "这是一段以人物生涯、主要合作和代表作品为中心的原创中文小传。", language: "zh-CN", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sourceRefs, observedAt },
      { value: "This is an original person-centred biography covering a career, major collaborations, and representative work.", language: "en", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sourceRefs, observedAt }
    ] },
    dataQuality: { status: "partial", updatedAt: observedAt },
    createdAt: observedAt,
    updatedAt: observedAt
  });
  assert.deepEqual(review, { eligibleForVerified: true, issues: [] });
});
