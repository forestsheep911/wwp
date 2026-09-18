import assert from "node:assert/strict";
import test from "node:test";
import type { PersonCatalogState, PersonProfile, SearchResult } from "@wwpdw/shared";
import { buildPeopleProgress } from "./people-progress.js";

const updatedAt = "2026-09-18T00:00:00.000Z";

function work(workId: string, credits: Array<{ name: string; personId?: string }> = []): SearchResult {
  return {
    assetKey: workId,
    title: workId,
    source: "test",
    sourceUrl: "",
    durationLabel: "",
    updatedAt,
    summary: "",
    metadata: {
      workId,
      credits: credits.map((credit) => ({ ...credit, department: "acting" }))
    }
  } as SearchResult;
}

function catalog(profile: PersonProfile): PersonCatalogState {
  return {
    schemaVersion: 1,
    generatedAt: updatedAt,
    people: { [profile.personId]: { profile, workIds: ["work-1"], updatedAt } },
    redirects: {},
    externalIdIndex: { tmdb: {}, imdb: {}, wikidata: {} },
    aliasIndex: {},
    creditsByWorkId: {},
    creditsByPersonId: {},
    issues: []
  };
}

test("progress counts only published people and exposes works without credit lists", () => {
  const profile: PersonProfile = {
    personId: "person-1",
    names: [{ value: "甲", language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt: updatedAt }],
    externalIds: { wikidata: "Q1" },
    departments: ["acting"],
    dataQuality: { status: "partial", updatedAt },
    createdAt: updatedAt,
    updatedAt
  };
  const progress = buildPeopleProgress([
    work("work-1", [{ name: "甲", personId: "person-1" }, { name: "乙", personId: "missing-person" }]),
    work("work-2", [{ name: "丙" }]),
    work("work-3")
  ], catalog(profile));

  assert.equal(progress.workCount, 3);
  assert.equal(progress.worksWithoutCredits, 1);
  assert.equal(progress.worksFullyLinked, 0);
  assert.equal(progress.knownCreditCount, 3);
  assert.equal(progress.linkedCreditCount, 1);
  assert.equal(progress.profileCount, 1);
  assert.equal(progress.qualityReadyCount, 0);
  assert.equal(progress.repairPriorities.P2, 1);
  assert.equal(progress.personCatalogUpdatedAt, updatedAt);
});

test("a reviewed bilingual profile contributes to quality progress", () => {
  const sources = ["wikidata:Q1", "imdb:nm0000001"];
  const profile: PersonProfile = {
    personId: "person-reviewed",
    names: [
      { value: "测试人物", language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt: updatedAt },
      { value: "Reviewed Person", language: "en", kind: "display", source: "manual", status: "verified", observedAt: updatedAt }
    ],
    externalIds: { wikidata: "Q1" },
    departments: ["acting"],
    biography: { texts: [
      { value: "这位电影工作者在不同类型的作品中持续积累表演经验，并与多位导演和演员合作。早期作品帮助其建立银幕形象，后来的角色逐渐扩展到复杂的人物关系与社会处境。其职业生涯跨越多个创作阶段，代表作品呈现了对人物情绪和叙事节奏的长期关注，相关经历由独立资料核对。", language: "zh-CN", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sources, observedAt: updatedAt },
      { value: "This film performer built a sustained career across projects of different forms and scales, working with several directors and fellow actors. Early screen roles established a recognizable presence, while later performances explored more complicated relationships and social settings. Representative work across distinct career stages shows continued attention to character emotion and narrative rhythm, supported by independent biographical sources.", language: "en", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sources, observedAt: updatedAt }
    ] },
    dataQuality: { status: "verified", reviewedAt: updatedAt, updatedAt },
    createdAt: updatedAt,
    updatedAt
  };
  const progress = buildPeopleProgress([work("work-1", [{ name: "测试人物", personId: profile.personId }])], catalog(profile));

  assert.equal(progress.worksFullyLinked, 1);
  assert.equal(progress.qualityReadyCount, 1);
  assert.deepEqual(progress.repairPriorities, { P0: 0, P1: 0, P2: 0 });
});
