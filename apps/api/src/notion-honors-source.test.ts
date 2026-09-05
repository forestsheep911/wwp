import assert from "node:assert/strict";
import test from "node:test";
import type { WorkHonorRecord } from "./work-honor.js";
import { NotionHonorsSource, notionHonorMismatches, notionHonorProperties } from "./notion-honors-source.js";

const record: WorkHonorRecord = {
  honorId: "honor_test_winner",
  workId: "wwm_test",
  awardingBody: "Test Academy",
  eventName: "Test Awards",
  editionYear: 2026,
  category: "Documentary Feature",
  result: "winner",
  recipients: ["work"],
  sourceRefs: [{ url: "https://example.test/award", authority: "official", observedAt: "2026-09-05T00:00:00.000Z" }],
  status: "verified",
  checkedAt: "2026-09-05T00:00:00.000Z"
};

test("creates once, reads back, and becomes unchanged on replay", async () => {
  let page: { id: string; properties: Record<string, unknown> } | undefined;
  let writes = 0;
  const client = {
    dataSources: { async query() { return { results: page ? [page] : [] }; } },
    pages: {
      async create(input: any) { writes += 1; page = { id: "honor-page", properties: input.properties }; return { id: page.id }; },
      async update(input: any) { writes += 1; page = { id: input.page_id, properties: input.properties }; return { id: page.id }; },
      async retrieve() { return page!; }
    }
  };
  const source = new NotionHonorsSource(client, "honors-source", (operation) => operation());
  assert.equal((await source.upsert(record, "work-page")).action, "created");
  assert.equal((await source.upsert(record, "work-page")).action, "unchanged");
  assert.equal(writes, 1);
});

test("maps result, work relation, sources, and checked time", () => {
  const properties = notionHonorProperties(record, "work-page");
  assert.deepEqual(properties.Work.relation, [{ id: "work-page" }]);
  assert.equal(properties.Result.select.name, "winner");
  assert.equal(properties["Checked At"].date.start, record.checkedAt);
  assert.equal(properties.Sources.rich_text[0].text.link?.url, record.sourceRefs[0].url);
});

test("treats equivalent Notion date timezone serializations as equal", () => {
  const expected = notionHonorProperties(record, "work-page");
  const actual = structuredClone(expected) as any;
  actual["Checked At"].date.start = "2026-09-05T00:00:00.000+00:00";
  assert.deepEqual(notionHonorMismatches(actual, expected), []);
});
