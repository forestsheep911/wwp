#!/usr/bin/env node

import fs from "node:fs";
import dns from "node:dns";
import { Client } from "@notionhq/client";

function parseArgs(argv) {
  const options = { type: "series", apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--type") options.type = argv[++i];
    else if (arg === "--title") options.title = argv[++i];
    else if (arg === "--chinese-title") options.chineseTitle = argv[++i];
    else if (arg === "--english-title") options.englishTitle = argv[++i];
    else if (arg === "--year") options.year = Number(argv[++i]);
    else if (arg === "--douban-id") options.doubanId = argv[++i];
    else if (arg === "--imdb-id") options.imdbId = argv[++i];
    else if (arg === "--apply") options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.title) throw new Error("--title is required");
  if (!["movie", "series"].includes(options.type)) throw new Error("--type must be movie or series");
  return options;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  installDnsOverride();
  const token = env("NOTION_WRITE_TOKEN") || env("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_WRITE_TOKEN or NOTION_TOKEN is required");
  const notion = new Client({ auth: token, timeoutMs: 120000 });
  const library = await loadLibrary(notion);
  const existing = await notion.dataSources.query({
    data_source_id: library.dataSourceId,
    page_size: 5,
    filter: { property: titleProperty(library.dataSource), title: { equals: options.title } }
  });
  if (existing.results?.[0]) {
    console.log(JSON.stringify({ status: "existing", pageId: existing.results[0].id, title: options.title }));
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
  try {
    const page = await notion.pages.create({
      parent: { data_source_id: library.dataSourceId },
      properties
    });
    console.log(JSON.stringify({ status: "created", pageId: page.id, title: options.title }));
  } catch (error) {
    if (!library.databaseId) throw error;
    console.log(`data_source parent create failed; retry with database parent: ${error.message}`);
    const page = await notion.pages.create({
      parent: { database_id: library.databaseId },
      properties
    });
    console.log(JSON.stringify({ status: "created", pageId: page.id, title: options.title }));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
