import fs from "node:fs";
import dns from "node:dns";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { findExistingWorkMatches } from "./lib/work-title-identity.mjs";

function parseArgs(args = process.argv.slice(2)) {
  const options = { aliases: [] };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = () => args[++index];
    if (name === "--title") options.title = value();
    else if (name === "--year") options.year = Number(value());
    else if (name === "--chinese-title") options.chineseTitle = value();
    else if (name === "--english-title") options.englishTitle = value();
    else if (name === "--original-title") options.originalTitle = value();
    else if (name === "--alias") options.aliases.push(value());
    else if (name === "--douban-id") options.doubanId = value();
    else if (name === "--imdb-id") options.imdbId = value();
    else if (name === "--tmdb-id") options.tmdbId = value();
    else if (name === "--snapshot") options.snapshot = value();
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!options.title && !options.chineseTitle && !options.englishTitle && !options.originalTitle) {
    throw new Error("Provide at least one proposed title.");
  }
  return options;
}

function readEnv() {
  const values = { ...process.env };
  if (!fs.existsSync(".env")) return values;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function installDnsOverride(env) {
  if (!env.NOTION_API_RESOLVE_IP) return;
  const original = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return original(hostname, options, callback);
    if (typeof options === "function") return options(null, env.NOTION_API_RESOLVE_IP, 4);
    if (options?.all) return callback(null, [{ address: env.NOTION_API_RESOLVE_IP, family: 4 }]);
    return callback(null, env.NOTION_API_RESOLVE_IP, 4);
  };
}

function plain(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function propertyValue(property) {
  if (!property) return "";
  if (property.type === "title") return plain(property.title);
  if (property.type === "rich_text") return plain(property.rich_text);
  if (property.type === "number") return property.number;
  return "";
}

export function pageRow(page) {
  const properties = page.properties ?? {};
  const title = propertyValue(Object.values(properties).find((property) => property.type === "title"));
  return {
    pageId: page.id,
    title,
    year: propertyValue(properties["Release Year"]),
    chineseTitle: propertyValue(properties["Simplified Chinese Title"]),
    englishTitle: propertyValue(properties["English Title"]),
    originalTitle: propertyValue(properties["Original Title"]),
    traditionalTaiwanTitle: propertyValue(properties["Traditional Chinese Title (Taiwan)"]),
    traditionalHongKongTitle: propertyValue(properties["Traditional Chinese Title (Hong Kong)"]),
    doubanId: propertyValue(properties["Douban Subject ID"]),
    imdbId: propertyValue(properties["IMDb ID"]),
    tmdbId: propertyValue(properties["TMDB ID"]),
    wwWorkId: propertyValue(properties["WW Work ID"])
  };
}

export function searchTerms(options) {
  return [...new Set([
    options.title,
    options.chineseTitle,
    options.englishTitle,
    options.originalTitle,
    ...(options.aliases ?? []),
    options.doubanId,
    options.imdbId,
    options.tmdbId
  ].map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 8);
}

async function loadLiveWorks(options) {
  const env = readEnv();
  installDnsOverride(env);
  const notion = new Client({ auth: env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN, timeoutMs: 120000 });
  let dataSourceId = env.NOTION_LIBRARY_DATA_SOURCE_ID || env.NOTION_DATA_SOURCE_ID;
  if (!dataSourceId) {
    const database = await notion.databases.retrieve({ database_id: env.NOTION_LIBRARY_DATABASE_ID || env.NOTION_DATABASE_ID });
    dataSourceId = database.data_sources?.[0]?.id;
  }
  if (!dataSourceId) throw new Error("Set the Notion library data source or database ID.");
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const pageIds = new Set();
  const titleName = Object.entries(dataSource.properties ?? {}).find(([, property]) => property.type === "title")?.[0];
  if (titleName && options.title) {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 5,
      filter: { property: titleName, title: { equals: options.title } }
    });
    for (const page of response.results) pageIds.add(page.id);
  }
  for (const [property, value] of [
    ["Simplified Chinese Title", options.chineseTitle],
    ["English Title", options.englishTitle],
    ["Original Title", options.originalTitle],
    ["Traditional Chinese Title (Taiwan)", options.traditionalTaiwanTitle],
    ["Traditional Chinese Title (Hong Kong)", options.traditionalHongKongTitle],
    ["Douban Subject ID", options.doubanId],
    ["IMDb ID", options.imdbId],
    ["TMDB ID", options.tmdbId]
  ]) {
    if (!value || dataSource.properties?.[property]?.type !== "rich_text") continue;
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 5,
      filter: { property, rich_text: { equals: value } }
    });
    for (const page of response.results) pageIds.add(page.id);
  }
  for (const query of searchTerms(options)) {
    const response = await notion.search({
      query,
      page_size: 20,
      filter: { property: "object", value: "page" }
    });
    for (const page of response.results) {
      if (page.parent?.type === "data_source_id" && page.parent.data_source_id === dataSourceId) pageIds.add(page.id);
    }
  }
  const pages = await Promise.all([...pageIds].map((pageId) => notion.pages.retrieve({ page_id: pageId })));
  return pages.map(pageRow);
}

export async function runPreflight(options) {
  const snapshot = options.snapshot ? JSON.parse(fs.readFileSync(options.snapshot, "utf8")) : undefined;
  const existingWorks = snapshot
    ? (snapshot.rows ?? snapshot).map((row) => ({ ...row, year: row.year ?? row.releaseYear }))
    : await loadLiveWorks(options);
  const candidate = { ...options };
  const matches = findExistingWorkMatches(candidate, existingWorks);
  return {
    safeToCreate: matches.length === 0,
    candidate,
    matches: matches.map(({ existing, evidence }) => ({ pageId: existing.pageId, title: existing.title, year: existing.year ?? existing.releaseYear, evidence }))
  };
}

async function main() {
  const result = await runPreflight(parseArgs());
  console.log(JSON.stringify(result, null, 2));
  if (!result.safeToCreate) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
