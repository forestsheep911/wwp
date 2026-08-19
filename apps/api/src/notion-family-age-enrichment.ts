import "./env.js";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { buildAiCheckUpdates, buildResolvedAiIssueUpdates } from "./notion-ai-check-state.js";

type JsonRecord = Record<string, unknown>;

interface FamilyAgeOptions {
  apply: boolean;
  refresh: boolean;
  refreshRiskTag?: string;
  includeLegacyPages: boolean;
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
  candidateCache?: string;
  planPath?: string;
  writeCandidateCache?: string;
  progressPath: string;
  failureProgressPath: string;
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
  "犯罪",
  "死亡/丧亲",
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
    refresh: has("--refresh"),
    refreshRiskTag: value("--refresh-risk-tag", "").trim() || undefined,
    includeLegacyPages: has("--include-legacy-pages"),
    limit: Math.max(1, Math.floor(Number(value("--limit", "20")))),
    maxUpdates: Math.max(1, Math.floor(Number(value("--max-updates", "5")))),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(value("--page-size", "50"))))),
    delayMs: Math.max(0, Math.floor(Number(value("--delay-ms", "300")))),
    query: value("--query", "").trim() || undefined,
    pageId: extractNotionId(value("--page-id", "") || value("--page-url", "")) ?? undefined,
    reportPath: value("--report", "").trim() || undefined,
    dataSourceId: extractNotionId(value("--data-source-id", "")) ?? undefined,
    databaseId: extractNotionId(value("--database-id", "")) ?? undefined,
    rootPageId: extractNotionId(value("--root-page-id", "")) ?? undefined,
    candidateCache: value("--candidate-cache", "").trim() || undefined,
    planPath: value("--plan", "").trim() || undefined,
    writeCandidateCache: value("--write-candidate-cache", "").trim() || undefined,
    progressPath: value("--progress", ".local-data/notion-family-age-progress.jsonl").trim(),
    failureProgressPath: value("--failure-progress", ".local-data/notion-family-age-failures.jsonl").trim()
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
    return { multi_select: values.map((item) => ({ name: String(item) })) };
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

export function promptForPage(title: string, properties: JsonRecord) {
  const fields = {
    title,
    englishTitle: propertyText(properties["English Title"]),
    originalTitle: propertyText(properties["Original Title"]),
    releaseYear: propertyText(properties["Release Year"]),
    countries: propertyText(properties.Countries),
    languages: propertyText(properties.Languages),
    genres: propertyText(properties["旨趣"]),
    externalGenres: propertyText(properties["外部类型原文"]),
    unmappedGenres: propertyText(properties["未映射类型"]),
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
    `- riskTags: 从这些中文标签选择 0 到 6 个：暴力, 血腥, 恐怖, 性/裸露, 脏话, 毒品, 自杀自伤, 战争, 歧视/仇恨, 犯罪, 死亡/丧亲, 儿童友好, 需人工复核。\n` +
    `- reason: 中文一句话，不超过 80 字，必须写明影响年龄建议的具体内容或理解门槛，不得使用“成人主题”“成人内容”“成人向”“成熟主题”“少儿不宜”“不适合未成年人”等笼统结论代替依据。\n` +
    `- needsReview: 布尔值；资料不足或官方分级与内容明显冲突时为 true。\n\n` +
    `标签必须对应资料中明确存在的内容风险，不要按气氛、隐喻或泛化联想贴标签：\n` +
    `- 战争：仅用于作品实际呈现真实战争或军队间有组织武装冲突；战争只作为人物履历或历史背景、私人武装争斗、灾难救援、阶级冲突、犯罪、恐袭、反恐行动、毒品战争、枪战、黑帮冲突不等于战争。\n` +
    `- 血腥：仅用于画面明确呈现大量或有冲击力的流血、伤口、肢解或尸体细节；普通打斗、轻伤、危险运动、动物蜇伤或理由中的“可能有血”不等于血腥。\n` +
    `- 恐怖：仅用于恐怖类型、持续惊吓或明确恐怖意象；悬疑、压抑、心理复杂不等于恐怖。\n` +
    `- 歧视/仇恨：仅用于明确的种族、性别、身份等偏见或仇恨行为；贫困、企业不公、一般社会不平等不等于歧视。\n` +
    `- 自杀自伤：仅用于资料明确写出的自杀意念、行为或自残；悲伤、绝望、精神疾病、牺牲、人物败亡或角色死亡不等于自杀自伤。若理由只能写“暗示、倾向、象征”，不得使用此标签。\n` +
    `- 性/裸露：必须检查内容警示、家长指南或可靠人工观察；简介、类型和官方分级经常漏记短暂或次要裸露，不能因为资料未提及就判定没有。只要可靠证据明确出现裸露或性行为，就使用此标签，并在 reason 中说明可观察内容。\n` +
    `- 犯罪：仅用于作品明确、持续或核心呈现谋杀、绑架、勒索、黑帮、有组织犯罪等违法行为；复杂伦理、政治议题、一般社会不公或一次轻微违规不等于犯罪。\n` +
    `- 死亡/丧亲：仅用于死亡、丧亲或哀悼是明确且重要的观看内容，并可能给儿童造成情绪压力；背景信息或普通动作片中的短暂角色死亡不自动使用此标签。\n` +
    `- 复杂伦理、政治、身份认同、人生阅历或沉重现实本身不属于内容风险标签；若它们确实提高理解门槛，应在 reason 中具体说明议题和所需理解能力。\n` +
    `- 儿童友好可以与轻度幻想暴力并存，但不要仅因反派或紧张桥段标记恐怖。\n\n` +
    `评估原则：这是家庭内部的 AI 建议，不是官方分级。优先保护儿童；官方分级只是参考。标签只描述明确、可观察且与儿童观看风险直接相关的内容，不表达“需要成年人观看”，也不把主题复杂等同于性内容。资料不足时降低 confidence 并加入 需人工复核；若无法排除资料可能漏记的裸露，也不要写“无性/裸露”，而应在 reason 中说明证据不足。reason 必须全部使用中文。\n\n` +
    `作品资料：\n${JSON.stringify(fields, null, 2)}`;
}

export function normalizeAiPayload(value: unknown): FamilyAgePayload | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const minimumAge = Math.round(Number(record.minimumAge));
  const confidence = asString(record.confidence).toLowerCase();
  const needsReview = record.needsReview === true;
  let riskTags = asArray(record.riskTags)
    .map((item) => asString(item).trim())
    .filter((item) => allowedRiskTags.has(item))
    .filter((item) => needsReview || item !== "需人工复核");
  const reason = asString(record.reason).replace(/\bexplicit\b/giu, "明确的").trim().slice(0, 160);
  if (/(?:成人主题|成人内容|成人向|成熟主题|少儿不宜|不适合未成年人)/u.test(reason)) return undefined;
  const explicitSelfHarm = /(?:自杀(?!倾向|暗示|象征)|自残(?!倾向|暗示|象征)|割腕|割脉|跳楼|跳河|服毒|上吊)/u.test(reason);
  const depictedWar = /(?:战争场面|战争伤亡|军事冲突|军事入侵|战役|战场|军队.{0,8}(?:战斗|交战)|部族冲突|(?:大规模|有组织|军事|军队).{0,8}武装冲突)/u.test(reason);
  const depictedBlood = /(?:血腥|流血|喷血|伤口|肢解|断肢|残肢|尸体细节|斩首|内脏)/u.test(reason);
  const depictedHorror = /(?:恐怖片|恐怖类型|心理恐怖|身体恐怖|超自然|幽灵|怨灵|诅咒|丧尸|异形|怪物|惊吓|惊悚场面|恐怖意象|阴森|骷髅|女巫)/u.test(reason);
  if (!explicitSelfHarm) riskTags = riskTags.filter((item) => item !== "自杀自伤");
  if (!depictedWar) riskTags = riskTags.filter((item) => item !== "战争");
  if (/(?:反恐行动|毒品战争|恐怖组织)/u.test(reason) && !/(?:战争场面|战争伤亡|军事入侵|战役|战场|军队.{0,8}(?:战斗|交战))/u.test(reason)) {
    riskTags = riskTags.filter((item) => item !== "战争");
  }
  if (!depictedBlood) riskTags = riskTags.filter((item) => item !== "血腥");
  if (!depictedHorror) riskTags = riskTags.filter((item) => item !== "恐怖");
  if (/(?:无|没有|不含|并无).{0,6}(?:血腥|流血|伤口)/u.test(reason)) {
    riskTags = riskTags.filter((item) => item !== "血腥");
  }
  if (/(?:无|没有|不含|并无).{0,8}(?:恐怖|惊吓)/u.test(reason)) {
    riskTags = riskTags.filter((item) => item !== "恐怖");
  }
  if (needsReview && !riskTags.includes("需人工复核")) riskTags.push("需人工复核");
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

async function loadCachedLibrary(cachePath: string): Promise<LibraryMetadata> {
  const cached = asRecord(JSON.parse(await readFile(cachePath, "utf8")));
  const library = asRecord(cached?.library);
  const dataSourceId = asString(library?.dataSourceId);
  if (!dataSourceId) throw new Error(`Candidate cache has no library metadata: ${cachePath}`);
  return {
    dataSourceId,
    titleProperty: asString(library?.titleProperty) || undefined,
    properties: asRecord(library?.properties) ?? {}
  };
}

function findTitleProperty(properties: JsonRecord) {
  for (const [name, property] of Object.entries(properties)) {
    if (asRecord(property)?.type === "title") return name;
  }
  return undefined;
}

async function collectPages(notion: Client, library: LibraryMetadata, options: FamilyAgeOptions) {
  if (options.candidateCache) {
    const cached = JSON.parse(await readFile(options.candidateCache, "utf8")) as unknown;
    const cachedPages = asArray(asRecord(cached)?.pages).map((page) => asRecord(page)).filter(Boolean) as JsonRecord[];
    if (cachedPages.length === 0) throw new Error(`Candidate cache has no pages: ${options.candidateCache}`);
    return cachedPages;
  }
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

async function readProgress(pathname: string) {
  try {
    const content = await readFile(pathname, "utf8");
    return new Set(content.split(/\r?\n/).filter(Boolean).map((line) => asString(asRecord(JSON.parse(line))?.pageId)).filter(Boolean));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>();
    throw error;
  }
}

function pageNeedsFamilyAge(properties: JsonRecord) {
  return !hasPropertyValue(properties, "AI建议最低年龄") && !hasPropertyValue(properties, "人工年龄覆盖");
}

function isLegacyPageTitle(title: string) {
  return /\[(?:旧媒体承载页|旧重复条目|旧错误结构)[^\]]*\]/u.test(title);
}

async function loadAiPlan(planPath?: string) {
  if (!planPath) return new Map<string, FamilyAgePayload>();
  const parsed = JSON.parse(await readFile(planPath, "utf8")) as JsonRecord;
  const entries = asArray(parsed.sample);
  const plan = new Map<string, FamilyAgePayload>();
  for (const entry of entries) {
    const record = asRecord(entry);
    const pageId = asString(record?.pageId);
    const ai = normalizeAiPayload(record?.ai);
    if (pageId && ai) plan.set(pageId, ai);
  }
  if (plan.size === 0) throw new Error(`AI plan has no valid page plans: ${planPath}`);
  return plan;
}

async function planPage(page: JsonRecord, refresh = false, aiPlan = new Map<string, FamilyAgePayload>()): Promise<PagePlan> {
  const properties = asRecord(page.properties) ?? {};
  const title = titleFromProperties(properties);
  const pageId = asString(page.id);
  if (!refresh && !pageNeedsFamilyAge(properties)) {
    return { pageId, title, url: asString(page.url), updates: {}, updateFields: [], skipped: "already_has_age" };
  }
  const ai = aiPlan.get(pageId) ?? await askFamilyAgeModel(title, properties);
  const updates = {
    "AI建议最低年龄": pagePropertyValue("AI建议最低年龄", ai.minimumAge),
    "AI年龄建议置信度": pagePropertyValue("AI年龄建议置信度", ai.confidence),
    "内容风险标签": pagePropertyValue("内容风险标签", ai.riskTags),
    "AI年龄建议理由": pagePropertyValue("AI年龄建议理由", ai.reason),
    ...buildAiCheckUpdates({
      checkedAt: new Date().toISOString(),
      unresolvedIssue: ai.needsReview ? `AI 年龄建议待复核：${ai.reason}` : undefined
    }),
    ...(!ai.needsReview
      ? buildResolvedAiIssueUpdates({
          existingAiIssue: propertyText(properties["AI Issue"]),
          humanIssue: propertyText(properties["Human Issue"]),
          resolvedPrefix: "AI 年龄建议待复核："
        })
      : {})
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
  if (options.refresh && !options.pageId) {
    throw new Error("--refresh requires one explicit --page-id.");
  }
  if (options.refreshRiskTag && options.refreshRiskTag !== "成人主题" && !allowedRiskTags.has(options.refreshRiskTag)) {
    throw new Error(`Unsupported --refresh-risk-tag: ${options.refreshRiskTag}`);
  }
  const notionToken = options.apply
    ? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  if (!notionToken) throw new Error("Set NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN.");

  installNotionDnsOverride();
  const notion = new Client({ auth: notionToken, timeoutMs: notionRequestTimeoutMs });
  const library = options.candidateCache
    ? await loadCachedLibrary(options.candidateCache)
    : await loadLibrary(notion, options);
  const aiPlan = await loadAiPlan(options.planPath);
  const completedPageIds = await readProgress(options.progressPath);
  const failedPageIds = await readProgress(options.failureProgressPath);
  const candidatePages = (await collectPages(notion, library, options)).filter((page) => {
    const properties = asRecord(page.properties) ?? {};
    const title = titleFromProperties(properties);
    const refreshRiskTag = options.refreshRiskTag && propertyText(properties["内容风险标签"])
      .split(/\s+/u)
      .includes(options.refreshRiskTag);
    const forceRefresh = options.refresh || Boolean(refreshRiskTag);
    return (forceRefresh || pageNeedsFamilyAge(properties)) &&
      (forceRefresh || !completedPageIds.has(asString(page.id))) &&
      (forceRefresh || !failedPageIds.has(asString(page.id))) &&
      (options.includeLegacyPages || !isLegacyPageTitle(title));
  });
  if (options.writeCandidateCache) {
    await mkdir(path.dirname(options.writeCandidateCache), { recursive: true });
    await writeFile(options.writeCandidateCache, `${JSON.stringify({ generatedAt: new Date().toISOString(), library, pages: candidatePages }, null, 2)}\n`, "utf8");
  }
  const pages = candidatePages.slice(0, options.maxUpdates);

  const plans: PagePlan[] = [];
  const skipped: Record<string, number> = {};
  let applied = 0;
  for (const page of pages) {
    try {
      const plan = await planPage(page, options.refresh || Boolean(options.refreshRiskTag), aiPlan);
      plans.push(plan);
      if (plan.skipped) skipped[plan.skipped] = (skipped[plan.skipped] ?? 0) + 1;
      if (options.apply && Object.keys(plan.updates).length > 0) {
        await notion.pages.update({ page_id: plan.pageId, properties: plan.updates as never });
        applied += 1;
        await mkdir(path.dirname(options.progressPath), { recursive: true });
        await appendFile(options.progressPath, `${JSON.stringify({
          pageId: plan.pageId,
          title: plan.title,
          appliedAt: new Date().toISOString(),
          updateFields: plan.updateFields,
          ai: plan.ai
        })}\n`, "utf8");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      plans.push({
        pageId: asString(page.id),
        title: titleFromProperties(asRecord(page.properties) ?? {}),
        url: asString(page.url),
        updates: {},
        updateFields: [],
        skipped: message
      });
      skipped[message] = (skipped[message] ?? 0) + 1;
      if (options.apply) {
        await mkdir(path.dirname(options.failureProgressPath), { recursive: true });
        await appendFile(options.failureProgressPath, `${JSON.stringify({ pageId: asString(page.id), failedAt: new Date().toISOString(), error: message })}\n`, "utf8");
      }
    }
    if (options.delayMs > 0) await sleep(options.delayMs);
  }

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    dataSourceId: library.dataSourceId,
    limit: options.limit,
    maxUpdates: options.maxUpdates,
    candidateSource: options.candidateCache ?? "notion",
    planPath: options.planPath,
    refreshRiskTag: options.refreshRiskTag,
    candidateCount: candidatePages.length,
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
