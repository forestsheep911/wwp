#!/usr/bin/env node

import fs from "node:fs";
import dns from "node:dns";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { compareNotionMediaType, expectedNotionMediaType } from "./lib/work-media-type.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");

export function parseArgs(argv) {
  const options = { apply: false, db: DEFAULT_DB };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") options.type = argv[++i];
    else if (arg === "--work-id") options.workId = Number(argv[++i]);
    else if (arg === "--page-id") options.pageId = argv[++i];
    else if (arg === "--db") options.db = path.resolve(argv[++i]);
    else if (arg === "--title") options.title = argv[++i];
    else if (arg === "--chinese-title") options.chineseTitle = argv[++i];
    else if (arg === "--english-title") options.englishTitle = argv[++i];
    else if (arg === "--year") options.year = Number(argv[++i]);
    else if (arg === "--douban-id") options.doubanId = argv[++i];
    else if (arg === "--imdb-id") options.imdbId = argv[++i];
    else if (arg === "--apply") options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.workId) || options.workId < 1) {
    throw new Error("--work-id is required so 影别 comes from the verified ledger identity");
  }
  if (!options.pageId && !options.title) throw new Error("--title is required when creating or finding a page");
  if (options.type && !["movie", "series"].includes(options.type)) throw new Error("--type must be movie or series");
  return options;
}

export function ledgerWorkForOptions(options) {
  const db = openLedger(options.db);
  try {
    const work = db.prepare("SELECT * FROM works WHERE id=?").get(options.workId);
    if (!work) throw new Error(`Ledger work not found: ${options.workId}`);
    if (options.type && options.type !== work.work_type) {
      throw new Error(`--type=${options.type} conflicts with ledger work_type=${work.work_type} for work ${work.id}`);
    }
    if (options.pageId && work.notion_work_page_id && work.notion_work_page_id.replaceAll("-", "") !== options.pageId.replaceAll("-", "")) {
      throw new Error(`--page-id does not match ledger work ${work.id} notion_work_page_id`);
    }
    expectedNotionMediaType(work.work_type);
    return work;
  } finally {
    db.close();
  }
}

function linkLedgerWorkPage(options, work, pageId) {
  const db = openLedger(options.db);
  try {
    const duplicate = db.prepare("SELECT id FROM works WHERE notion_work_page_id=? AND id<>?").get(pageId, work.id);
    if (duplicate) throw new Error(`Notion page ${pageId} is already linked to ledger work ${duplicate.id}`);
    const current = db.prepare("SELECT notion_work_page_id FROM works WHERE id=?").get(work.id)?.notion_work_page_id;
    if (current && current.replaceAll("-", "") !== pageId.replaceAll("-", "")) {
      throw new Error(`Ledger work ${work.id} is already linked to a different Notion page`);
    }
    db.prepare("UPDATE works SET notion_work_page_id=COALESCE(notion_work_page_id, ?), updated_at=? WHERE id=?")
      .run(pageId, new Date().toISOString(), work.id);
  } finally {
    db.close();
  }
}

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(".env")) return undefined;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match?.[1] === name) return match[2].trim().replace(/^['"]|['"]$/gu, "");
  }
  return undefined;
}

function installDnsOverride() {
  const address = env("NOTION_API_RESOLVE_IP");
  if (!address) return;
  const original = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return original(hostname, options, callback);
    if (typeof options === "function") return options(null, address, 4);
    if (options?.all) return callback(null, [{ address, family: 4 }]);
    return callback(null, address, 4);
  };
}

function richText(value) {
  return [{ type: "text", text: { content: value } }];
}

function propertyName(dataSource, name, type) {
  return dataSource.properties?.[name]?.type === type ? name : undefined;
}

function put(properties, dataSource, name, value, type, payload) {
  const actual = propertyName(dataSource, name, type);
  if (actual && value !== undefined && value !== "") properties[actual] = payload(value);
}

async function loadLibrary(notion) {
  let dataSourceId = env("NOTION_LIBRARY_DATA_SOURCE_ID") || env("NOTION_DATA_SOURCE_ID");
  let databaseId = env("NOTION_LIBRARY_DATABASE_ID") || env("NOTION_DATABASE_ID");
  if (!dataSourceId) {
    if (!databaseId) throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_LIBRARY_DATABASE_ID");
    const database = await notion.databases.retrieve({ database_id: databaseId });
    dataSourceId = database.data_sources?.[0]?.id;
  }
  if (!dataSourceId) throw new Error("No Notion library data source found");
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  return { dataSourceId, databaseId, dataSource };
}

function titleProperty(dataSource) {
  return Object.entries(dataSource.properties ?? {}).find(([, value]) => value.type === "title")?.[0] ?? "Title";
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") return property.title?.map(item => item.plain_text ?? "").join("").trim() ?? "";
  }
  return "";
}

function seasonNumber(title) {
  const value = String(title ?? "");
  const arabic = value.match(/(?:第\s*(\d+)\s*季|\bseason\s*(\d+)\b|\bs(\d{1,2})\b)/iu);
  if (arabic) return Number(arabic[1] ?? arabic[2] ?? arabic[3]);
  const chinese = value.match(/第\s*([一二三四五六七八九十])\s*季/u);
  if (!chinese) return undefined;
  return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[chinese[1]];
}

export function canReuseIdentityMatch(page, options) {
  if (options.type !== "series") return true;
  const existingSeason = seasonNumber(pageTitle(page));
  const requestedSeason = seasonNumber(options.title);
  // A series IMDb ID identifies the show, not an individual season. Never
  // merge two explicitly different season pages merely because the ID is the same.
  if (existingSeason !== undefined || requestedSeason !== undefined) return existingSeason === requestedSeason;
  return true;
}

function selectValue(page, property) {
  return page.properties?.[property]?.select?.name;
}

async function reconcileMediaType(notion, library, pageId, type, apply) {
  if (!propertyName(library.dataSource, "影别", "select")) return { expected: undefined, actual: undefined, corrected: false };

  const expected = expectedNotionMediaType(type);
  let page = await notion.pages.retrieve({ page_id: pageId });
  let actual = selectValue(page, "影别");
  if (actual === expected) return { expected, actual, corrected: false, lastEditedTime: page.last_edited_time ?? null };

  if (!apply) return { expected, actual, corrected: false, wouldCorrect: true, lastEditedTime: page.last_edited_time ?? null };

  await notion.pages.update({
    page_id: pageId,
    properties: { "影别": { select: { name: expected } } }
  });
  page = await notion.pages.retrieve({ page_id: pageId });
  actual = selectValue(page, "影别");
  if (actual !== expected) throw new Error(`Work page ${pageId} has 影别=${actual ?? "(empty)"}; expected ${expected}`);
  return { expected, actual, corrected: true, lastEditedTime: page.last_edited_time ?? null };
}

async function findExistingIdentity(notion, library, options) {
  const candidates = [
    ["Douban Subject ID", options.doubanId],
    ["IMDb ID", options.imdbId],
    ["imdb", options.imdbId]
  ].filter(([name, value]) => value && propertyName(library.dataSource, name, "rich_text"));

  for (const [property, value] of candidates) {
    const response = await notion.dataSources.query({
      data_source_id: library.dataSourceId,
      page_size: 5,
      filter: { property, rich_text: { equals: value } }
    });
    if (response.results?.[0] && canReuseIdentityMatch(response.results[0], options)) {
      return { page: response.results[0], property, value };
    }
  }
  return undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const work = ledgerWorkForOptions(options);
  options.type = work.work_type;
  options.title ??= work.canonical_title;
  installDnsOverride();
  const token = env("NOTION_WRITE_TOKEN") || env("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_WRITE_TOKEN or NOTION_TOKEN is required");
  const notion = new Client({ auth: token, timeoutMs: 120000 });
  const library = await loadLibrary(notion);
  if (options.pageId) {
    const page = await notion.pages.retrieve({ page_id: options.pageId });
    const currentType = selectValue(page, "影别");
    const comparison = compareNotionMediaType(work.work_type, currentType);
    const mediaType = await reconcileMediaType(notion, library, page.id, work.work_type, options.apply);
    if (options.apply) linkLedgerWorkPage(options, work, page.id);
    console.log(JSON.stringify({ status: "existing_page", workId: work.id, pageId: page.id, title: options.title, comparison, mediaType }));
    return;
  }
  const existing = await notion.dataSources.query({
    data_source_id: library.dataSourceId,
    page_size: 5,
    filter: { property: titleProperty(library.dataSource), title: { equals: options.title } }
  });
  if (existing.results?.[0]) {
    const mediaType = await reconcileMediaType(notion, library, existing.results[0].id, options.type, options.apply);
    if (options.apply) linkLedgerWorkPage(options, work, existing.results[0].id);
    console.log(JSON.stringify({ status: "existing", workId: work.id, pageId: existing.results[0].id, title: options.title, mediaType }));
    return;
  }
  const identityMatch = await findExistingIdentity(notion, library, options);
  if (identityMatch) {
    const mediaType = await reconcileMediaType(notion, library, identityMatch.page.id, options.type, options.apply);
    if (options.apply) linkLedgerWorkPage(options, work, identityMatch.page.id);
    console.log(JSON.stringify({
      status: "existing_identity",
      workId: work.id,
      pageId: identityMatch.page.id,
      title: options.title,
      matchedProperty: identityMatch.property,
      matchedValue: identityMatch.value,
      mediaType
    }));
    return;
  }

  const properties = { [titleProperty(library.dataSource)]: { title: richText(options.title) } };
  put(properties, library.dataSource, "Simplified Chinese Title", options.chineseTitle, "rich_text", value => ({ rich_text: richText(value) }));
  put(properties, library.dataSource, "English Title", options.englishTitle, "rich_text", value => ({ rich_text: richText(value) }));
  put(properties, library.dataSource, "Release Year", options.year, "number", value => ({ number: value }));
  put(properties, library.dataSource, "影别", options.type === "series" ? "TV Series" : "Movie", "select", value => ({ select: { name: value } }));
  put(properties, library.dataSource, "Douban Subject ID", options.doubanId, "rich_text", value => ({ rich_text: richText(value) }));
  put(properties, library.dataSource, "IMDb ID", options.imdbId, "rich_text", value => ({ rich_text: richText(value) }));
  put(properties, library.dataSource, "Hide from Website", true, "checkbox", value => ({ checkbox: value }));
  put(properties, library.dataSource, "Needs Review", true, "checkbox", value => ({ checkbox: value }));
  put(properties, library.dataSource, "Media Availability", "needs_processing", "select", value => ({ select: { name: value } }));
  put(properties, library.dataSource, "Developer Memo", "Metadata-first page created before playable production. Keep hidden and Needs Review until metadata readback and any later media workflow are complete.", "rich_text", value => ({ rich_text: richText(value) }));

  if (!options.apply) {
    console.log(JSON.stringify({ status: "would_create", title: options.title, type: options.type, properties }, null, 2));
    return;
  }
  let page;
  try {
    page = await notion.pages.create({
      parent: { data_source_id: library.dataSourceId },
      properties
    });
  } catch (error) {
    if (!library.databaseId) throw error;
    console.log(`data_source parent create failed; retry with database parent: ${error.message}`);
    page = await notion.pages.create({
      parent: { database_id: library.databaseId },
      properties
    });
  }
  const mediaType = await reconcileMediaType(notion, library, page.id, options.type, true);
  linkLedgerWorkPage(options, work, page.id);
  console.log(JSON.stringify({ status: "created", workId: work.id, pageId: page.id, title: options.title, mediaType }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
