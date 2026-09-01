import assert from "node:assert/strict";
import test from "node:test";
import type { PersonProfile } from "@wwpdw/shared";

import { applyReviewedChineseBiographies, applyReviewedCreditNames } from "./person-biography-review.js";

const substantiveZh = "这位电影工作者早年进入行业，随后在剧情片、纪录片和电视制作之间积累经验，并逐步形成稳定的创作方法。其职业生涯经历多个阶段，也包括与重要导演、编剧、摄影师和演员的长期合作；多部代表作品显示出对人物关系、社会环境与电影语言的持续探索，具体履历和贡献由两类独立资料交叉核实。";
const substantiveEn = "This film professional entered the industry early, gained experience across narrative film, documentary, and television, and gradually developed a consistent creative method. The career spans several stages and includes sustained collaborations with important directors, writers, cinematographers, and performers, while representative works show a continuing engagement with character, social context, and film language supported by independent sources.";

const profile: PersonProfile = {
  personId: "person_123e4567-e89b-42d3-a456-426614174000",
  names: [{ value: "旧名", language: "zh", kind: "display" as const, source: "wikidata" as const, status: "strong" as const, observedAt: "2026-08-01T00:00:00Z" }],
  biography: { texts: [{ value: "职业描述", language: "zh", source: "wikidata" as const, status: "strong" as const, observedAt: "2026-08-01T00:00:00Z" }] },
  dataQuality: { status: "partial" as const, updatedAt: "2026-08-01T00:00:00Z" },
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z"
};

test("keeps the profile partial until all core identity fields are verified", () => {
  const report = applyReviewedChineseBiographies({ proposedProfiles: [profile] }, [{
    personId: profile.personId,
    chineseName: "新名",
    biographyZh: substantiveZh,
    biographyEn: substantiveEn,
    sourceRefs: ["https://movie.douban.com/celebrity/1/", "https://www.wikidata.org/wiki/Q1"]
  }], "2026-08-11T00:00:00Z");
  const next = report.proposedProfiles[0];
  assert.equal(next.names[0].value, "新名");
  assert.equal(next.biography?.texts?.[0].status, "verified");
  assert.equal(next.biography?.texts?.[0].method, "editorial-rewrite");
  assert.equal(next.biography?.texts?.[1].language, "en");
  assert.equal(next.biography?.texts?.[1].status, "verified");
  assert.equal(next.dataQuality.status, "partial");
  assert.match(next.dataQuality.issues?.join(" ") ?? "", /missing_stable_external_id/);
});

test("promotes a fully reviewed core profile without requiring optional portrait or dates", () => {
  const complete = {
    ...profile,
    externalIds: { wikidata: "Q1" },
    departments: ["acting" as const]
  };
  const report = applyReviewedChineseBiographies({ proposedProfiles: [complete] }, [{
    personId: profile.personId,
    chineseName: "新名",
    englishName: "New Name",
    biographyZh: substantiveZh,
    biographyEn: substantiveEn,
    sourceRefs: ["https://movie.douban.com/celebrity/1/", "https://www.wikidata.org/wiki/Q1"]
  }], "2026-08-11T00:00:00Z");
  assert.equal(report.proposedProfiles[0].dataQuality.status, "verified");
  assert.deepEqual(report.proposedProfiles[0].dataQuality.issues, undefined);
});

test("rejects a single-source biography review", () => {
  assert.throws(() => applyReviewedChineseBiographies({ proposedProfiles: [profile] }, [{
    personId: profile.personId,
    chineseName: "新名",
    biographyZh: "只有豆瓣一个来源。",
    sourceRefs: ["douban:1"]
  }]), /at least two independent source families/);
});

test("removes trailing punctuation accidentally returned in source names", () => {
  const punctuatedProfile = {
    ...profile,
    names: [{ ...profile.names[0], value: "树木希林," }]
  };
  const report = applyReviewedChineseBiographies({ proposedProfiles: [punctuatedProfile] }, [{
    personId: profile.personId,
    chineseName: "树木希林",
    biographyZh: substantiveZh,
    sourceRefs: ["https://movie.douban.com/celebrity/1/", "https://www.wikidata.org/wiki/Q1"]
  }], "2026-08-11T00:00:00Z");
  assert.equal(report.proposedProfiles.some((entry) => entry.names.some((name) => /[,，]$/u.test(name.value))), false);
});

test("uses reviewed canonical names for linked credits and explicit names for excluded groups", () => {
  const report = applyReviewedCreditNames({ proposedCredits: [{ workId: "work_1", title: "作品", credits: [
    { name: "内田启子", department: "acting", personId: profile.personId, source: "wikidata" },
    { name: "三上雅彦", department: "music", externalIds: { wikidata: "Q2749030" }, source: "wikidata" }
  ] }] }, [{ personId: profile.personId, chineseName: "树木希林", biographyZh: "小传", sourceRefs: [] }], { Q2749030: "Gontiti" });
  assert.deepEqual(report.proposedCredits[0].credits.map((credit) => credit.name), ["树木希林", "Gontiti"]);
});
