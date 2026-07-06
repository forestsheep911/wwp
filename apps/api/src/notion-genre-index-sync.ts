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
  reportPath?: string;
  dataSourceId?: string;
}

interface GenreFields {
  pageId: string;
  title: string;
  genres: string[];
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
  if (record.type === "title") return plainTextFromRichText(record.title).trim();
  if (record.type === "rich_text") return plainTextFromRichText(record.rich_text).trim();
  return "";
}

function namesFromProperty(property: unknown) {
  const record = asRecord(property);
  if (record?.type !== "multi_select") return [];
  return asArray(record.multi_select)
    .map((item) => asRecord(item)?.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map((name) => name.trim());
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

function genreFieldsFromPage(page: JsonRecord): GenreFields {
  const properties = asRecord(page.properties) ?? {};
  return {
    pageId: String(page.id ?? ""),
    title: titleFromProperties(properties),
    genres: namesFromProperty(properties["旨趣"])
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

function applyGenres(result: SearchResult, fields: GenreFields): SearchResult {
  const metadata = result.metadata ?? {};
  return {
    ...result,
    metadata: compactMetadata({
      ...metadata,
      genres: fields.genres,
      work: metadata.work
        ? {
          ...metadata.work,
          genres: fields.genres
        }
        : undefined
    })
  };
}

function sameList(left: string[] | undefined, right: string[]) {
  return JSON.stringify(left ?? []) === JSON.stringify(right);
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
  const byPageId = new Map<string, GenreFields>();
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
      const fields = genreFieldsFromPage(page);
      byPageId.set(fields.pageId, fields);
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  const results = await searchIndex.search("", 10000);
  const updatedResults: SearchResult[] = [];
  const plans = results
    .map((result) => {
      const fields = result.sourcePageId ? byPageId.get(result.sourcePageId) : undefined;
      if (!fields || sameList(result.metadata?.genres, fields.genres)) return undefined;
      const updated = applyGenres(result, fields);
      updatedResults.push(updated);
      return {
        assetKey: result.assetKey,
        sourcePageId: result.sourcePageId,
        title: result.title,
        before: result.metadata?.genres ?? [],
        after: fields.genres
      };
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
