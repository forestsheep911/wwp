import assert from "node:assert/strict";
import test from "node:test";
import type { PersonProfile } from "@wwpdw/shared";
import { assessPersonQuality, PERSON_QUALITY_POLICY_VERSION, withPersonQualityAssessment } from "./person-quality-score.js";

const reviewedAt = "2026-01-15T00:00:00.000Z";
const sources = ["wikidata:Q1", "imdb:nm0000001"];
const substantiveZh = "这位电影工作者早年进入行业，随后在剧情片、纪录片和电视制作之间积累经验，并逐步形成稳定的创作方法。其职业生涯经历多个阶段，也包括与重要导演、编剧、摄影师和演员的长期合作；多部代表作品显示出对人物关系、社会环境与电影语言的持续探索，具体履历和贡献由两类独立资料交叉核实。";
const substantiveEn = "This film professional entered the industry early, gained experience across narrative film, documentary, and television, and gradually developed a consistent creative method. The career spans several stages and includes sustained collaborations with important directors, writers, cinematographers, and performers, while representative works show a continuing engagement with character, social context, and film language supported by independent sources.";

function completeProfile(overrides: Partial<PersonProfile> = {}): PersonProfile {
  return {
    personId: "person-test",
    names: [
      { value: "测试人物", language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt: reviewedAt },
      { value: "Test Person", language: "en", kind: "display", source: "manual", status: "verified", observedAt: reviewedAt },
      { value: "Test Person", language: "en", kind: "original", source: "manual", status: "verified", observedAt: reviewedAt },
      { value: "T. Person", language: "en", kind: "alternate", source: "manual", status: "strong", observedAt: reviewedAt }
    ],
    externalIds: { wikidata: "Q1", imdb: "nm0000001" },
    departments: ["directing"],
    biography: {
      birthDate: "1970",
      birthPlace: "测试地点",
      texts: [
        { value: substantiveZh, language: "zh-CN", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sources, observedAt: reviewedAt },
        { value: substantiveEn, language: "en", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sources, observedAt: reviewedAt }
      ]
    },
    profileImages: [{ url: "https://example.test/person.jpg", source: "manual" }],
    dataQuality: { status: "verified", updatedAt: reviewedAt },
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
    ...overrides
  };
}

test("scores a fully reviewed profile and infers the last full review time", () => {
  const assessment = assessPersonQuality(completeProfile(), new Date("2026-08-31T00:00:00.000Z"));
  assert.equal(assessment.score, 100);
  assert.equal(assessment.policyVersion, PERSON_QUALITY_POLICY_VERSION);
  assert.equal(assessment.reviewedAt, reviewedAt);
  assert.equal(assessment.nextReviewAt, "2028-01-15T00:00:00.000Z");
  assert.equal(assessment.reviewDue, false);
});

test("caps identity conflicts and incomplete biographies even when optional metadata is complete", () => {
  const conflict = assessPersonQuality(completeProfile({ dataQuality: { status: "conflict", issues: ["external_id_conflict"], updatedAt: reviewedAt } }));
  assert.equal(conflict.score, 39);
  assert.equal(conflict.reviewDue, true);

  const weak = completeProfile({ biography: { texts: [{ value: "公开人物资料来自 Wikidata。", language: "zh-CN", source: "wikidata", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["wikidata:Q1"], observedAt: reviewedAt }] } });
  assert.ok(assessPersonQuality(weak).score <= 79);
});

test("persists versioned components without changing the profile update timestamp", () => {
  const profile = completeProfile();
  const scored = withPersonQualityAssessment(profile, { reviewedAt: "2026-08-31T00:00:00.000Z" });
  assert.equal(scored.dataQuality.score, 100);
  assert.equal(scored.dataQuality.scoreVersion, PERSON_QUALITY_POLICY_VERSION);
  assert.equal(scored.dataQuality.reviewedAt, "2026-08-31T00:00:00.000Z");
  assert.equal(scored.updatedAt, profile.updatedAt);
});
