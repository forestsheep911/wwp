import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult } from "@wwpdw/shared";
import { auditPeopleWorkCoverage } from "./people-work-coverage-audit.js";

function result(workId: string, title: string, credits: NonNullable<SearchResult["metadata"]>["credits"]): SearchResult {
  return {
    assetKey: `asset-${workId}`,
    title,
    source: "test",
    sourceUrl: "https://example.test",
    durationLabel: "",
    updatedAt: "2026-08-21T00:00:00.000Z",
    summary: "",
    metadata: {
      workId,
      externalIds: { imdb: `tt${workId}` },
      credits
    }
  };
}

test("classifies work credit and person-link coverage", () => {
  const report = auditPeopleWorkCoverage([
    result("1", "No credits", []),
    result("2", "Names only", [{ name: "A", department: "acting" }]),
    result("3", "Partial", [
      { personId: "person-a", name: "A", department: "directing" },
      { name: "B", department: "acting" }
    ]),
    result("4", "Complete", [{ personId: "person-c", name: "C", department: "writing" }])
  ]);

  assert.deepEqual(report.summary, {
    missing_credits: 1,
    unlinked_only: 1,
    partially_linked: 1,
    fully_linked: 1
  });
  assert.deepEqual(report.candidates.map((work) => work.workId), ["1", "2", "3"]);
  assert.equal(report.works.find((work) => work.workId === "3")?.unlinkedCreditCount, 1);
});

test("deduplicates repeated search results by stable work id and keeps the richer credit set", () => {
  const report = auditPeopleWorkCoverage([
    result("1", "First", []),
    result("1", "First", [{ personId: "person-a", name: "A", department: "directing" }])
  ]);

  assert.equal(report.totalWorks, 1);
  assert.equal(report.works[0]?.status, "fully_linked");
});

test("deduplicates legacy carriers by same movie IMDb and keeps the active richer work", () => {
  const legacy = result("legacy", "【仅供下载】同一部电影 (2020)", []);
  legacy.metadata!.work = {
    workId: "legacy",
    kind: "movie",
    titles: [{ title: "【仅供下载】同一部电影 (2020)", kind: "primary", source: "manual" }],
    externalIds: { imdb: "tt1234567" },
    release: { year: "2020" },
    credits: [],
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const active = result("active", "同一部电影 (2020)", [{ personId: "person-a", name: "A", department: "directing" }]);
  active.metadata!.work = {
    workId: "active",
    kind: "movie",
    titles: [{ title: "同一部电影 (2020)", kind: "primary", source: "manual" }],
    externalIds: { imdb: "tt1234567" },
    release: { year: "2020" },
    credits: [{ personId: "person-a", name: "A", department: "directing" }],
    updatedAt: "2026-08-21T00:00:00.000Z"
  };

  const report = auditPeopleWorkCoverage([legacy, active]);

  assert.equal(report.totalWorks, 1);
  assert.equal(report.works[0]?.workId, "active");
  assert.equal(report.works[0]?.status, "fully_linked");
});

test("expands unlinked slash-delimited historical credits before coverage is assessed", () => {
  const report = auditPeopleWorkCoverage([
    result("slash", "Historical import", [
      { name: "Director A / Director B", department: "directing" },
      { personId: "person-c", name: "Actor C", department: "acting" }
    ])
  ]);

  const work = report.works[0];
  assert.equal(work?.creditCount, 3);
  assert.equal(work?.linkedCreditCount, 1);
  assert.equal(work?.unlinkedCreditCount, 2);
  assert.deepEqual(work?.unlinkedCredits.map((credit) => credit.name), ["Director A", "Director B"]);
});
