import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";

type JsonRecord = Record<string, unknown>;

interface FamilyAgeOptions {
  apply: boolean;
  limit: number;
  maxUpdates: number;
  pageSize: number;
  delayMs: number;
  query?: string;
  pageId?: string;
  reportPath?: string;
  dataSourceId?: string;
  databaseId?: string;
  rootPageId?: string;
}

interface LibraryMetadata {
  dataSourceId: string;
  titleProperty?: string;
  properties: JsonRecord;
}

interface FamilyAgePayload {
  minimumAge: number;
  confidence: "high" | "medium" | "low";
  riskTags: string[];
  reason: string;
  needsReview?: boolean;
}

interface PagePlan {
  pageId: string;
  title: string;
  url?: string;
  updates: Record<string, unknown>;
  updateFields: string[];
  ai?: FamilyAgePayload;
  skipped?: string;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const rootPageId = process.env.NOTION_LIBRARY_ROOT_PAGE_ID ?? process.env.PAGE_ID;
const configuredDataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const configuredDatabaseId = process.env.NOTION_LIBRARY_DATABASE_ID ?? process.env.NOTION_MEDIA_DATABASE_ID;
const notionRequestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);
const aiRequestTimeoutMs = Number(process.env.WWPDW_AI_FAMILY_AGE_TIMEOUT_MS ?? process.env.WWPDW_AI_SUMMARY_TIMEOUT_MS ?? 45000);
let notionDnsOverrideInstalled = false;

const allowedRiskTags = new Set([
  "暴力",
  "血腥",
  "恐怖",
  "性/裸露",
  "脏话",
  "毒品",
  "自杀自伤",
  "战争",
  "歧视/仇恨",
  "成人主题",
  "儿童友好",
  "需人工复核"
]);

function installNotionDnsOverride() {
  const notionApiIp = process.env.NOTION_API_RESOLVE_IP?.trim();
  if (!notionApiIp || notionDnsOverrideInstalled) return;
  const originalLookup = dns.lookup.bind(dns) as (...args: unknown[]) => unknown;
  dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") {
        options(null, notionApiIp, 4);
        return;
      }
      if (typeof callback === "function") {
        if (options && typeof options === "object" && "all" in options && options.all) {
          callback(null, [{ address: notionApiIp, family: 4 }]);
          return;
        }
        callback(null, notionApiIp, 4);
        return;
      }
    }
    return originalLookup(hostname, options, callback);
  }) as typeof dns.lookup;
  notionDnsOverrideInstalled = true;
  console.log(`dns override: api.notion.com -> ${notionApiIp}`);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractNotionId(value: string) {
  const compact = value.match(/([0-9a-f]{32})/i)?.[1];
  if (compact) {
    return [
      compact.slice(0, 8),
      compact.slice(8, 12),
      compact.slice(12, 16),
      compact.slice(16, 20),
      compact.slice(20)
    ].join("-");
  }
  return value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}

function parseArgs(): FamilyAgeOptions {
  const args = process.argv.slice(2);
  const has = (name: string) => args.includes(name);
  const value = (name: string, fallback: string) => {
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };

  return {
    apply: has("--apply"),
    limit: Math.max(1, Math.floor(Number(value("--limit", "20")))),
    maxUpdates: Math.max(1, Math.floor(Number(value("--max-updates", "5")))),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(value("--page-size", "50"))))),
    delayMs: Math.max(0, Math.floor(Number(value("--delay-ms", "300")))),
    query: value("--query", "").trim() || undefined,
    pageId: extractNotionId(value("--page-id", "") || value("--page-url", "")) ?? undefined,
    reportPath: value("--report", "").trim() || undefined,
    dataSourceId: extractNotionId(value("--data-source-id", "")) ?? undefined,
    databaseId: extractNotionId(value("--database-id", "")) ?? undefined,
    rootPageId: extractNotionId(value("--root-page-id", "")) ?? undefined
  };
}

function richTextPlain(value: unknown) {
  return asArray(value)
    .map((item) => asString(asRecord(item)?.plain_text))
    .filter(Boolean)
    .join("");
}

function propertyText(value: unknown) {
  const property = asRecord(value);
  if (!property) return "";
  const type = asString(property.type);
  if (type === "title" || type === "rich_text") return richTextPlain(property[type]);
  if (type === "url") return asString(property.url);
  if (type === "number") return typeof property.number === "number" ? `${property.number}` : "";
  if (type === "date") return asString(asRecord(property.date)?.start);
  if (type === "checkbox") return typeof property.checkbox === "boolean" ? String(property.checkbox) : "";
  if (type === "select" || type === "status") return asString(asRecord(property[type])?.name);
  if (type === "multi_select") {
    return asArray(property.multi_select).map((item) => asString(asRecord(item)?.name)).filter(Boolean).join(" ");
  }
  return "";
}

function richText(content: string) {
  const chunks = content.match(/[\s\S]{1,1900}/g) ?? [""];
  return chunks.map((chunk) => ({ type: "text", text: { content: chunk } }));
}

function pagePropertyValue(name: string, value: unknown) {
  if (name === "AI建议最低年龄" || name === "人工年龄覆盖") {
    const number = Number(value);
    return Number.isFinite(number) ? { number } : undefined;
  }
  if (name === "AI年龄建议置信度") return value ? { select: { name: String(value) } } : undefined;
  if (name === "内容风险标签") {
    const values = Array.isArray(value) ? value : [];
    return values.length > 0 ? { multi_select: values.map((item) => ({ name: String(item) })) } : undefined;
  }
  if (name === "AI年龄建议理由") return value ? { rich_text: richText(String(value)) } : undefined;
  return undefined;
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      const title = richTextPlain(record.title);
      if (title) return title;
    }
  }
  return "Untitled Notion page";
}

function hasPropertyValue(properties: JsonRecord, name: string) {
  return Boolean(propertyText(properties[name]));
}

function responseText(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;
  if (typeof record.output_text === "string") return record.output_text;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const message = asRecord(asRecord(choices[0])?.message);
  if (typeof message?.content === "string") return message.content;
  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    const content = asRecord(item)?.content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      const text = asRecord(contentItem)?.text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n").trim() || undefined;
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned) as unknown;
}

function aiConfig() {
  const usableKey = (value: string | undefined) => {
    const cleaned = value?.trim();
    if (!cleaned || cleaned === "1234" || /^replace[-_]?me$/i.test(cleaned)) return undefined;
    return cleaned;
  };
  const openAiApiKey = usableKey(process.env.OPENAI_API_KEY);
  const bailianApiKey = usableKey(process.env.BAILIAN_API_KEY) ?? usableKey(process.env.DASHSCOPE_API_KEY);
  const usesBailian = !openAiApiKey && Boolean(bailianApiKey);
  const apiKey = openAiApiKey ?? bailianApiKey;
  const model = (
    process.env.WWPDW_AI_FAMILY_AGE_MODEL ??
    process.env.WWPDW_AI_SUMMARY_MODEL ??
    process.env.OPENAI_MODEL ??
    process.env.BAILIAN_MODEL ??
    process.env.DASHSCOPE_MODEL ??
    (usesBailian ? "qwen-plus" : "gpt-4.1-mini")
  ).trim();
  const baseUrl = (
    process.env.WWPDW_AI_FAMILY_AGE_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    process.env.BAILIAN_BASE_URL ??
    process.env.DASHSCOPE_BASE_URL ??
    (usesBailian ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : "https://api.openai.com/v1")
  ).replace(/\/$/, "");
  const apiKind = process.env.WWPDW_AI_FAMILY_AGE_API_KIND?.trim() || (usesBailian ? "chat" : "responses");
  const apiUrl = process.env.WWPDW_AI_FAMILY_AGE_API_URL?.trim() || `${baseUrl}/${apiKind === "chat" ? "chat/completions" : "responses"}`;
  return { apiKey, model, apiKind, apiUrl };
}

function authHeaders(apiKey: string) {
  const headerName = (process.env.WWPDW_AI_FAMILY_AGE_AUTH_HEADER ?? "authorization").toLowerCase();
  if (headerName === "api-key") return { "api-key": apiKey } as Record<string, string>;
  return { Authorization: `Bearer ${apiKey}` } as Record<string, string>;
}

function promptForPage(title: string, properties: JsonRecord) {
  const fields = {
    title,
    englishTitle: propertyText(properties["English Title"]),
    originalTitle: propertyText(properties["Original Title"]),
    releaseYear: propertyText(properties["Release Year"]),
    countries: propertyText(properties.Countries),
    languages: propertyText(properties.Languages),
    genres: propertyText(properties.Genres) || propertyText(properties["旨趣"]),
    officialRating: propertyText(properties["分级"]),
    runtime: propertyText(properties["Runtime Minutes"]),
    directors: propertyText(properties.Directors) || propertyText(properties["导演"]),
    cast: propertyText(properties.Cast) || propertyText(properties["主演"]),
    synopsis: propertyText(properties["简介"]),
    basicInfo: propertyText(properties["基本信息"]),
    omdbRating: propertyText(properties["IMDB评分"]),
    metascore: propertyText(properties.Metascore),
    rottenTomatoes: propertyText(properties["烂番茄新鲜度"])
  };

  return `请为家庭观影网站评估这部影视作品的建议最低观看年龄。只输出 JSON，不要 Markdown。\n\n` +
    `字段要求：\n` +
    `- minimumAge: 0 到 18 的整数。0 表示全年龄，18 表示只建议成人。\n` +
    `- confidence: high | medium | low。\n` +
    `- riskTags: 从这些中文标签选择 0 到 6 个：暴力, 血腥, 恐怖, 性/裸露, 脏话, 毒品, 自杀自伤, 战争, 歧视/仇恨, 成人主题, 儿童友好, 需人工复核。\n` +
    `- reason: 中文一句话，不超过 80 字，说明关键依据。\n` +
    `- needsReview: 布尔值；资料不足或官方分级与内容明显冲突时为 true。\n\n` +
    `评估原则：这是家庭内部的 AI 建议，不是官方分级。优先保护儿童；官方分级只是参考。资料不足时降低 confidence 并加入 需人工复核。\n\n` +
    `作品资料：\n${JSON.stringify(fields, null, 2)}`;
}

function normalizeAiPayload(value: unknown): FamilyAgePayload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const minimumAge = Math.round(Number(record.minimumAge));
  const confidence = asString(record.confidence).toLowerCase();
  const needsReview = record.needsReview === true;
  const riskTags = asArray(record.riskTags)
    .map((item) => asString(item).trim())
    .filter((item) => allowedRiskTags.has(item))
    .filter((item) => needsReview || item !== "需人工复核");
  if (needsReview && !riskTags.includes("需人工复核")) riskTags.push("需人工复核");
  const reason = asString(record.reason).trim().slice(0, 160);
  if (!Number.isFinite(minimumAge) || minimumAge < 0 || minimumAge > 18) return undefined;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return undefined;
  if (!reason) return undefined;
  return {
    minimumAge,
    confidence,
    riskTags,
    reason,
    needsReview
  };
}

async function askFamilyAgeModel(title: string, properties: JsonRecord): Promise<FamilyAgePayload> {
  const config = aiConfig();
  if (!config.apiKey) throw new Error("Set OPENAI_API_KEY or BAILIAN_API_KEY before running family age enrichment.");
  const userPrompt = promptForPage(title, properties);
  const systemPrompt = "You are a careful family media age-rating assistant. Return only valid JSON matching the requested schema.";
  const body = config.apiKind === "chat"
    ? {
        model: config.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 500
      }
    : {
        model: config.model,
        store: false,
        max_output_tokens: 500,
        text: { format: { type: "json_object" } },
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      };

  const response = await fetch(config.apiUrl, {
    method: "POST",
    signal: AbortSignal.timeout(aiRequestTimeoutMs),
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(config.apiKey)
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI family age request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const text = responseText(await response.json());
  const payload = text ? normalizeAiPayload(parseJsonObject(text)) : undefined;
  if (!payload) throw new Error("AI family age response was not valid.");
  return payload;
}

async function retrieveDataSource(notion: Client, dataSourceId: string) {
  return notion.dataSources.retrieve({ data_source_id: dataSourceId });
}

async function loadDatabaseMetadata(notion: Client, databaseId: string): Promise<LibraryMetadata> {
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const record = database as unknown as JsonRecord;
  const dataSources = asArray(record.data_sources);
  const dataSourceId = asString(asRecord(dataSources[0])?.id) || databaseId;
  const dataSource = await retrieveDataSource(notion, dataSourceId) as unknown as JsonRecord;
  return {
    dataSourceId,
    titleProperty: findTitleProperty(asRecord(dataSource.properties) ?? {}),
    properties: asRecord(dataSource.properties) ?? {}
  };
}

async function loadLibrary(notion: Client, options: FamilyAgeOptions): Promise<LibraryMetadata> {
  if (options.dataSourceId || configuredDataSourceId) {
    const dataSource = await retrieveDataSource(notion, options.dataSourceId ?? configuredDataSourceId ?? "") as unknown as JsonRecord;
    return {
      dataSourceId: asString(dataSource.id),
      titleProperty: findTitleProperty(asRecord(dataSource.properties) ?? {}),
      properties: asRecord(dataSource.properties) ?? {}
    };
  }
  if (options.databaseId || configuredDatabaseId) return loadDatabaseMetadata(notion, options.databaseId ?? configuredDatabaseId ?? "");
  throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_LIBRARY_DATABASE_ID.");
}

function findTitleProperty(properties: JsonRecord) {
  for (const [name, property] of Object.entries(properties)) {
    if (asRecord(property)?.type === "title") return name;
  }
  return undefined;
}

async function collectPages(notion: Client, library: LibraryMetadata, options: FamilyAgeOptions) {
  if (options.pageId) {
    const page = await notion.pages.retrieve({ page_id: options.pageId });
    return [page as unknown as JsonRecord];
  }
  const pages: JsonRecord[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: library.dataSourceId,
      page_size: Math.min(options.pageSize, Math.max(1, options.limit - pages.length)),
      start_cursor: cursor,
      ...(options.query ? { filter: { property: library.titleProperty ?? "Name", title: { contains: options.query } } } : {})
    } as never);
    pages.push(...response.results.map((item) => item as unknown as JsonRecord));
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor && pages.length < options.limit);
  return pages.slice(0, options.limit);
}

function pageNeedsFamilyAge(properties: JsonRecord) {
  return !hasPropertyValue(properties, "AI建议最低年龄") && !hasPropertyValue(properties, "人工年龄覆盖");
}

async function planPage(page: JsonRecord): Promise<PagePlan> {
  const properties = asRecord(page.properties) ?? {};
  const title = titleFromProperties(properties);
  const pageId = asString(page.id);
  if (!pageNeedsFamilyAge(properties)) {
    return { pageId, title, url: asString(page.url), updates: {}, updateFields: [], skipped: "already_has_age" };
  }
  const ai = await askFamilyAgeModel(title, properties);
  const updates = {
    "AI建议最低年龄": pagePropertyValue("AI建议最低年龄", ai.minimumAge),
    "AI年龄建议置信度": pagePropertyValue("AI年龄建议置信度", ai.confidence),
    "内容风险标签": pagePropertyValue("内容风险标签", ai.riskTags),
    "AI年龄建议理由": pagePropertyValue("AI年龄建议理由", ai.reason)
  };
  const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => Boolean(value)));
  return {
    pageId,
    title,
    url: asString(page.url),
    updates: cleanUpdates,
    updateFields: Object.keys(cleanUpdates),
    ai
  };
}

async function main() {
  const options = parseArgs();
  const notionToken = options.apply
    ? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  if (!notionToken) throw new Error("Set NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN.");

  installNotionDnsOverride();
  const notion = new Client({ auth: notionToken, timeoutMs: notionRequestTimeoutMs });
  const library = await loadLibrary(notion, options);
  const pages = (await collectPages(notion, library, options)).filter((page) => {
    const properties = asRecord(page.properties) ?? {};
    return pageNeedsFamilyAge(properties);
  }).slice(0, options.maxUpdates);

  const plans: PagePlan[] = [];
  const skipped: Record<string, number> = {};
  let applied = 0;
  for (const page of pages) {
    try {
      const plan = await planPage(page);
      plans.push(plan);
      if (plan.skipped) skipped[plan.skipped] = (skipped[plan.skipped] ?? 0) + 1;
      if (options.apply && Object.keys(plan.updates).length > 0) {
        await notion.pages.update({ page_id: plan.pageId, properties: plan.updates as never });
        applied += 1;
      }
    } catch (error) {
      plans.push({
        pageId: asString(page.id),
        title: titleFromProperties(asRecord(page.properties) ?? {}),
        url: asString(page.url),
        updates: {},
        updateFields: [],
        skipped: error instanceof Error ? error.message : "unknown_error"
      });
    }
    if (options.delayMs > 0) await sleep(options.delayMs);
  }

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    dataSourceId: library.dataSourceId,
    limit: options.limit,
    maxUpdates: options.maxUpdates,
    planned: plans.filter((plan) => plan.updateFields.length > 0).length,
    applied,
    skipped,
    sample: plans.map((plan) => ({
      title: plan.title,
      pageId: plan.pageId,
      url: plan.url,
      updateFields: plan.updateFields,
      ai: plan.ai,
      skipped: plan.skipped
    }))
  };
  const reportPath = options.reportPath || path.join(repoRoot, ".local-data", `notion-family-age-${options.apply ? "apply" : "preview"}.json`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
