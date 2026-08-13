import assert from "node:assert/strict";
import test from "node:test";
import { emptyPersonCatalogState } from "@wwpdw/cache-store";
import type { PersonProfile, SearchResult } from "@wwpdw/shared";
import { applyPersonCatalogPlan, planReviewedPeopleReportApply, type ReviewedPeopleReport } from "./person-catalog-apply.js";

const personId = "person_123e4567-e89b-42d3-a456-426614174000";
const profile: PersonProfile = {
  personId,
  names: [{ value: "张三", kind: "display", source: "tmdb", status: "verified", observedAt: "2026-08-10T00:00:00.000Z" }],
  externalIds: { tmdb: "10" },
  dataQuality: { status: "verified", updatedAt: "2026-08-10T00:00:00.000Z" },
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z"
};

function result(workId: string, title = workId): SearchResult {
  return {
    assetKey: `asset-${workId}`, title, source: "notion", sourceUrl: "https://example.test", durationLabel: "1h",
    updatedAt: "2026-08-01T00:00:00.000Z", summary: "",
    metadata: { work: { workId, kind: "movie", titles: [{ title, kind: "primary", source: "manual" }], updatedAt: "2026-08-01T00:00:00.000Z" } }
  };
}

function report(): ReviewedPeopleReport {
  return {
    generatedAt: "2026-08-10T00:00:00.000Z", proposedProfiles: [profile], identityIssues: [], unresolved: [],
    proposedCredits: [{ workId: "work-1", title: "作品一", credits: [{ personId, name: "张三", department: "directing", job: "Director", source: "tmdb" }] }]
  };
}

test("plans one affected work while retaining unrelated catalog data", () => {
  const current = emptyPersonCatalogState("2026-08-01T00:00:00.000Z");
  current.creditsByWorkId["work-2"] = [];
  const untouched = result("work-2");
  const plan = planReviewedPeopleReportApply(current, [result("work-1"), untouched], report(), "2026-08-10T01:00:00.000Z");
  assert.equal(plan.updatedResults.length, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].personId, personId);
  assert.equal(plan.nextCatalog.creditsByPersonId[personId][0].workTitle, "作品一");
  assert.ok(plan.nextCatalog.creditsByWorkId["work-2"]);
  assert.equal(untouched.metadata?.work?.credits, undefined);
});

test("keeps unlinked cast relations in the work while indexing only materialized people", () => {
  const pilot = report();
  pilot.proposedCredits[0].credits.push({
    name: "待补演员",
    department: "acting",
    job: "Actor",
    character: "配角",
    source: "wikidata",
    externalIds: { wikidata: "Q99" }
  });
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], pilot);
  assert.equal(plan.summary.linkedCreditCount, 1);
  assert.equal(plan.summary.unlinkedCreditCount, 1);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.length, 2);
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[1].personId, undefined);
  assert.equal(plan.nextCatalog.creditsByWorkId["work-1"].length, 1);
});

test("rejects missing search work and unresolved identity issues before writes", () => {
  assert.throws(() => planReviewedPeopleReportApply(emptyPersonCatalogState(), [], report()), /exactly one search result/);
  const unsafe = report();
  unsafe.identityIssues.push({ kind: "external_id_conflict", message: "conflict", personIds: [personId] });
  assert.throws(() => planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], unsafe), /identity issue/);
});

test("rolls search index back when catalog replacement fails", async () => {
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], report());
  const writes: SearchResult[][] = [];
  await assert.rejects(() => applyPersonCatalogPlan({
    plan,
    searchStore: { async upsertResults(values) { writes.push(structuredClone(values)); } },
    personStore: { async replaceState() { throw new Error("catalog failed"); } }
  }), /catalog failed/);
  assert.equal(writes.length, 2);
  assert.equal(writes[0][0].metadata?.work?.credits?.[0].personId, personId);
  assert.equal(writes[1][0].metadata?.work?.credits, undefined);
});

test("empty plan performs no writes", async () => {
  const plan = planReviewedPeopleReportApply(emptyPersonCatalogState(), [], {
    generatedAt: "2026-08-10T00:00:00.000Z", proposedProfiles: [], proposedCredits: [], identityIssues: []
  });
  let writes = 0;
  await applyPersonCatalogPlan({ plan, searchStore: { async upsertResults() { writes += 1; } }, personStore: { async replaceState() { writes += 1; } } });
  assert.equal(writes, 0);
});

test("replaying an already applied report performs no writes", async () => {
  const first = planReviewedPeopleReportApply(emptyPersonCatalogState(), [result("work-1")], report(), "2026-08-10T01:00:00.000Z");
  const appliedResult = first.updatedResults[0];
  const replay = planReviewedPeopleReportApply(first.nextCatalog, [appliedResult], report(), "2026-08-10T02:00:00.000Z");
  assert.equal(replay.summary.catalogChanged, false);
  assert.equal(replay.updatedResults.length, 0);
  let writes = 0;
  await applyPersonCatalogPlan({ plan: replay, searchStore: { async upsertResults() { writes += 1; } }, personStore: { async replaceState() { writes += 1; } } });
  assert.equal(writes, 0);
});
