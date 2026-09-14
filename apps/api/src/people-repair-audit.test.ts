import assert from "node:assert/strict";
import test from "node:test";
import type { MovieCreditDepartment, PersonCatalogState, PersonProfile } from "@wwpdw/shared";
import { auditPeopleRepairCandidates } from "./people-repair-audit.js";

const observedAt = "2026-08-30T00:00:00.000Z";

function profile(personId: string, overrides: Partial<PersonProfile> = {}): PersonProfile {
  const sources = ["wikidata:Q1", "imdb:nm0000001"];
  return {
    personId,
    names: [
      { value: `人物${personId}`, language: "zh-CN", kind: "display", source: "manual", status: "verified", observedAt },
      { value: `Person ${personId}`, language: "en", kind: "display", source: "manual", status: "verified", observedAt },
      { value: `Original ${personId}`, language: "en", kind: "original", source: "manual", status: "verified", observedAt },
      { value: `Alias ${personId}`, language: "en", kind: "alternate", source: "manual", status: "strong", observedAt }
    ],
    externalIds: { wikidata: "Q1" },
    departments: ["acting"],
    biography: {
      birthDate: "1970",
      birthPlace: "测试地点",
      texts: [
        { value: "这是一位拥有长期职业经历的电影工作者，早年进入行业后逐渐参与不同类型和规模的作品，并在持续合作中形成稳定而清晰的创作方向。其代表作品体现了对人物关系、社会环境和电影语言的长期关注，也展现了跨越多个职业阶段的经验与贡献。相关事实经过独立来源核对。", language: "zh-CN", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sources, observedAt },
        { value: "This film professional built a long career across projects of different forms and scales, developing a consistent creative direction through sustained collaborations. Representative work shows a continuing interest in character, social context, and cinematic form while demonstrating experience across several stages of a durable screen career, supported by independent biographical sources.", language: "en", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: sources, observedAt }
      ]
    },
    profileImages: [{ url: "https://example.test/person.jpg", source: "manual" }],
    dataQuality: { status: "verified", updatedAt: observedAt },
    createdAt: observedAt,
    updatedAt: observedAt,
    ...overrides
  };
}

function state(profiles: PersonProfile[], links: Array<{ personId: string; workId: string; department?: MovieCreditDepartment }> = []): PersonCatalogState {
  const people = Object.fromEntries(profiles.map((item) => [item.personId, { profile: item, workIds: links.filter((link) => link.personId === item.personId).map((link) => link.workId), updatedAt: observedAt }]));
  return {
    schemaVersion: 1,
    generatedAt: observedAt,
    people,
    redirects: {},
    externalIdIndex: { tmdb: {}, imdb: {}, wikidata: {} },
    aliasIndex: {},
    creditsByWorkId: Object.fromEntries(links.map((link) => [link.workId, [{ personId: link.personId, name: link.personId, department: link.department ?? "acting" }]])),
    creditsByPersonId: Object.fromEntries(links.map((link) => [link.personId, [{ personId: link.personId, name: link.personId, workId: link.workId, department: link.department ?? "acting" }]])),
    issues: []
  };
}

test("ranks serious repairs before generic biographies and excludes optional-only profiles from the queue", () => {
  const generic = profile("person-generic", {
    biography: {
      texts: [
        { value: "人物资料来自 Wikidata；在《测试电影》中担任Actor。", language: "zh-CN", source: "notion", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["wikidata:Q2"], observedAt },
        { value: "This actor is documented in Wikidata and is credited as Actor.", language: "en", source: "notion", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["wikidata:Q2"], observedAt }
      ]
    }
  });
  const conflict = profile("person-conflict", { dataQuality: { status: "conflict", issues: ["external_id_conflict"], updatedAt: observedAt } });
  const optional = profile("person-optional", { profileImages: [] });
  const report = auditPeopleRepairCandidates(state([generic, conflict, optional], [
    { personId: generic.personId, workId: "work-1", department: "acting" },
    { personId: conflict.personId, workId: "work-2", department: "directing" }
  ]));

  assert.deepEqual(report.queue.map((candidate) => candidate.personId), ["person-conflict", "person-generic"]);
  assert.equal(report.queue[0]?.priority, "P0");
  assert.ok(report.queue[1]?.reasons.includes("generic_biography"));
  assert.equal(report.candidates.find((candidate) => candidate.personId === "person-optional")?.priority, "P3");
});

test("uses linked-work impact, creator bonus, and stable person id as deterministic tie breakers", () => {
  const actor = profile("person-b", { dataQuality: { status: "partial", issues: ["known_factual_error"], updatedAt: observedAt } });
  const creator = profile("person-a", { departments: ["directing"], dataQuality: { status: "partial", issues: ["known_factual_error"], updatedAt: observedAt } });
  const report = auditPeopleRepairCandidates(state([actor, creator], [
    { personId: actor.personId, workId: "work-1" },
    { personId: creator.personId, workId: "work-2", department: "directing" }
  ]));

  assert.equal(report.queue[0]?.personId, "person-a");
  assert.ok((report.queue[0]?.score ?? 0) > (report.queue[1]?.score ?? 0));
  assert.equal(report.queue[0]?.qualityPolicyVersion, "people-quality-v1");
});

test("surfaces a linked person id whose catalog profile is missing as P0", () => {
  const catalog = state([]);
  catalog.creditsByWorkId = {
    "work-orphan": [{ personId: "person-orphan", name: "遗失人物", department: "editing" }]
  };
  const report = auditPeopleRepairCandidates(catalog);

  assert.equal(report.queue[0]?.personId, "person-orphan");
  assert.equal(report.queue[0]?.priority, "P0");
  assert.deepEqual(report.queue[0]?.reasons, ["missing_catalog_profile"]);
  assert.equal(report.queue[0]?.qualityScore, 0);
});

test("does not use the immutable person id as a repair display name when Chinese name is absent", () => {
  const item = profile("person-patrick", {
    names: [
      { value: "Patrick Crowley", language: "en", kind: "display", source: "wikidata", status: "strong", observedAt }
    ],
    biography: { texts: [] },
    profileImages: []
  });
  const report = auditPeopleRepairCandidates(state([item]));

  assert.equal(report.queue[0]?.displayName, "Patrick Crowley");
  assert.notEqual(report.queue[0]?.displayName, item.personId);
});

test("uses the newest equally-ranked editorial biography after a repair", () => {
  const item = profile("person-refreshed", {
    biography: {
      texts: [
        { value: "人物资料来自 Wikidata；在《旧作品》中担任Actor。", language: "zh-CN", source: "notion", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["wikidata:Q2"], observedAt: "2026-08-01T00:00:00.000Z" },
        { value: "This actor is documented in Wikidata and is credited as Actor.", language: "en", source: "notion", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["wikidata:Q2"], observedAt: "2026-08-01T00:00:00.000Z" },
        { value: "这是一位长期从事电影与电视工作的创作者，早年从表演训练进入行业，后来在不同类型的作品中持续积累经验，并通过多次合作形成了稳定的职业方向。其代表作品覆盖商业制作与独立项目，能够在人物塑造、叙事节奏和类型表达之间建立清晰联系。", language: "zh-CN", source: "curated-review", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["wikidata:Q2", "imdb:nm2"], observedAt: "2026-08-31T00:00:00.000Z" },
        { value: "This screen professional has built a sustained career across film and television, moving from early performance training into varied projects and long-running collaborations. Their representative work spans commercial productions and independent films, showing a clear interest in character, narrative rhythm, and genre form. The career record reflects continuing development rather than a single isolated credit.", language: "en", source: "curated-review", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["wikidata:Q2", "imdb:nm2"], observedAt: "2026-08-31T00:00:00.000Z" }
      ]
    }
  });
  const report = auditPeopleRepairCandidates(state([item], [{ personId: item.personId, workId: "work-refreshed" }]));

  assert.equal(report.candidates.find((candidate) => candidate.personId === item.personId)?.reasons.includes("generic_biography"), false);
  assert.equal(report.candidates.find((candidate) => candidate.personId === item.personId)?.reasons.includes("short_zh_biography"), false);
  assert.equal(report.candidates.find((candidate) => candidate.personId === item.personId)?.reasons.includes("short_en_biography"), false);
});
