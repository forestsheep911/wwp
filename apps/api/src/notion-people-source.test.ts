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
  assert.equal(typeof values.qualityScore, "number");
  assert.equal(notionPeopleProperties(values)["Person ID"].rich_text[0].text.content, "person-a");
  assert.equal(notionPeopleProperties(values)["Quality Score"].number, values.qualityScore);
  assert.equal(notionPeopleProperties(values)["Biography ZH"].rich_text[0].text.content, "编辑中文简介");
  assert.equal(notionPeopleProperties(values)["Biography ZH Method"].select?.name, "editorial-rewrite");
  const sourceParts = notionPeopleProperties(values).Sources.rich_text;
  assert.equal(sourceParts.filter((part) => part.text.link).length, 0);
});

test("does not replace an unlocked verified editorial biography with a weak provider summary", () => {
  const values = managedPeopleValues(profile(), {
    personId: "person-a",
    lockedFields: [],
    biographyZh: "这是一份已经由编辑核实并发布的完整中文人物小传，内容覆盖人物的职业阶段、主要合作、代表作品和创作贡献，也经过两个独立来源家族的交叉核对。它不应因为后来处理另一部作品时生成的简短职务说明而被覆盖，既有编辑成果必须继续作为权威版本保留。",
    biographyZhStatus: "verified",
    biographyZhMethod: "editorial-rewrite",
    biographyEn: "This is an established editorial biography covering the person's career stages, major collaborations, representative works, and creative contribution. It has already been checked against two independent source families and must remain authoritative when a later work-discovery pass offers only a short provider summary without comparable editorial review or supporting evidence.",
    biographyEnStatus: "verified",
    biographyEnMethod: "editorial-rewrite",
    sources: "douban:1\nwikidata:Q1"
  });
  assert.match(values.biographyZh ?? "", /已经由编辑核实/);
  assert.match(values.biographyEn ?? "", /established editorial biography/);
  assert.equal(values.biographyZhStatus, "verified");
  assert.equal(values.biographyEnStatus, "verified");
});

test("allows a fully reviewed substantive biography to replace an unlocked editorial version", () => {
  const observedAt = "2026-08-30T00:00:00.000Z";
  const incomingZh = "这位演员早年从舞台和独立电影进入行业，随后在家庭剧、社会题材和商业制作之间持续工作，并通过对身体状态、语气和日常动作的细致控制形成具有辨识度的表演方法。其职业生涯包含多个阶段，也包括与重要导演和固定创作团队的反复合作；多部代表作品显示出她处理脆弱、幽默和人物韧性的能力。";
  const incomingEn = "This actor began in stage and independent work before building a career across family drama, socially engaged cinema, and commercial production. Careful control of physical behavior, speech, and everyday gesture became central to a recognizable performance method. The career spans several stages and recurring collaborations with important directors, while representative works show an unusual ability to combine vulnerability, humor, and resilience.";
  const values = managedPeopleValues({
    ...profile(),
    biography: { texts: [
      { value: incomingZh, language: "zh-CN", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["douban:1", "wikidata:Q1"], observedAt },
      { value: incomingEn, language: "en", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["douban:1", "wikidata:Q1"], observedAt }
    ] }
  }, {
    personId: "person-a",
    lockedFields: [],
    biographyZh: "原有中文编辑稿。",
    biographyZhStatus: "verified",
    biographyZhMethod: "editorial-rewrite",
    biographyEn: "Previous editorial biography.",
    biographyEnStatus: "verified",
    biographyEnMethod: "editorial-rewrite",
    sources: "douban:1\nwikidata:Q1"
  });
  assert.equal(values.biographyZh, incomingZh);
  assert.equal(values.biographyEn, incomingEn);
});

test("selects a quality-eligible reviewed biography ahead of an earlier short verified text", () => {
  const observedAt = "2026-08-30T00:00:00.000Z";
  const incomingZh = "这位演员早年从舞台和独立电影进入行业，随后在家庭剧、社会题材和商业制作之间持续工作，并通过对身体状态、语气和日常动作的细致控制形成具有辨识度的表演方法。其职业生涯包含多个阶段，也包括与重要导演和固定创作团队的反复合作；多部代表作品显示出她处理脆弱、幽默和人物韧性的能力。";
  const incomingEn = "This actor began in stage and independent work before building a career across family drama, socially engaged cinema, and commercial production. Careful control of physical behavior, speech, and everyday gesture became central to a recognizable performance method. The career spans several stages and recurring collaborations with important directors, while representative works show an unusual ability to combine vulnerability, humor, and resilience.";
  const values = managedPeopleValues({
    ...profile(),
    biography: { texts: [
      { value: "演员。", language: "zh-CN", source: "notion", status: "verified", method: "editorial-rewrite", observedAt },
      { value: "Actor.", language: "en", source: "notion", status: "verified", method: "editorial-rewrite", observedAt },
      { value: incomingZh, language: "zh-CN", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["douban:1", "wikidata:Q1"], observedAt },
      { value: incomingEn, language: "en", source: "manual", status: "verified", method: "editorial-rewrite", supportingSourceRefs: ["douban:1", "wikidata:Q1"], observedAt }
    ] }
  });
  assert.equal(values.biographyZh, incomingZh);
  assert.equal(values.biographyEn, incomingEn);
  assert.equal(values.biographyZhStatus, "verified");
  assert.equal(values.biographyEnStatus, "verified");
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

test("writes and reads quality score and the dedicated review timestamp", () => {
  const reviewed = "2026-08-30T03:00:00.000Z";
  const values = managedPeopleValues({
    ...profile(),
    dataQuality: { ...profile().dataQuality, reviewedAt: reviewed }
  });
  const properties = notionPeopleProperties(values);
  assert.equal(properties["Quality Score"].number, values.qualityScore);
  assert.equal(properties["Last Reviewed At"].date?.start, reviewed);
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

test("preflights a whole batch against existing Notion external IDs before writing", async () => {
  const existing = {
    id: "page-existing",
    properties: notionPeopleProperties(managedPeopleValues({ ...profile(), personId: "person-existing" }))
  };
  let writes = 0;
  const source = new NotionPeopleSource({
    dataSources: { query: async () => ({ results: [existing], has_more: false }) },
    pages: {
      create: async () => { writes += 1; return existing; },
      update: async () => { writes += 1; return existing; },
      retrieve: async () => existing
    }
  }, "people-source", new ProviderRateLimiter(0));
  await assert.rejects(
    source.assertBatchIdentitySafety([{ ...profile(), personId: "person-incoming" }]),
    /would duplicate Notion People row page-existing/
  );
  assert.equal(writes, 0);
});

test("reuses one batch identity scan for subsequent upserts", async () => {
  const profiles = [profile(), { ...profile(), personId: "person-b", externalIds: { tmdb: "2", imdb: "nm0000002" } }];
  const pages = new Map<string, { id: string; properties: Record<string, unknown> }>();
  let fullScans = 0;
  const client = {
    dataSources: { query: async (input: Record<string, any>) => {
      if (!input.filter) {
        fullScans += 1;
        return { results: [...pages.values()], has_more: false };
      }
      const personId = input.filter.rich_text.equals;
      return { results: [...pages.values()].filter((page) => (page.properties["Person ID"] as any)?.rich_text?.[0]?.text?.content === personId), has_more: false };
    } },
    pages: {
      create: async (input: Record<string, unknown>) => {
        const page = { id: `page-${pages.size + 1}`, properties: input.properties as Record<string, unknown> };
        pages.set(page.id, page);
        return page;
      },
      update: async (input: Record<string, unknown>) => pages.get(String(input.page_id))!,
      retrieve: async (input: Record<string, unknown>) => pages.get(String(input.page_id))!
    }
  };
  const source = new NotionPeopleSource(client, "people-source", new ProviderRateLimiter(0));
  await source.assertBatchIdentitySafety(profiles);
  await source.upsert(profiles[0]);
  await source.upsert(profiles[1]);
  assert.equal(fullScans, 1);
});

test("reports unrelated historical duplicates without blocking a clean incoming batch", async () => {
  const duplicateA = { id: "page-old-a", properties: notionPeopleProperties(managedPeopleValues(profile())) };
  const duplicateB = { id: "page-old-b", properties: notionPeopleProperties(managedPeopleValues({ ...profile(), personId: "person-duplicate" })) };
  const incoming = { ...profile(), personId: "person-clean", externalIds: { tmdb: "99", imdb: "nm0000099" } };
  const source = new NotionPeopleSource({
    dataSources: { query: async () => ({ results: [duplicateA, duplicateB], has_more: false }) },
    pages: { create: async () => duplicateA, update: async () => duplicateA, retrieve: async () => duplicateA }
  }, "people-source", new ProviderRateLimiter(0));
  const result = await source.assertBatchIdentitySafety([incoming]);
  assert.equal(result.existingConflictCount, 2);
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

test("lists targeted People rows by immutable Person ID without scanning the data source", async () => {
  const inputs: Record<string, unknown>[] = [];
  const page = { id: "page-a", last_edited_time: "2026-08-31T14:47:00.000Z", properties: notionPeopleProperties(managedPeopleValues(profile())) };
  const source = new NotionPeopleSource({
    dataSources: { query: async (input) => { inputs.push(input); return { results: [page], has_more: false }; } },
    pages: { create: async () => page, update: async () => page, retrieve: async () => page }
  }, "people-source", new ProviderRateLimiter(0));
  const rows = await source.listChanged({ personIds: ["person-a", "person-a"] });
  assert.equal(rows.length, 1);
  assert.deepEqual(inputs, [{
    data_source_id: "people-source",
    filter: { property: "Person ID", rich_text: { equals: "person-a" } },
    page_size: 3
  }]);
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
