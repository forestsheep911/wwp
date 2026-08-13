import assert from "node:assert/strict";
import test from "node:test";
import type { PersonProfile } from "@wwpdw/shared";

import { ProviderRateLimiter } from "./person-sources/provider-http.js";
import { assertUniqueExternalIds, managedPeopleValues, NotionPeopleSource, notionPeopleProperties, notionPropertiesEqual } from "./notion-people-source.js";

function profile(): PersonProfile {
  const observedAt = "2026-08-10T00:00:00.000Z";
  return {
    personId: "person-a",
    names: [
      { value: "新中文名", language: "zh-cn", kind: "display", source: "wikidata", status: "strong", observedAt },
      { value: "English Name", language: "en", kind: "display", source: "imdb", status: "strong", observedAt }
    ],
    externalIds: { tmdb: "1", imdb: "nm0000001" },
    departments: ["acting"],
    biography: {
      source: "wikidata",
      texts: [
        { value: "数据源中文小传", language: "zh-CN", source: "wikidata", status: "strong", observedAt },
        { value: "Provider English biography", language: "en", source: "tmdb", status: "strong", observedAt }
      ]
    },
    sourceRefs: [{ source: "wikidata", id: "Q1", observedAt }],
    dataQuality: { status: "partial", updatedAt: observedAt },
    createdAt: observedAt,
    updatedAt: observedAt
  };
}

test("preserves independently locked editorial biography fields, hide state, and memo", () => {
  const values = managedPeopleValues(profile(), {
    personId: "person-a",
    lockedFields: ["chineseName", "biographyZh"],
    chineseName: "编辑锁定名",
    biographyZh: "编辑中文简介",
    biographyZhMethod: "editorial-rewrite",
    sources: "douban:1\nwikidata:Q1",
    hideFromWebsite: true,
    developerMemo: "同名人物，注意核对"
  });
  assert.equal(values.name, "编辑锁定名");
  assert.equal(values.chineseName, "编辑锁定名");
  assert.equal(values.biographyZh, "编辑中文简介");
  assert.equal(values.biographyZhMethod, "editorial-rewrite");
  assert.equal(values.sources, "douban:1\nwikidata:Q1");
  assert.equal(values.biographyEn, "Provider English biography");
  assert.equal(values.hideFromWebsite, true);
  assert.equal(values.developerMemo, "同名人物，注意核对");
  assert.equal(notionPeopleProperties(values)["Person ID"].rich_text[0].text.content, "person-a");
  assert.equal(notionPeopleProperties(values)["Biography ZH"].rich_text[0].text.content, "编辑中文简介");
  assert.equal(notionPeopleProperties(values)["Biography ZH Method"].select?.name, "editorial-rewrite");
  const sourceParts = notionPeopleProperties(values).Sources.rich_text;
  assert.equal(sourceParts.filter((part) => part.text.link).length, 0);
});

test("refuses to mutate immutable Person ID", () => {
  assert.throws(() => managedPeopleValues(profile(), { personId: "person-b", lockedFields: [] }), /immutable/);
});

test("stores shared biography sources as multiple clickable URLs", () => {
  const values = managedPeopleValues({
    ...profile(),
    sourceRefs: [
      { source: "external", url: "https://example.org/profile", observedAt: "2026-08-10T00:00:00.000Z" },
      { source: "external", url: "https://example.net/interview", observedAt: "2026-08-10T00:00:00.000Z" }
    ]
  });
  assert.equal(values.sources, "https://example.org/profile\nhttps://example.net/interview");
  const links = notionPeopleProperties(values).Sources.rich_text
    .map((part) => part.text.link?.url)
    .filter(Boolean);
  assert.deepEqual(links, ["https://example.org/profile", "https://example.net/interview"]);
});

test("treats equivalent Notion timestamp serializations as equal", () => {
  assert.equal(notionPropertiesEqual(
    { "Last Enriched At": { date: { start: "2026-08-10T06:05:00.000+00:00" } } },
    { "Last Enriched At": { date: { start: "2026-08-10T06:05:39.510Z" } } }
  ), true);
});

test("rejects external identifiers assigned to multiple people", () => {
  assert.throws(() => assertUniqueExternalIds([profile(), { ...profile(), personId: "person-b" }]), /belongs to both/);
});

test("creates once, reads back, and becomes unchanged on replay", async () => {
  let page: { id: string; properties: Record<string, unknown> } | undefined;
  let creates = 0;
  let updates = 0;
  const client = {
    dataSources: { query: async () => ({ results: page ? [page] : [], has_more: false }) },
    pages: {
      create: async (input: Record<string, unknown>) => {
        creates += 1;
        page = { id: "page-a", properties: input.properties as Record<string, unknown> };
        return page;
      },
      update: async (input: Record<string, unknown>) => {
        updates += 1;
        page = { id: String(input.page_id), properties: input.properties as Record<string, unknown> };
        return page;
      },
      retrieve: async () => page!
    }
  };
  const source = new NotionPeopleSource(client, "people-source", new ProviderRateLimiter(0));
  assert.equal((await source.upsert(profile())).action, "created");
  assert.equal((await source.upsert(profile())).action, "unchanged");
  assert.equal(creates, 1);
  assert.equal(updates, 0);
});

test("refuses duplicate Person ID rows before writing", async () => {
  const row = { id: "page-a", properties: { "Person ID": { rich_text: [{ plain_text: "person-a" }] } } };
  const source = new NotionPeopleSource({
    dataSources: { query: async () => ({ results: [row, { ...row, id: "page-b" }] }) },
    pages: { create: async () => { throw new Error("unexpected"); }, update: async () => { throw new Error("unexpected"); }, retrieve: async () => row }
  }, "people-source", new ProviderRateLimiter(0));
  await assert.rejects(source.upsert(profile()), /Duplicate Notion People rows/);
});

test("lists incrementally edited People rows with pagination and one shared query shape", async () => {
  const inputs: Record<string, unknown>[] = [];
  const pages = [
    { id: "page-a", last_edited_time: "2026-08-10T01:00:00.000Z", properties: notionPeopleProperties(managedPeopleValues(profile())) },
    { id: "page-b", last_edited_time: "2026-08-10T02:00:00.000Z", properties: notionPeopleProperties(managedPeopleValues({ ...profile(), personId: "person-b" })) }
  ];
  const source = new NotionPeopleSource({
    dataSources: { query: async (input) => {
      inputs.push(input);
      return inputs.length === 1
        ? { results: [pages[0]], has_more: true, next_cursor: "next" }
        : { results: [pages[1]], has_more: false };
    } },
    pages: { create: async () => pages[0], update: async () => pages[0], retrieve: async () => pages[0] }
  }, "people-source", new ProviderRateLimiter(0));
  const rows = await source.listChanged({ since: "2026-08-10T00:00:00.000Z", pageSize: 1 });
  assert.equal(rows.length, 2);
  assert.equal("personId" in rows[1] ? rows[1].personId : undefined, "person-b");
  assert.deepEqual(inputs[0].filter, { timestamp: "last_edited_time", last_edited_time: { on_or_after: "2026-08-10T00:00:00.000Z" } });
  assert.equal(inputs[1].start_cursor, "next");
});

test("returns malformed rows for quarantine instead of aborting the batch", async () => {
  const page = { id: "bad", last_edited_time: "2026-08-10T01:00:00.000Z", properties: {} };
  const source = new NotionPeopleSource({
    dataSources: { query: async () => ({ results: [page], has_more: false }) },
    pages: { create: async () => page, update: async () => page, retrieve: async () => page }
  }, "people-source", new ProviderRateLimiter(0));
  const rows = await source.listChanged();
  assert.match("error" in rows[0] ? rows[0].error : "", /missing immutable Person ID/);
});
