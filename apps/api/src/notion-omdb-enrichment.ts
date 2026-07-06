import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import {
  normalizeImdbId,
  notionManagedProperties,
  propertySchemaPayload,
  type NotionManagedProperty
} from "./notion-metadata-schema.js";

type JsonRecord = Record<string, unknown>;

interface EnrichmentOptions {
  apply: boolean;
  includeNonMovies: boolean;
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

interface OmdbPayload {
  Title?: string;
  Year?: string;
  Rated?: string;
  Released?: string;
  Runtime?: string;
  Genre?: string;
  Director?: string;
  Writer?: string;
  Actors?: string;
  Plot?: string;
  Language?: string;
  Country?: string;
  Poster?: string;
  Metascore?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Type?: string;
  BoxOffice?: string;
  Ratings?: Array<{ Source?: string; Value?: string }>;
  Response?: string;
  Error?: string;
}

interface PagePlan {
  pageId: string;
  title: string;
  url?: string;
  imdb?: string;
  omdbTitle?: string;
  updateFields: string[];
  updates: Record<string, unknown>;
  skipped?: string;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const rootPageId = process.env.NOTION_LIBRARY_ROOT_PAGE_ID ?? process.env.PAGE_ID;
const configuredDataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const configuredDatabaseId = process.env.NOTION_LIBRARY_DATABASE_ID ?? process.env.NOTION_MEDIA_DATABASE_ID;
const notionRequestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);
const omdbRequestTimeoutMs = Math.max(1000, Number(process.env.OMDB_REQUEST_TIMEOUT_MS ?? 5000));
let notionDnsOverrideInstalled = false;

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

function parseArgs(): EnrichmentOptions {
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

  return {
    apply: has("--apply"),
    includeNonMovies: has("--include-non-movies"),
    limit: Math.max(1, Math.floor(Number(value("--limit", "25")))),
    maxUpdates: Math.max(1, Math.floor(Number(value("--max-updates", "5")))),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(value("--page-size", "25"))))),
    delayMs: Math.max(0, Math.floor(Number(value("--delay-ms", "250")))),
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
  if (type === "checkbox") {
    return typeof property.checkbox === "boolean" ? String(property.checkbox) : "";
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

  const formula = asRecord(property.formula);
  return [
    asString(formula?.string),
    typeof formula?.number === "number" ? `${formula.number}` : "",
    asString(asRecord(formula?.date)?.start)
  ].filter(Boolean).join(" ");
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") {
      const title = richTextPlain(record.title);
      if (title) {
        return title;
      }
    }
  }
  return "Untitled Notion page";
}

function managedProperty(name: string) {
  return notionManagedProperties.find((property) => property.name === name);
}

function pagePropertyValue(type: NotionManagedProperty["type"], value: string | number | boolean | string[] | undefined) {
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
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
  if (!options.overwrite && currentText) {
    return;
  }

  const payload = pagePropertyValue(schema.type, value);
  if (payload) {
    updates[name] = payload;
  }
}

function readMultiSelect(properties: JsonRecord, name: string) {
  const property = asRecord(properties[name]);
  return property?.type === "multi_select"
    ? asArray(property.multi_select).map((item) => asString(asRecord(item)?.name)).filter(Boolean)
    : [];
}

function combineSources(pageProperties: JsonRecord, source: string) {
  return [...new Set([...readMultiSelect(pageProperties, "Metadata Source"), source])];
}

function splitList(value?: string) {
  if (!value || /^N\/A$/i.test(value)) {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function cleanOmdbText(value?: string) {
  if (!value || /^N\/A$/i.test(value.trim())) {
    return undefined;
  }
  return value.trim();
}

function runtimeMinutes(runtime?: string) {
  const minutes = runtime?.match(/\b(\d+)\s*min\b/i)?.[1];
  return minutes ? Number(minutes) : undefined;
}

function releaseDate(value?: string) {
  const cleaned = cleanOmdbText(value);
  if (!cleaned) {
    return undefined;
  }
  const time = Date.parse(cleaned);
  if (!Number.isFinite(time)) {
    return undefined;
  }
  return new Date(time).toISOString().slice(0, 10);
}

function releaseYear(payload: OmdbPayload) {
  return cleanOmdbText(payload.Year)?.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/)?.[1];
}

function parseMoneyAmount(value?: string) {
  const cleaned = cleanOmdbText(value);
  const match = cleaned?.match(/(?:[$£€¥]\s*)?([\d,]+(?:\.\d+)?)/);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function numericText(value?: string) {
  const cleaned = cleanOmdbText(value);
  if (!cleaned) return undefined;
  const number = Number(cleaned.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : undefined;
}

function rottenTomatoesScore(payload: OmdbPayload) {
  const rating = payload.Ratings?.find((item) => /rotten\s+tomatoes/i.test(item.Source ?? ""));
  return numericText(rating?.Value);
}

function omdbRated(value?: string) {
  const cleaned = cleanOmdbText(value);
  if (!cleaned) return undefined;
  if (/^(?:not rated|unrated|n\/?a)$/i.test(cleaned)) return ["未分级"];
  return [cleaned];
}

function moneyCurrency(value?: string) {
  const cleaned = cleanOmdbText(value);
  if (!cleaned) {
    return undefined;
  }
  if (/\$|USD|US\$/i.test(cleaned)) return "USD";
  if (/£|GBP/i.test(cleaned)) return "GBP";
  if (/€|EUR/i.test(cleaned)) return "EUR";
  if (/¥|JPY/i.test(cleaned)) return "JPY";
  return undefined;
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

async function loadLibrary(notion: Client, options: EnrichmentOptions): Promise<LibraryMetadata> {
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

  const response = await notion.blocks.children.list({ block_id: libraryRootPageId, page_size: 100 });
  const databases = response.results.filter((block) => asRecord(block)?.type === "child_database");
  if (databases.length !== 1) {
    throw new Error("Library root page must have exactly one direct child database, or configure NOTION_LIBRARY_DATABASE_ID.");
  }

  const childDatabaseId = asString(asRecord(databases[0])?.id);
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
  return { dataSourceId, titleProperty, properties };
}

async function queryPages(notion: Client, library: LibraryMetadata, options: EnrichmentOptions) {
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
        title: { contains: options.query }
      };
    }

    const response = await notion.dataSources.query(request as never);
    pages.push(...response.results.map((page) => asRecord(page)).filter((page): page is JsonRecord => Boolean(page)));
    startCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (startCursor && pages.length < options.limit);

  return pages.slice(0, options.limit);
}

async function fetchOmdb(imdbId: string, apiKey: string) {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("i", imdbId);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(omdbRequestTimeoutMs) });
  if (!response.ok) {
    throw new Error(`OMDb request failed for ${imdbId}: ${response.status}`);
  }

  const payload = await response.json() as OmdbPayload;
  return payload.Response === "False" ? undefined : payload;
}

function planUpdates(
  page: JsonRecord,
  availableProperties: JsonRecord,
  options: EnrichmentOptions,
  payload?: OmdbPayload
): PagePlan {
  const pageProperties = asRecord(page.properties) ?? {};
  const pageId = asString(page.id);
  const title = titleFromProperties(pageProperties);
  const imdb = normalizeImdbId(propertyText(pageProperties["IMDb ID"]) || propertyText(pageProperties["IMDb"]));
  const updates: Record<string, unknown> = {};

  if (!imdb) {
    return { pageId, title, url: asString(page.url) || undefined, updates, updateFields: [], skipped: "missing_imdb" };
  }
  if (!payload) {
    return { pageId, title, url: asString(page.url) || undefined, imdb, updates, updateFields: [], skipped: "omdb_not_found" };
  }
  if (!options.includeNonMovies && cleanOmdbText(payload.Type) !== "movie") {
    return { pageId, title, url: asString(page.url) || undefined, imdb, omdbTitle: cleanOmdbText(payload.Title), updates, updateFields: [], skipped: `omdb_type_${cleanOmdbText(payload.Type) ?? "unknown"}` };
  }

  const genres = splitList(payload.Genre);
  const countries = splitList(payload.Country);
  const languages = splitList(payload.Language);
  const omdbTitle = cleanOmdbText(payload.Title);
  const poster = cleanOmdbText(payload.Poster);
  const boxOffice = cleanOmdbText(payload.BoxOffice);

  addUpdate(updates, availableProperties, pageProperties, "English Title", omdbTitle);
  addUpdate(updates, availableProperties, pageProperties, "Release Year", releaseYear(payload) ? Number(releaseYear(payload)) : undefined);
  addUpdate(updates, availableProperties, pageProperties, "Release Date", releaseDate(payload.Released));
  addUpdate(updates, availableProperties, pageProperties, "Countries", countries);
  addUpdate(updates, availableProperties, pageProperties, "Languages", languages);
  addUpdate(updates, availableProperties, pageProperties, "Genres", genres);
  addUpdate(updates, availableProperties, pageProperties, "Runtime Minutes", runtimeMinutes(payload.Runtime));
  addUpdate(updates, availableProperties, pageProperties, "Directors", cleanOmdbText(payload.Director));
  addUpdate(updates, availableProperties, pageProperties, "Writers", cleanOmdbText(payload.Writer));
  addUpdate(updates, availableProperties, pageProperties, "Cast", cleanOmdbText(payload.Actors));
  addUpdate(updates, availableProperties, pageProperties, "分级", omdbRated(payload.Rated));
  addUpdate(updates, availableProperties, pageProperties, "IMDB评分", numericText(payload.imdbRating));
  addUpdate(updates, availableProperties, pageProperties, "Metascore", numericText(payload.Metascore));
  addUpdate(updates, availableProperties, pageProperties, "烂番茄新鲜度", rottenTomatoesScore(payload));
  addUpdate(updates, availableProperties, pageProperties, "Poster URL", poster);
  addUpdate(updates, availableProperties, pageProperties, "Box Office", boxOffice);
  addUpdate(updates, availableProperties, pageProperties, "Box Office Amount", parseMoneyAmount(boxOffice));
  addUpdate(updates, availableProperties, pageProperties, "Box Office Currency", moneyCurrency(boxOffice));
  addUpdate(updates, availableProperties, pageProperties, "Box Office Source", boxOffice ? "omdb" : undefined);
  addUpdate(updates, availableProperties, pageProperties, "Metadata Source", combineSources(pageProperties, "omdb"));
  addUpdate(updates, availableProperties, pageProperties, "Metadata Status", "partial");
  addUpdate(updates, availableProperties, pageProperties, "Metadata Updated At", new Date().toISOString().slice(0, 10), { overwrite: Object.keys(updates).length > 0 });

  return {
    pageId,
    title,
    url: asString(page.url) || undefined,
    imdb,
    omdbTitle,
    updates,
    updateFields: Object.keys(updates)
  };
}

async function main() {
  const options = parseArgs();
  const notionToken = options.apply
    ? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  const omdbApiKey = process.env.OMDB_API_KEY?.trim();
  if (!notionToken) {
    throw new Error(options.apply
      ? "Set NOTION_WRITE_TOKEN or NOTION_TOKEN before running with --apply."
      : "Set NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN.");
  }
  if (!omdbApiKey) {
    throw new Error("Set OMDB_API_KEY before running Notion OMDb enrichment.");
  }

  installNotionDnsOverride();
  const notion = new Client({ auth: notionToken, timeoutMs: notionRequestTimeoutMs });
  const library = await loadLibrary(notion, options);
  const missingSchema = schemaPatch(library.properties);
  if (Object.keys(missingSchema).length > 0) {
    throw new Error(`Missing Notion managed schema fields: ${Object.keys(missingSchema).join(", ")}. Run notion:metadata -- --apply --schema-only first.`);
  }

  const pages = await queryPages(notion, library, options);
  const plans: PagePlan[] = [];
  let omdbRequests = 0;
  let applied = 0;

  for (const page of pages) {
    const pageProperties = asRecord(page.properties) ?? {};
    const imdb = normalizeImdbId(propertyText(pageProperties["IMDb ID"]) || propertyText(pageProperties["IMDb"]));
    let payload: OmdbPayload | undefined;
    if (imdb) {
      omdbRequests += 1;
      payload = await fetchOmdb(imdb, omdbApiKey);
    }

    const plan = planUpdates(page, library.properties, options, payload);
    plans.push(plan);
    if (options.apply && plan.updateFields.length > 0 && applied < options.maxUpdates) {
      await notion.pages.update({ page_id: plan.pageId, properties: plan.updates } as never);
      applied += 1;
    }

    if (plans.filter((item) => item.updateFields.length > 0).length >= options.maxUpdates) {
      break;
    }
    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    includeNonMovies: options.includeNonMovies,
    dataSourceId: library.dataSourceId,
    limit: options.limit,
    maxUpdates: options.maxUpdates,
    scanned: plans.length,
    omdbRequests,
    withUpdates: plans.filter((plan) => plan.updateFields.length > 0).length,
    applied,
    skipped: plans.reduce<Record<string, number>>((counts, plan) => {
      if (plan.skipped) {
        counts[plan.skipped] = (counts[plan.skipped] ?? 0) + 1;
      }
      return counts;
    }, {}),
    sample: plans.map((plan) => ({
      title: plan.title,
      pageId: plan.pageId,
      url: plan.url,
      imdb: plan.imdb,
      omdbTitle: plan.omdbTitle,
      skipped: plan.skipped,
      updateFields: plan.updateFields
    }))
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
