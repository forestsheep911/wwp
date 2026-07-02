import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import {
  collectMetadataHintsFromText,
  createMetadataHints,
  doubanSubjectUrl,
  imdbTitleUrl,
  normalizeDoubanSubjectId,
  normalizeImdbId,
  normalizeTmdbId,
  notionManagedProperties,
  propertySchemaPayload,
  stableMovieWorkIdFromNotion,
  tmdbMovieUrl,
  type NotionManagedProperty
} from "./notion-metadata-schema.js";

type JsonRecord = Record<string, unknown>;

interface LibraryMetadata {
  dataSourceId: string;
  titleProperty?: string;
  properties: JsonRecord;
}

interface MaintenanceOptions {
  apply: boolean;
  schema: boolean;
  pages: boolean;
  query?: string;
  pageId?: string;
  reportPath?: string;
  dataSourceId?: string;
  databaseId?: string;
  rootPageId?: string;
  limit: number;
  pageSize: number;
  blockDepth: number;
  blockLimit: number;
  delayMs: number;
}

interface PagePlan {
  pageId: string;
  title: string;
  url?: string;
  updates: Record<string, unknown>;
  parsed: {
    workId: string;
    imdb?: string;
    douban?: string;
    tmdb?: string;
  };
  conflicts: string[];
}

const requestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const rootPageId = process.env.NOTION_LIBRARY_ROOT_PAGE_ID ?? process.env.PAGE_ID;
const configuredDataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const configuredDatabaseId = process.env.NOTION_LIBRARY_DATABASE_ID ?? process.env.NOTION_MEDIA_DATABASE_ID;

function asRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
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

function parseArgs(): MaintenanceOptions {
  const args = process.argv.slice(2);
  const has = (name: string) => args.includes(name);
  const value = (name: string, fallback: string) => {
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) {
      return inline.slice(prefix.length);
    }
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };

  const schemaOnly = has("--schema-only");
  const pagesOnly = has("--pages-only");
  return {
    apply: has("--apply"),
    schema: !pagesOnly,
    pages: !schemaOnly,
    query: value("--query", "").trim() || undefined,
    pageId: extractNotionId(value("--page-id", "") || value("--page-url", "")) ?? undefined,
    reportPath: value("--report", "").trim() || undefined,
    dataSourceId: extractNotionId(value("--data-source-id", "")) ?? undefined,
    databaseId: extractNotionId(value("--database-id", "")) ?? undefined,
    rootPageId: extractNotionId(value("--root-page-id", "")) ?? undefined,
    limit: Math.max(1, Math.floor(Number(value("--limit", "25")))),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(value("--page-size", "25"))))),
    blockDepth: Math.max(0, Math.floor(Number(value("--block-depth", "1")))),
    blockLimit: Math.max(1, Math.floor(Number(value("--block-limit", "120")))),
    delayMs: Math.max(0, Math.floor(Number(value("--delay-ms", "250"))))
  };
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

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      const text = richTextPlain(record.title);
      if (text) {
        return text;
      }
    }
  }
  return "Untitled Notion page";
}

function richTextPlain(value: unknown) {
  return asArray(value)
    .map((item) => asString(asRecord(item)?.plain_text))
    .filter(Boolean)
    .join("");
}

function propertyText(value: unknown) {
  const property = asRecord(value);
  if (!property) {
    return "";
  }

  const type = asString(property.type);
  if (type === "title" || type === "rich_text") {
    return richTextPlain(property[type]);
  }
  if (type === "url") {
    return asString(property.url);
  }
  if (type === "number") {
    return typeof property.number === "number" ? `${property.number}` : "";
  }
  if (type === "date") {
    return asString(asRecord(property.date)?.start);
  }
  if (type === "select" || type === "status") {
    return asString(asRecord(property[type])?.name);
  }
  if (type === "multi_select") {
    return asArray(property.multi_select)
      .map((item) => asString(asRecord(item)?.name))
      .filter(Boolean)
      .join(" ");
  }
  if (type === "files") {
    return asArray(property.files)
      .map((file) => {
        const record = asRecord(file);
        const externalUrl = asString(asRecord(record?.external)?.url);
        const fileUrl = asString(asRecord(record?.file)?.url);
        return [asString(record?.name), externalUrl || fileUrl].filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join(" ");
  }

  const formula = asRecord(property.formula);
  return [
    asString(formula?.string),
    typeof formula?.number === "number" ? `${formula.number}` : "",
    asString(asRecord(formula?.date)?.start)
  ].filter(Boolean).join(" ");
}

function readManagedText(properties: JsonRecord, names: string[]) {
  for (const name of names) {
    const text = propertyText(properties[name]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function readUrl(properties: JsonRecord, name: string) {
  const property = asRecord(properties[name]);
  return property?.type === "url" ? asString(property.url) : undefined;
}

function readMultiSelect(properties: JsonRecord, name: string) {
  const property = asRecord(properties[name]);
  return property?.type === "multi_select"
    ? asArray(property.multi_select).map((item) => asString(asRecord(item)?.name)).filter(Boolean)
    : [];
}

function yearFromTitle(title: string) {
  return title.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/)?.[1];
}

function pagePropertyValue(type: NotionManagedProperty["type"], value: string | number | boolean | string[] | undefined) {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (type === "rich_text") {
    return { rich_text: [{ type: "text", text: { content: String(value) } }] };
  }
  if (type === "url") {
    return { url: String(value) };
  }
  if (type === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? { number: numeric } : undefined;
  }
  if (type === "date") {
    return { date: { start: String(value) } };
  }
  if (type === "checkbox") {
    return { checkbox: Boolean(value) };
  }
  if (type === "select") {
    return { select: { name: String(value) } };
  }
  if (type === "multi_select") {
    const values = Array.isArray(value) ? value : [String(value)];
    return { multi_select: values.filter(Boolean).map((name) => ({ name })) };
  }
  return undefined;
}

function managedProperty(name: string) {
  return notionManagedProperties.find((property) => property.name === name);
}

function addUpdate(
  updates: Record<string, unknown>,
  availableProperties: JsonRecord,
  pageProperties: JsonRecord,
  name: string,
  value: string | number | boolean | string[] | undefined,
  options: { overwrite?: boolean } = {}
) {
  const schema = managedProperty(name);
  if (!schema || !availableProperties[name]) {
    return;
  }

  const currentText = propertyText(pageProperties[name]);
  const shouldWrite = options.overwrite || !currentText;
  if (!shouldWrite) {
    return;
  }

  const payload = pagePropertyValue(schema.type, value);
  if (payload) {
    updates[name] = payload;
  }
}

function combineSources(pageProperties: JsonRecord, source: string) {
  return [...new Set([...readMultiSelect(pageProperties, "Metadata Source"), source])];
}

function blockText(block: JsonRecord) {
  const type = asString(block.type);
  const payload = asRecord(block[type]);
  if (!payload) {
    return "";
  }

  const parts = [
    asString(payload.url),
    asString(asRecord(payload.external)?.url),
    asString(asRecord(payload.file)?.url),
    richTextPlain(payload.rich_text),
    richTextPlain(payload.caption),
    asString(asRecord(payload.child_page)?.title)
  ];

  if (type === "table_row") {
    for (const cell of asArray(payload.cells)) {
      parts.push(richTextPlain(cell));
    }
  }

  return parts.filter(Boolean).join(" ");
}

async function collectBlockText(
  notion: Client,
  blockId: string,
  options: MaintenanceOptions,
  depth = 0,
  counter = { count: 0 }
): Promise<string[]> {
  if (!blockId || depth > options.blockDepth || counter.count >= options.blockLimit) {
    return [];
  }

  const texts: string[] = [];
  let startCursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: Math.min(100, options.blockLimit - counter.count),
      start_cursor: startCursor
    });

    for (const block of response.results) {
      if (counter.count >= options.blockLimit) {
        break;
      }
      const record = asRecord(block);
      if (!record) {
        continue;
      }
      counter.count += 1;
      const text = blockText(record);
      if (text) {
        texts.push(text);
      }

      const type = asString(record.type);
      const isNestedPage = type === "child_page" || type === "child_database";
      if (record.has_children === true && depth < options.blockDepth && !isNestedPage) {
        texts.push(...await collectBlockText(notion, asString(record.id), options, depth + 1, counter));
      }
    }

    startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (startCursor && counter.count < options.blockLimit);

  return texts;
}

async function loadLibrary(notion: Client, options: MaintenanceOptions): Promise<LibraryMetadata> {
  if (options.dataSourceId ?? configuredDataSourceId) {
    return loadDataSource(notion, (options.dataSourceId ?? configuredDataSourceId)!);
  }

  const databaseId = options.databaseId ?? configuredDatabaseId;
  if (databaseId) {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const dataSources = asArray(asRecord(database)?.data_sources);
    const dataSourceId = asString(asRecord(dataSources[0])?.id) || databaseId;
    return loadDataSource(notion, dataSourceId);
  }

  const libraryRootPageId = options.rootPageId ?? rootPageId;
  if (!libraryRootPageId) {
    throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID, NOTION_LIBRARY_DATABASE_ID, or NOTION_LIBRARY_ROOT_PAGE_ID.");
  }

  const response = await notion.blocks.children.list({
    block_id: libraryRootPageId,
    page_size: 100
  });
  const databases = response.results.filter((block) => asRecord(block)?.type === "child_database");
  if (databases.length !== 1) {
    throw new Error("Library root page must have exactly one direct child database, or configure NOTION_LIBRARY_DATABASE_ID.");
  }

  const childDatabaseId = asString(asRecord(databases[0])?.id);
  if (!childDatabaseId) {
    throw new Error("Could not read the child database id from the library root page.");
  }
  const database = await notion.databases.retrieve({ database_id: childDatabaseId });
  const dataSources = asArray(asRecord(database)?.data_sources);
  const dataSourceId = asString(asRecord(dataSources[0])?.id) || childDatabaseId;
  return loadDataSource(notion, dataSourceId);
}

async function loadDataSource(notion: Client, dataSourceId: string): Promise<LibraryMetadata> {
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = asRecord(asRecord(dataSource)?.properties) ?? {};
  const titleProperty = Object.entries(properties)
    .find(([, property]) => asRecord(property)?.type === "title")?.[0];
  return {
    dataSourceId,
    titleProperty,
    properties
  };
}

function schemaPatch(existingProperties: JsonRecord) {
  const patch: Record<string, unknown> = {};
  for (const property of notionManagedProperties) {
    if (!existingProperties[property.name]) {
      patch[property.name] = propertySchemaPayload(property);
    }
  }
  return patch;
}

async function queryPages(notion: Client, library: LibraryMetadata, options: MaintenanceOptions) {
  if (options.pageId) {
    return [await notion.pages.retrieve({ page_id: options.pageId }) as JsonRecord];
  }

  const pages: JsonRecord[] = [];
  let startCursor: string | undefined;

  do {
    const request: JsonRecord = {
      data_source_id: library.dataSourceId,
      page_size: Math.min(options.pageSize, options.limit - pages.length),
      start_cursor: startCursor,
      result_type: "page",
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }]
    };

    if (options.query && library.titleProperty) {
      request.filter = {
        property: library.titleProperty,
        title: {
          contains: options.query
        }
      };
    }

    const response = await notion.dataSources.query(request as never);

    pages.push(...response.results.map((page) => asRecord(page)).filter((page): page is JsonRecord => Boolean(page)));
    startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (startCursor && pages.length < options.limit);

  return pages.slice(0, options.limit);
}

async function planPage(
  notion: Client,
  page: JsonRecord,
  availableProperties: JsonRecord,
  options: MaintenanceOptions
): Promise<PagePlan> {
  const pageId = asString(page.id);
  const pageProperties = asRecord(page.properties) ?? {};
  const title = titleFromProperties(pageProperties);
  const pageUrl = asString(page.url) || undefined;
  const hints = createMetadataHints();

  for (const [name, property] of Object.entries(pageProperties)) {
    collectMetadataHintsFromText(hints, `${name} ${propertyText(property)}`);
  }
  for (const text of await collectBlockText(notion, pageId, options)) {
    collectMetadataHintsFromText(hints, text);
  }

  const existingImdb = normalizeImdbId(readManagedText(pageProperties, ["IMDb ID", "IMDb", "IMDB"]));
  const existingDouban = normalizeDoubanSubjectId(readManagedText(pageProperties, ["Douban Subject ID", "Douban", "\u8c46\u74e3"]));
  const existingTmdb = normalizeTmdbId(readManagedText(pageProperties, ["TMDB ID", "TMDB"]));
  const parsedImdb = hints.externalIds.imdb;
  const parsedDouban = hints.externalIds.douban;
  const parsedTmdb = hints.externalIds.tmdb;
  const imdb = existingImdb ?? parsedImdb;
  const douban = existingDouban ?? parsedDouban;
  const tmdb = existingTmdb ?? parsedTmdb;
  const year = yearFromTitle(title);
  const workId = readManagedText(pageProperties, ["WW Work ID"]) ?? stableMovieWorkIdFromNotion(pageId, title, year);
  const conflicts = [
    existingImdb && parsedImdb && existingImdb !== parsedImdb ? `IMDb ${existingImdb} != ${parsedImdb}` : undefined,
    existingDouban && parsedDouban && existingDouban !== parsedDouban ? `Douban ${existingDouban} != ${parsedDouban}` : undefined,
    existingTmdb && parsedTmdb && existingTmdb !== parsedTmdb ? `TMDB ${existingTmdb} != ${parsedTmdb}` : undefined
  ].filter((value): value is string => Boolean(value));
  const hasExternalId = Boolean(imdb || douban || tmdb);
  const updates: Record<string, unknown> = {};

  addUpdate(updates, availableProperties, pageProperties, "WW Work ID", workId);
  addUpdate(updates, availableProperties, pageProperties, "IMDb ID", imdb);
  addUpdate(updates, availableProperties, pageProperties, "IMDb URL", imdbTitleUrl(imdb));
  addUpdate(updates, availableProperties, pageProperties, "Douban Subject ID", douban);
  addUpdate(updates, availableProperties, pageProperties, "Douban URL", doubanSubjectUrl(douban));
  addUpdate(updates, availableProperties, pageProperties, "TMDB ID", tmdb);
  addUpdate(updates, availableProperties, pageProperties, "TMDB URL", tmdbMovieUrl(tmdb));
  addUpdate(updates, availableProperties, pageProperties, "Release Year", year ? Number(year) : undefined);
  addUpdate(updates, availableProperties, pageProperties, "Match Status", conflicts.length > 0 ? "conflict" : hasExternalId ? "candidate" : "unmatched");
  addUpdate(updates, availableProperties, pageProperties, "Metadata Status", conflicts.length > 0 ? "conflict" : hasExternalId ? "partial" : "draft");
  addUpdate(updates, availableProperties, pageProperties, "Metadata Source", combineSources(pageProperties, hasExternalId ? "notion-text" : "notion-page"));
  addUpdate(updates, availableProperties, pageProperties, "Metadata Confidence", conflicts.length > 0 ? 0.2 : hasExternalId ? 0.9 : 0.3);
  addUpdate(updates, availableProperties, pageProperties, "Needs Review", conflicts.length > 0 || !hasExternalId, { overwrite: conflicts.length > 0 });
  addUpdate(updates, availableProperties, pageProperties, "Metadata Updated At", new Date().toISOString().slice(0, 10), { overwrite: Object.keys(updates).length > 0 });

  return {
    pageId,
    title,
    url: pageUrl,
    updates,
    parsed: {
      workId,
      imdb,
      douban,
      tmdb
    },
    conflicts
  };
}

async function main() {
  const options = parseArgs();
  const token = options.apply
    ? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error(options.apply
      ? "Set NOTION_WRITE_TOKEN or NOTION_TOKEN before running with --apply."
      : "Set NOTION_WRITE_TOKEN, NOTION_TOKEN, or NOTION_READ_ONLY_TOKEN.");
  }

  const notion = new Client({ auth: token, timeoutMs: requestTimeoutMs });
  const library = await loadLibrary(notion, options);
  const missingSchema = schemaPatch(library.properties);
  const plannedPages: PagePlan[] = [];
  let availableProperties = library.properties;

  if (options.schema && Object.keys(missingSchema).length > 0) {
    if (options.apply) {
      await notion.dataSources.update({
        data_source_id: library.dataSourceId,
        properties: missingSchema
      } as never);
    }
    availableProperties = {
      ...availableProperties,
      ...Object.fromEntries(Object.keys(missingSchema).map((name) => [name, { type: managedProperty(name)?.type }]))
    };
  }

  if (options.pages) {
    const pages = await queryPages(notion, library, options);
    for (const page of pages) {
      const plan = await planPage(notion, page, availableProperties, options);
      plannedPages.push(plan);
      if (options.apply && Object.keys(plan.updates).length > 0) {
        await notion.pages.update({
          page_id: plan.pageId,
          properties: plan.updates
        } as never);
      }
      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  }

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    dataSourceId: library.dataSourceId,
    query: options.query,
    pageId: options.pageId,
    schema: {
      managedPropertyCount: notionManagedProperties.length,
      missingCount: Object.keys(missingSchema).length,
      missing: Object.keys(missingSchema)
    },
    pages: {
      scanned: plannedPages.length,
      withUpdates: plannedPages.filter((page) => Object.keys(page.updates).length > 0).length,
      withExternalIds: plannedPages.filter((page) => page.parsed.imdb || page.parsed.douban || page.parsed.tmdb).length,
      conflicts: plannedPages.filter((page) => page.conflicts.length > 0).length,
      withoutExternalIds: plannedPages
        .filter((page) => !page.parsed.imdb && !page.parsed.douban && !page.parsed.tmdb)
        .map((page) => ({
          title: page.title,
          pageId: page.pageId,
          url: page.url,
          workId: page.parsed.workId,
          updateFields: Object.keys(page.updates)
        })),
      conflictDetails: plannedPages
        .filter((page) => page.conflicts.length > 0)
        .map((page) => ({
          title: page.title,
          pageId: page.pageId,
          url: page.url,
          parsed: page.parsed,
          conflicts: page.conflicts,
          updateFields: Object.keys(page.updates)
        })),
      sample: plannedPages
        .filter((page) => Object.keys(page.updates).length > 0 || page.conflicts.length > 0)
        .slice(0, 20)
        .map((page) => ({
          title: page.title,
          pageId: page.pageId,
          parsed: page.parsed,
          conflicts: page.conflicts,
          updateFields: Object.keys(page.updates)
        }))
    }
  };

  if (options.reportPath) {
    const reportPath = path.isAbsolute(options.reportPath)
      ? options.reportPath
      : path.resolve(repoRoot, options.reportPath);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
