import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import { canonicalGenreOptions, mapExternalGenres } from "./genre-taxonomy.js";

type JsonRecord = Record<string, unknown>;

interface Options {
  apply: boolean;
  archiveGenres: boolean;
  limit?: number;
  pageSize: number;
  delayMs: number;
  reportPath?: string;
  dataSourceId?: string;
}

interface GenrePlan {
  pageId: string;
  title: string;
  existingCanonical: string[];
  externalGenres: string[];
  mappedCanonical: string[];
  unmappedGenres: string[];
  updates: string[];
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
    archiveGenres: false,
    pageSize: 100,
    delayMs: 150
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.startsWith("--") ? arg.slice(2).split("=", 2) : [arg, undefined];
    const value = inlineValue ?? args[index + 1];

    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--archive-genres") {
      options.archiveGenres = true;
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

function textFromProperty(property: unknown) {
  const record = asRecord(property);
  if (!record) return "";
  if (record.type === "rich_text") return plainTextFromRichText(record.rich_text).trim();
  if (record.type === "title") return plainTextFromRichText(record.title).trim();
  if (record.type === "multi_select") return namesFromProperty(record).join(" / ");
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

function splitTextList(value: string) {
  return value.split(/\s*(?:\/|,|，|、)\s*/u).map((item) => item.trim()).filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

function richText(content: string) {
  return [{ type: "text", text: { content } }];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function planForPage(page: JsonRecord): GenrePlan {
  const properties = asRecord(page.properties) ?? {};
  const externalGenres = namesFromProperty(properties.Genres);
  const existingCanonical = namesFromProperty(properties["旨趣"]);
  const existingExternalText = splitTextList(textFromProperty(properties["外部类型原文"]));
  const existingUnmappedText = splitTextList(textFromProperty(properties["未映射类型"]));
  const mapped = mapExternalGenres(externalGenres);
  const mappedCanonical = unique([...existingCanonical, ...mapped.canonical]);
  const unmappedGenres = unique([...existingUnmappedText, ...mapped.unmapped]);
  const externalRaw = unique([...existingExternalText, ...externalGenres]);
  const updates: string[] = [];

  if (externalGenres.length > 0 && mapped.canonical.some((genre) => !existingCanonical.includes(genre))) {
    updates.push("旨趣");
  }
  if (externalRaw.length > 0 && externalRaw.join(" / ") !== textFromProperty(properties["外部类型原文"])) {
    updates.push("外部类型原文");
  }
  if (unmappedGenres.length > 0 && unmappedGenres.join(" / ") !== textFromProperty(properties["未映射类型"])) {
    updates.push("未映射类型");
    updates.push("Needs Review");
  }

  return {
    pageId: String(page.id ?? ""),
    title: titleFromProperties(properties),
    existingCanonical,
    externalGenres: externalRaw,
    mappedCanonical,
    unmappedGenres,
    updates
  };
}

function genreOptionUpdate(existingProperty: JsonRecord | undefined) {
  const existingOptions = asRecord(existingProperty?.multi_select)?.options;
  const byName = new Map<string, JsonRecord>();
  for (const option of asArray(existingOptions)) {
    const record = asRecord(option);
    const name = typeof record?.name === "string" ? record.name : undefined;
    if (name && record) byName.set(name, record);
  }

  for (const option of canonicalGenreOptions) {
    if (!byName.has(option.name)) {
      byName.set(option.name, option);
    }
  }

  return {
    multi_select: {
      options: [...byName.values()].map((option) => ({
        name: option.name,
        id: option.id,
        color: option.color
      }))
    }
  };
}

async function updateSchema(notion: Client, dataSource: JsonRecord) {
  const properties = asRecord(dataSource.properties) ?? {};
  const patch: JsonRecord = {
    "旨趣": genreOptionUpdate(asRecord(properties["旨趣"])),
    "外部类型原文": properties["外部类型原文"] ? undefined : { rich_text: {} },
    "未映射类型": properties["未映射类型"] ? undefined : { rich_text: {} }
  };
  const filteredPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  if (Object.keys(filteredPatch).length === 0) {
    return [];
  }

  await notion.dataSources.update({
    data_source_id: String(dataSource.id),
    properties: filteredPatch
  } as never);
  return Object.keys(filteredPatch);
}

async function archiveGenresProperty(notion: Client, dataSourceId: string) {
  try {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: {
        Genres: null
      }
    } as never);
    return { archived: true, method: "null" };
  } catch (error) {
    return {
      archived: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
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
  const schemaUpdated = options.apply ? await updateSchema(notion, dataSource) : [];
  let cursor: string | undefined;
  let scanned = 0;
  const plans: GenrePlan[] = [];

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

      if (options.apply && plan.updates.length > 0) {
        const properties: JsonRecord = {};
        if (plan.updates.includes("旨趣")) {
          properties["旨趣"] = { multi_select: plan.mappedCanonical.map((name) => ({ name })) };
        }
        if (plan.updates.includes("外部类型原文")) {
          properties["外部类型原文"] = { rich_text: richText(plan.externalGenres.join(" / ")) };
        }
        if (plan.updates.includes("未映射类型")) {
          properties["未映射类型"] = { rich_text: richText(plan.unmappedGenres.join(" / ")) };
        }
        if (plan.updates.includes("Needs Review")) {
          properties["Needs Review"] = { checkbox: true };
        }
        await notion.pages.update({
          page_id: plan.pageId,
          properties
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

  const archiveAttempt = options.apply && options.archiveGenres
    ? await archiveGenresProperty(notion, dataSourceId)
    : undefined;
  const withExternalGenres = plans.filter((plan) => plan.externalGenres.length > 0);
  const withUpdates = plans.filter((plan) => plan.updates.length > 0);
  const report = {
    mode: options.apply ? "apply" : "dry-run",
    dataSourceId,
    scanned,
    schemaUpdated,
    archiveRequested: options.archiveGenres,
    archiveAttempt,
    summary: {
      withExternalGenres: withExternalGenres.length,
      withUpdates: withUpdates.length,
      withUnmapped: plans.filter((plan) => plan.unmappedGenres.length > 0).length
    },
    unmappedGenres: unique(plans.flatMap((plan) => plan.unmappedGenres)),
    sample: withUpdates.slice(0, 30)
  };
  await writeReport(options.reportPath, report);
  console.log(JSON.stringify({
    mode: report.mode,
    scanned: report.scanned,
    schemaUpdated: report.schemaUpdated,
    archiveRequested: report.archiveRequested,
    archiveAttempt: report.archiveAttempt,
    summary: report.summary,
    unmappedGenres: report.unmappedGenres
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
