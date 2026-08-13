import assert from "node:assert/strict";
import test from "node:test";
import type { PersonCatalogState, SearchResult } from "@wwpdw/shared";
import { applyPersonCreditNameSync, planPersonCreditNameSync } from "./person-credit-name-sync.js";

const personId = "person_12345678-1234-4123-8123-123456789abc";

test("propagates a reviewed People display name to catalog and movie index credits", () => {
  const catalog = fixtureCatalog();
  const results = [fixtureResult()];
  const plan = planPersonCreditNameSync(catalog, results, "2026-08-14T10:00:00.000Z");
  assert.deepEqual(plan.summary, { affectedWorkCount: 1, searchIndexWrites: 1, catalogChanged: true });
  assert.equal(plan.nextCatalog.creditsByWorkId.work_1[0].name, "新姓名");
  assert.equal(plan.nextCatalog.creditsByPersonId[personId][0].name, "新姓名");
  assert.equal(plan.updatedResults[0].metadata?.work?.credits?.[0].name, "新姓名");
  assert.deepEqual(plan.updatedResults[0].metadata?.directors, ["新姓名", "未链接导演"]);
  assert.equal(plan.updatedResults[0].metadata?.display?.directorLine, "新姓名 / 未链接导演");
});

test("rolls movie-index names back if catalog publication fails", async () => {
  const plan = planPersonCreditNameSync(fixtureCatalog(), [fixtureResult()]);
  const writes: SearchResult[][] = [];
  await assert.rejects(() => applyPersonCreditNameSync({
    plan,
    searchStore: { async upsertResults(results) { writes.push(structuredClone(results)); } },
    personStore: { async replaceState() { throw new Error("catalog failed"); } }
  }), /catalog failed/);
  assert.equal(writes.length, 2);
  assert.equal(writes[0][0].metadata?.work?.credits?.[0].name, "新姓名");
  assert.equal(writes[1][0].metadata?.work?.credits?.[0].name, "旧姓名");
});

function fixtureCatalog(): PersonCatalogState {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-14T09:00:00.000Z",
    people: {
      [personId]: {
        profile: {
          personId,
          names: [{
            value: "新姓名",
            language: "zh-CN",
            kind: "display",
            source: "notion",
            status: "verified",
            observedAt: "2026-08-14T09:00:00.000Z"
          }],
          dataQuality: { status: "partial", updatedAt: "2026-08-14T09:00:00.000Z" },
          createdAt: "2026-08-14T09:00:00.000Z",
          updatedAt: "2026-08-14T09:00:00.000Z"
        },
        workIds: ["work_1"],
        updatedAt: "2026-08-14T09:00:00.000Z"
      }
    },
    redirects: {},
    externalIdIndex: { tmdb: {}, imdb: {}, wikidata: {} },
    aliasIndex: {},
    creditsByWorkId: { work_1: [{ personId, name: "旧姓名", department: "directing" }] },
    creditsByPersonId: { [personId]: [{ personId, name: "旧姓名", department: "directing", workId: "work_1" }] },
    issues: []
  };
}

function fixtureResult(): SearchResult {
  return {
    assetKey: "asset_1",
    title: "作品",
    source: "notion",
    sourceUrl: "https://example.test/work",
    durationLabel: "120 分钟",
    summary: "测试作品",
    updatedAt: "2026-08-14T09:00:00.000Z",
    metadata: {
      directors: ["旧姓名", "未链接导演"],
      display: { directorLine: "旧姓名 / 未链接导演" },
      credits: [{ personId, name: "旧姓名", department: "directing" }],
      work: {
        workId: "work_1",
        kind: "movie",
        titles: [{ title: "作品", kind: "primary", source: "notion" }],
        credits: [{ personId, name: "旧姓名", department: "directing" }],
        display: { directorLine: "旧姓名 / 未链接导演" },
        updatedAt: "2026-08-14T09:00:00.000Z"
      }
    }
  };
}
