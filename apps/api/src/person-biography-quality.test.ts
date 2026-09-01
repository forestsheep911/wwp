import assert from "node:assert/strict";
import test from "node:test";

import { assertVerifiedPersonProfileQuality, reviewChineseBiography, reviewEnglishBiography, reviewPersonCoreProfile, splitBiographySourceRefs } from "./person-biography-quality.js";

test("requires an editorial rewrite backed by two independent sources", () => {
  assert.deepEqual(splitBiographySourceRefs("douban:123; wikidata:Q1\nhttps://example.org/person"), [
    "douban:123", "wikidata:Q1", "https://example.org/person"
  ]);
  const review = reviewChineseBiography({
    text: "某导演早年从纪录片进入电影行业，随后通过多部剧情长片逐步形成对家庭关系、城市生活与社会变化的持续观察。他长期与固定的编剧、摄影和演员合作，代表作品跨越不同创作阶段，并以细致的人物调度和稳定的视觉方法建立个人风格。其职业轨迹和具体贡献均由所列独立资料交叉核实。",
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
    text: "This filmmaker began in documentary production before moving into narrative cinema and developing a sustained interest in family life, urban change, and social memory. Across several career stages, recurring collaborations with writers, cinematographers, and performers helped establish a precise visual and dramatic method supported here by independently checked factual sources.",
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

test("rejects the short Wikidata credit template and obvious English grammar failure", () => {
  const sourceRefs = ["wikidata:Q1", "imdb:nm0000001"];
  assert.equal(reviewChineseBiography({
    text: "某演员是一名演员，其公开人物资料来自 Wikidata；在《某电影》中担任Actor。",
    method: "editorial-rewrite",
    sourceRefs
  }).eligibleForVerified, false);
  assert.equal(reviewEnglishBiography({
    text: "Some Performer is a actor documented in Wikidata. In A Film, Some Performer is credited as Actor.",
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
      { value: "这位电影工作者早年进入行业后，先后参与不同类型和规模的项目，并在长期实践中形成稳定的创作方法。其职业经历包括多个阶段，也包含与重要导演、编剧、摄影师和演员的持续合作；代表作品显示出对人物关系、社会环境和电影语言的连贯探索，具体履历与贡献由两类独立资料交叉核实。", language: "zh-CN", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sourceRefs, observedAt },
      { value: "This film professional entered the industry early, worked across projects of different types and scales, and gradually developed a consistent creative method. The career spans several stages and includes sustained collaborations with important directors, writers, cinematographers, and performers, while representative works show a continuing engagement with character, social context, and film language supported by two independent source families.", language: "en", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sourceRefs, observedAt }
    ] },
    dataQuality: { status: "partial", updatedAt: observedAt },
    createdAt: observedAt,
    updatedAt: observedAt
  });
  assert.deepEqual(review, { eligibleForVerified: true, issues: [] });
});

test("rejects a profile that claims verified status with a weak provider biography", () => {
  const observedAt = "2026-08-14T00:00:00.000Z";
  assert.throws(() => assertVerifiedPersonProfileQuality({
    personId: "person_123e4567-e89b-42d3-a456-426614174000",
    names: [
      { value: "某演员", language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt },
      { value: "Some Actor", language: "en", kind: "display", source: "manual", status: "verified", observedAt }
    ],
    externalIds: { wikidata: "Q1" },
    departments: ["acting"],
    biography: { texts: [
      { value: "某演员是一名演员，其公开人物资料来自 Wikidata；在《某电影》中担任Actor。", language: "zh-CN", source: "wikidata", status: "strong", observedAt },
      { value: "Some Actor is a actor documented in Wikidata. In A Film, Some Actor is credited as Actor.", language: "en", source: "wikidata", status: "strong", observedAt }
    ] },
    dataQuality: { status: "verified", updatedAt: observedAt },
    createdAt: observedAt,
    updatedAt: observedAt
  }), /claims verified data/);
});
