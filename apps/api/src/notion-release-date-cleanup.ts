import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";

type JsonRecord = Record<string, unknown>;

interface Options {
  apply: boolean;
  archiveProperty: boolean;
  forceArchive: boolean;
  limit?: number;
  pageSize: number;
  delayMs: number;
  reportPath?: string;
  dataSourceId?: string;
}

interface CleanupPlan {
  pageId: string;
  title: string;
  releaseDate?: string;
  legacyReleaseDate?: string;
  action: "migrate" | "already_migrated" | "conflict" | "empty";
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const configuredDataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const requestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);
let notionDnsOverrideInstalled = false;

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    apply: false,
    archiveProperty: false,
    forceArchive: false,
    pageSize: 100,
    delayMs: 150
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.startsWith("--") ? arg.slice(2).split("=", 2) : [arg, undefined];
    const value = inlineValue ?? args[index + 1];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--archive-property") {
      options.archiveProperty = true;
    } else if (arg === "--force-archive") {
      options.forceArchive = true;
    } else if (name === "limit" && value) {
      const limit = Number(value);
      options.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
      if (inlineValue === undefined) index += 1;
    } else if (name === "page-size" && value) {
      options.pageSize = Math.min(100, Math.max(1, Math.floor(Number(value))));
      if (inlineValue === undefined) index += 1;
    } else if (name === "delay-ms" && value) {
      options.delayMs = Math.max(0, Math.floor(Number(value)));
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

function dateFromProperty(property: unknown) {
  const record = asRecord(property);
  if (!record) return "";
  if (record.type === "date") return asRecord(record.date)?.start as string || "";
  if (record.type === "rich_text") return plainTextFromRichText(record.rich_text).trim();
  if (record.type === "title") return plainTextFromRichText(record.title).trim();
  return "";
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      const title = dateFromProperty(record);
      if (title) return title;
    }
  }
  return "Untitled Notion page";
}

function planForPage(page: JsonRecord): CleanupPlan {
  const properties = asRecord(page.properties) ?? {};
  const releaseDate = dateFromProperty(properties["上映日期"]);
  const legacyReleaseDate = dateFromProperty(properties["Release Date"]);
  let action: CleanupPlan["action"] = "empty";
  if (legacyReleaseDate && !releaseDate) {
    action = "migrate";
  } else if (legacyReleaseDate && releaseDate && legacyReleaseDate !== releaseDate) {
    action = "conflict";
  } else if (legacyReleaseDate && releaseDate) {
    action = "already_migrated";
  }

  return {
    pageId: String(page.id ?? ""),
    title: titleFromProperties(properties),
    releaseDate: releaseDate || undefined,
    legacyReleaseDate: legacyReleaseDate || undefined,
    action
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureReleaseDateSchema(notion: Client, dataSource: JsonRecord) {
  const properties = asRecord(dataSource.properties) ?? {};
  if (properties["上映日期"]) return false;
  await notion.dataSources.update({
    data_source_id: String(dataSource.id),
    properties: {
      "上映日期": { date: {} }
    }
  } as never);
  return true;
}

async function archiveReleaseDateProperty(notion: Client, dataSourceId: string) {
  const attempts: Array<{ method: string; properties: JsonRecord }> = [
    { method: "null", properties: { "Release Date": null } },
    { method: "archived", properties: { "Release Date": { archived: true } } }
  ];
  const errors: Array<{ method: string; message: string }> = [];
  for (const attempt of attempts) {
    try {
      await notion.dataSources.update({
        data_source_id: dataSourceId,
        properties: attempt.properties
      } as never);
      return { archived: true, method: attempt.method, errors };
    } catch (error) {
      errors.push({
        method: attempt.method,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { archived: false, errors };
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

  const token = options.apply
    ? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error(options.apply
      ? "Set NOTION_WRITE_TOKEN or NOTION_TOKEN before running with --apply."
      : "Set NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN.");
  }

  installNotionDnsOverride();
  const notion = new Client({ auth: token, timeoutMs: requestTimeoutMs });
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId }) as JsonRecord;
  const schemaAdded = options.apply ? await ensureReleaseDateSchema(notion, dataSource) : false;
  let cursor: string | undefined;
  let scanned = 0;
  const plans: CleanupPlan[] = [];

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: options.pageSize,
      start_cursor: cursor
    });
    for (const page of response.results as JsonRecord[]) {
      scanned += 1;
      const plan = planForPage(page);
      plans.push(plan);
      if (options.apply && plan.action === "migrate" && plan.legacyReleaseDate) {
        await notion.pages.update({
          page_id: plan.pageId,
          properties: {
            "上映日期": { date: { start: plan.legacyReleaseDate } }
          }
        } as never);
        if (options.delayMs > 0) await sleep(options.delayMs);
      }
      if (options.limit && scanned >= options.limit) {
        cursor = undefined;
        break;
      }
    }
    if (options.limit && scanned >= options.limit) break;
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  const conflicts = plans.filter((plan) => plan.action === "conflict");
  const archiveAttempt = options.apply && options.archiveProperty && (conflicts.length === 0 || options.forceArchive)
    ? await archiveReleaseDateProperty(notion, dataSourceId)
    : undefined;
  const report = {
    mode: options.apply ? "apply" : "dry-run",
    dataSourceId,
    scanned,
    schemaAdded,
    archiveRequested: options.archiveProperty,
    archiveAttempt,
    summary: {
      migrate: plans.filter((plan) => plan.action === "migrate").length,
      alreadyMigrated: plans.filter((plan) => plan.action === "already_migrated").length,
      conflicts: conflicts.length,
      empty: plans.filter((plan) => plan.action === "empty").length
    },
    conflicts,
    sample: plans.filter((plan) => plan.action !== "empty").slice(0, 30)
  };
  await writeReport(options.reportPath, report);
  console.log(JSON.stringify({
    mode: report.mode,
    scanned: report.scanned,
    schemaAdded: report.schemaAdded,
    archiveRequested: report.archiveRequested,
    archiveAttempt: report.archiveAttempt,
    summary: report.summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
