import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import { createSearchIndexStore } from "@wwpdw/cache-store";
import type { MovieMetadata, MovieTitleEntry, SearchResult } from "@wwpdw/shared";

type JsonRecord = Record<string, unknown>;

interface Options {
  apply: boolean;
  pageSize: number;
  limit?: number;
  reportPath?: string;
  dataSourceId?: string;
}

interface TitleFields {
  pageId: string;
  primaryTitle: string;
  simplifiedChineseTitle?: string;
  traditionalTaiwanTitle?: string;
  traditionalHongKongTitle?: string;
  originalTitle?: string;
  englishTitle?: string;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const configuredDataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const requestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);
let notionDnsOverrideInstalled = false;

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = { apply: false, pageSize: 100 };
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
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("");
}

function textFromProperty(property: unknown) {
  const record = asRecord(property);
  if (!record) return "";
  if (record.type === "rich_text") return plainTextFromRichText(record.rich_text).trim();
  if (record.type === "title") return plainTextFromRichText(record.title).trim();
  return "";
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      const title = textFromProperty(record);
      if (title) return title;
    }
  }
  return "Untitled Notion page";
}

function titleFieldsFromPage(page: JsonRecord): TitleFields {
  const properties = asRecord(page.properties) ?? {};
  return {
    pageId: String(page.id ?? ""),
    primaryTitle: titleFromProperties(properties),
    simplifiedChineseTitle: textFromProperty(properties["Simplified Chinese Title"]) || undefined,
    traditionalTaiwanTitle: textFromProperty(properties["Traditional Chinese Title (Taiwan)"]) || undefined,
    traditionalHongKongTitle: textFromProperty(properties["Traditional Chinese Title (Hong Kong)"]) || undefined,
    originalTitle: textFromProperty(properties["Original Title"]) || undefined,
    englishTitle: textFromProperty(properties["English Title"]) || undefined
  };
}

function titleKey(entry: MovieTitleEntry) {
  return `${entry.kind}:${entry.lang ?? ""}:${entry.region ?? ""}:${entry.title.trim().toLowerCase()}`;
}

function uniqueTitleEntries(entries: Array<MovieTitleEntry | undefined>) {
  const seen = new Set<string>();
  const unique: MovieTitleEntry[] = [];
  for (const entry of entries) {
    if (!entry?.title.trim()) continue;
    const next = { ...entry, title: entry.title.trim() };
    const key = titleKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(next);
  }
  return unique;
}

function entriesFromFields(fields: TitleFields, existingTitles: MovieTitleEntry[] | undefined) {
  const preserved = (existingTitles ?? []).filter((entry) => (
    entry.kind !== "primary" &&
    entry.kind !== "original" &&
    entry.kind !== "alternate" &&
    !(entry.kind === "localized" && (entry.lang === "zh" || entry.lang === "zh-Hans" || entry.lang === "zh-Hant"))
  ));

  return uniqueTitleEntries([
    { title: fields.primaryTitle, kind: "primary", source: "notion" },
    fields.simplifiedChineseTitle ? { title: fields.simplifiedChineseTitle, kind: "localized", lang: "zh-Hans", source: "notion" } : undefined,
    fields.traditionalTaiwanTitle ? { title: fields.traditionalTaiwanTitle, kind: "localized", lang: "zh-Hant", region: "TW", source: "notion" } : undefined,
    fields.traditionalHongKongTitle ? { title: fields.traditionalHongKongTitle, kind: "localized", lang: "zh-Hant", region: "HK", source: "notion" } : undefined,
    fields.originalTitle ? { title: fields.originalTitle, kind: "original", source: "notion" } : undefined,
    fields.englishTitle ? { title: fields.englishTitle, kind: "alternate", lang: "en", source: "notion" } : undefined,
    ...preserved
  ]);
}

function displayTitle(fields: TitleFields) {
  return fields.simplifiedChineseTitle ??
    fields.traditionalTaiwanTitle ??
    fields.traditionalHongKongTitle ??
    fields.primaryTitle;
}

function compactMetadata(metadata: MovieMetadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== "";
    })
  ) as MovieMetadata;
}

function applyTitleFields(result: SearchResult, fields: TitleFields): SearchResult {
  const metadata = result.metadata ?? {};
  const titles = entriesFromFields(fields, metadata.titles);
  const workTitles = entriesFromFields(fields, metadata.work?.titles);
  const nextDisplay = {
    ...(metadata.display ?? {}),
    title: displayTitle(fields)
  };
  const nextWork = metadata.work
    ? {
      ...metadata.work,
      titles: workTitles,
      display: {
        ...(metadata.work.display ?? {}),
        title: displayTitle(fields)
      }
    }
    : undefined;

  return {
    ...result,
    title: fields.primaryTitle || result.title,
    metadata: compactMetadata({
      ...metadata,
      titles,
      display: nextDisplay,
      work: nextWork
    })
  };
}

function hasLegacyChineseTitle(result: SearchResult) {
  const titles = [
    ...(result.metadata?.titles ?? []),
    ...(result.metadata?.work?.titles ?? [])
  ];
  return titles.some((entry) => entry.kind === "localized" && entry.lang === "zh");
}

async function writeReport(reportPath: string | undefined, payload: unknown) {
  if (!reportPath) return;
  const absolutePath = path.isAbsolute(reportPath) ? reportPath : path.resolve(repoRoot, reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs();
  const dataSourceId = options.dataSourceId ?? configuredDataSourceId;
  if (!dataSourceId) throw new Error("Missing NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_DATA_SOURCE_ID.");

  installNotionDnsOverride();
  const notion = new Client({
    auth: process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_TOKEN ?? process.env.NOTION_WRITE_TOKEN,
    timeoutMs: requestTimeoutMs
  });
  const searchIndex = createSearchIndexStore();
  const byPageId = new Map<string, TitleFields>();
  let cursor: string | undefined;
  let scannedPages = 0;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: options.pageSize,
      start_cursor: cursor
    });

    for (const page of response.results as JsonRecord[]) {
      scannedPages += 1;
      const fields = titleFieldsFromPage(page);
      byPageId.set(fields.pageId, fields);
      if (options.limit && scannedPages >= options.limit) {
        cursor = undefined;
        break;
      }
    }

    if (options.limit && scannedPages >= options.limit) break;
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  const results = await searchIndex.search("", 10000);
  const updatedResults: SearchResult[] = [];
  const plans = results
    .map((result) => {
      const fields = result.sourcePageId ? byPageId.get(result.sourcePageId) : undefined;
      if (!fields) return undefined;
      const legacyBefore = hasLegacyChineseTitle(result);
      const updated = applyTitleFields(result, fields);
      const legacyAfter = hasLegacyChineseTitle(updated);
      if (legacyBefore || JSON.stringify(result.metadata?.titles ?? []) !== JSON.stringify(updated.metadata?.titles ?? [])) {
        updatedResults.push(updated);
        return {
          assetKey: result.assetKey,
          sourcePageId: result.sourcePageId,
          title: result.title,
          displayTitle: updated.metadata?.display?.title,
          legacyBefore,
          legacyAfter
        };
      }
      return undefined;
    })
    .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

  if (options.apply && updatedResults.length > 0) {
    await searchIndex.upsertResults(updatedResults);
  }

  const report = {
    dryRun: !options.apply,
    scannedPages,
    indexedResults: results.length,
    plannedUpdates: plans.length,
    appliedUpdates: options.apply ? updatedResults.length : 0,
    plans
  };
  await writeReport(options.reportPath, report);
  console.log(JSON.stringify({
    dryRun: report.dryRun,
    scannedPages: report.scannedPages,
    indexedResults: report.indexedResults,
    plannedUpdates: report.plannedUpdates,
    appliedUpdates: report.appliedUpdates
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
