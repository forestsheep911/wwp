import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import { createSearchIndexStore } from "@wwpdw/cache-store";
import type { MovieMetadata, SearchResult } from "@wwpdw/shared";

type JsonRecord = Record<string, unknown>;

interface Options {
  apply: boolean;
  pageSize: number;
  limit?: number;
  reportPath?: string;
  dataSourceId?: string;
}

interface FamilyAgeFields {
  pageId: string;
  title: string;
  ratingLevel?: string[];
  aiSuggestedMinimumAge?: number;
  aiAgeConfidence?: string;
  contentRiskTags?: string[];
  aiAgeReason?: string;
  manualAgeOverride?: number;
  effectiveMinimumAge?: number;
}

interface IndexUpdatePlan {
  assetKey: string;
  title: string;
  sourcePageId?: string;
  fields: Omit<FamilyAgeFields, "pageId" | "title">;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const dataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const notionRequestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);
let notionDnsOverrideInstalled = false;

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    apply: false,
    pageSize: 100
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.startsWith("--") ? arg.slice(2).split("=", 2) : [arg, undefined];
    const value = inlineValue ?? args[index + 1];
    if (arg === "--apply") {
      options.apply = true;
    } else if (name === "page-size" && value) {
      options.pageSize = Math.min(100, Math.max(1, Math.floor(Number(value))));
      if (inlineValue === undefined) index += 1;
    } else if (name === "limit" && value) {
      const limit = Number(value);
      options.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
      if (inlineValue === undefined) index += 1;
    } else if (name === "report" && value) {
      options.reportPath = value;
      if (inlineValue === undefined) index += 1;
    } else if ((name === "data-source-id" || name === "database-id") && value) {
      options.dataSourceId = value;
      if (inlineValue === undefined) index += 1;
    }
  }

  return options;
}

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
        if (options && typeof options === "object" && "all" in options && (options as { all?: boolean }).all) {
          callback(null, [{ address: notionApiIp, family: 4 }]);
        } else {
          callback(null, notionApiIp, 4);
        }
        return;
      }
    }

    return originalLookup(hostname, options, callback);
  }) as typeof dns.lookup;
  notionDnsOverrideInstalled = true;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function plainTextFromRichText(value: unknown) {
  return asArray(value)
    .map((item) => asRecord(item)?.plain_text)
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("");
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      return plainTextFromRichText(record.title);
    }
  }
  return "";
}

function textProperty(property: unknown) {
  const record = asRecord(property);
  if (!record) return undefined;
  if (record.type === "rich_text") return plainTextFromRichText(record.rich_text);
  if (record.type === "title") return plainTextFromRichText(record.title);
  if (record.type === "select") return asRecord(record.select)?.name as string | undefined;
  if (record.type === "status") return asRecord(record.status)?.name as string | undefined;
  if (record.type === "number" && typeof record.number === "number") return String(record.number);
  if (record.type === "formula") {
    const formula = asRecord(record.formula);
    const formulaType = formula?.type;
    if (formulaType && typeof formula[formulaType as string] === "string") {
      return formula[formulaType as string] as string;
    }
  }
  return undefined;
}

function numberProperty(property: unknown) {
  const record = asRecord(property);
  if (!record) return undefined;
  if (record.type === "number" && typeof record.number === "number") return record.number;
  if (record.type === "formula") {
    const formula = asRecord(record.formula);
    if (typeof formula?.number === "number") return formula.number;
  }
  const text = textProperty(property);
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function listProperty(property: unknown) {
  const record = asRecord(property);
  if (!record) return undefined;
  if (record.type === "multi_select") {
    return asArray(record.multi_select)
      .map((item) => asRecord(item)?.name)
      .filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  const text = textProperty(property);
  return text ? [text] : undefined;
}

function familyAgeFieldsFromPage(page: JsonRecord): FamilyAgeFields | undefined {
  const properties = asRecord(page.properties) ?? {};
  const aiSuggestedMinimumAge = numberProperty(properties["AI建议最低年龄"]);
  const manualAgeOverride = numberProperty(properties["人工年龄覆盖"]);
  const effectiveMinimumAge = manualAgeOverride ?? aiSuggestedMinimumAge;
  if (effectiveMinimumAge === undefined) {
    return undefined;
  }

  return {
    pageId: String(page.id ?? ""),
    title: titleFromProperties(properties),
    ratingLevel: listProperty(properties["分级"]),
    aiSuggestedMinimumAge,
    aiAgeConfidence: listProperty(properties["AI年龄建议置信度"])?.[0],
    contentRiskTags: listProperty(properties["内容风险标签"]),
    aiAgeReason: textProperty(properties["AI年龄建议理由"]),
    manualAgeOverride,
    effectiveMinimumAge
  };
}

function compactMetadata(metadata: MovieMetadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== "";
    })
  ) as MovieMetadata;
}

function applyFamilyAgeFields(result: SearchResult, fields: FamilyAgeFields): SearchResult {
  const metadata = compactMetadata({
    ...(result.metadata ?? {}),
    ratingLevel: fields.ratingLevel ?? result.metadata?.ratingLevel,
    aiSuggestedMinimumAge: fields.aiSuggestedMinimumAge,
    aiAgeConfidence: fields.aiAgeConfidence,
    contentRiskTags: fields.contentRiskTags,
    aiAgeReason: fields.aiAgeReason,
    manualAgeOverride: fields.manualAgeOverride,
    effectiveMinimumAge: fields.effectiveMinimumAge
  });

  return {
    ...result,
    metadata
  };
}

async function writeReport(reportPath: string | undefined, payload: unknown) {
  if (!reportPath) return;
  const absolutePath = path.isAbsolute(reportPath) ? reportPath : path.resolve(repoRoot, reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs();
  const resolvedDataSourceId = options.dataSourceId ?? dataSourceId;
  if (!resolvedDataSourceId) {
    throw new Error("Missing NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_DATA_SOURCE_ID.");
  }

  installNotionDnsOverride();
  const notion = new Client({
    auth: process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_TOKEN ?? process.env.NOTION_WRITE_TOKEN,
    timeoutMs: notionRequestTimeoutMs
  });
  const searchIndex = createSearchIndexStore();
  const byPageId = new Map<string, FamilyAgeFields>();
  let cursor: string | undefined;
  let scannedPages = 0;

  do {
    const response = await notion.dataSources.query({
      data_source_id: resolvedDataSourceId,
      page_size: options.pageSize,
      start_cursor: cursor
    });

    for (const page of response.results as JsonRecord[]) {
      scannedPages += 1;
      const fields = familyAgeFieldsFromPage(page);
      if (fields) {
        byPageId.set(fields.pageId, fields);
      }
      if (options.limit && scannedPages >= options.limit) {
        cursor = undefined;
        break;
      }
    }

    if (options.limit && scannedPages >= options.limit) {
      break;
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  const results = await searchIndex.search("", 10000);
  const plans: IndexUpdatePlan[] = [];
  const updatedResults: SearchResult[] = [];

  for (const result of results) {
    const sourcePageId = result.sourcePageId;
    const fields = sourcePageId ? byPageId.get(sourcePageId) : undefined;
    if (!fields) continue;

    plans.push({
      assetKey: result.assetKey,
      title: result.title,
      sourcePageId,
      fields: {
        ratingLevel: fields.ratingLevel,
        aiSuggestedMinimumAge: fields.aiSuggestedMinimumAge,
        aiAgeConfidence: fields.aiAgeConfidence,
        contentRiskTags: fields.contentRiskTags,
        aiAgeReason: fields.aiAgeReason,
        manualAgeOverride: fields.manualAgeOverride,
        effectiveMinimumAge: fields.effectiveMinimumAge
      }
    });
    updatedResults.push(applyFamilyAgeFields(result, fields));
  }

  if (options.apply && updatedResults.length > 0) {
    await searchIndex.upsertResults(updatedResults);
  }

  const report = {
    dryRun: !options.apply,
    scannedPages,
    pagesWithAge: byPageId.size,
    indexedResults: results.length,
    plannedUpdates: plans.length,
    appliedUpdates: options.apply ? updatedResults.length : 0,
    plans
  };
  await writeReport(options.reportPath, report);
  console.log(JSON.stringify({
    dryRun: report.dryRun,
    scannedPages: report.scannedPages,
    pagesWithAge: report.pagesWithAge,
    indexedResults: report.indexedResults,
    plannedUpdates: report.plannedUpdates,
    appliedUpdates: report.appliedUpdates
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
