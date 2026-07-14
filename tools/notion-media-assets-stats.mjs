import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

function parseArgs() {
  const options = {
    reportPath: ".local-data/notion-media-assets-stats.json",
    resolveIp: ""
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--report") options.reportPath = value();
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-stats.mjs --report .local-data/notion-media-assets-stats.json

This is read-only. It summarizes the Media Assets database and reports rows
missing traceability fields used by the migration tools.

Network workaround:
  node tools/notion-media-assets-stats.mjs --resolve-ip 208.103.161.1
`);
}

function dotenv(name) {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match?.[1] === name) {
        return match[2].trim();
      }
    }
  }
  return process.env[name];
}

function installNotionDnsOverride(resolveIp) {
  const notionApiIp = resolveIp || dotenv("NOTION_API_RESOLVE_IP");
  if (!notionApiIp) return;
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") return options(null, notionApiIp, 4);
      if (options?.all) return callback(null, [{ address: notionApiIp, family: 4 }]);
      return callback(null, notionApiIp, 4);
    }
    return originalLookup(hostname, options, callback);
  };
  console.log(`dns override: api.notion.com -> ${notionApiIp}`);
}

function createNotionClient(token) {
  const proxyUrl = dotenv("NOTION_PROXY_URL") || dotenv("HTTPS_PROXY") || dotenv("HTTP_PROXY");
  const options = { auth: token, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) };
  if (proxyUrl) {
    options.fetch = nodeFetch;
    options.agent = new HttpsProxyAgent(proxyUrl);
    console.log(`proxy: ${proxyUrl}`);
  }
  return new Client(options);
}

async function retrieveMediaAssetsDataSource(notion) {
  const dataSourceId = dotenv("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID");
  if (dataSourceId) return notion.dataSources.retrieve({ data_source_id: dataSourceId });

  const databaseId = dotenv("NOTION_MEDIA_ASSETS_DATABASE_ID");
  if (databaseId) {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    return notion.dataSources.retrieve({ data_source_id: database.data_sources?.[0]?.id || databaseId });
  }

  throw new Error("Set NOTION_MEDIA_ASSETS_DATA_SOURCE_ID or NOTION_MEDIA_ASSETS_DATABASE_ID.");
}

async function queryAllDataSourcePages(notion, dataSourceId) {
  const pages = [];
  let cursor;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function propertyPlainText(property) {
  if (!property) return "";
  if (property.type === "title") return plainText(property.title);
  if (property.type === "rich_text") return plainText(property.rich_text);
  if (property.type === "select") return property.select?.name ?? "";
  if (property.type === "multi_select") return property.multi_select?.map((item) => item.name).join(", ") ?? "";
  if (property.type === "url") return property.url ?? "";
  if (property.type === "files") return property.files?.map((item) => item.name).join(", ") ?? "";
  if (property.type === "checkbox") return String(property.checkbox);
  return "";
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") return plainText(property.title);
  }
  return "";
}

function firstProperty(properties, names) {
  for (const name of names) {
    if (properties[name]) return properties[name];
  }
  return undefined;
}

function selectName(properties, names) {
  const property = firstProperty(properties, Array.isArray(names) ? names : [names]);
  return property?.type === "select" ? property.select?.name ?? "" : "";
}

function checkboxValue(properties, names) {
  const property = firstProperty(properties, Array.isArray(names) ? names : [names]);
  if (!property || property.type !== "checkbox") return "missing";
  return property.checkbox ? "true" : "false";
}

function relationIds(properties, name) {
  const property = properties[name];
  if (!property || property.type !== "relation") return [];
  return property.relation?.map((item) => item.id).filter(Boolean) ?? [];
}

function increment(target, key) {
  const safeKey = key || "missing";
  target[safeKey] = (target[safeKey] ?? 0) + 1;
}

function compactRow(page) {
  const properties = page.properties ?? {};
  return {
    pageId: page.id,
    title: pageTitle(page),
    assetType: selectName(properties, "Asset Type"),
    availability: selectName(properties, ["Media Availability", "Availability"]),
    hideFromWebsite: checkboxValue(properties, ["Hide from Website", "Hide From Website"]),
    playbackVerified: checkboxValue(properties, "Playback Verified"),
    workIds: relationIds(properties, "Work"),
    sourcePageId: propertyPlainText(properties["Source Page ID"]),
    mediaBlockId: propertyPlainText(properties["Media Block ID"]),
    originalFileName: propertyPlainText(properties["Original File Name"]),
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time
  };
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);

  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN") || dotenv("NOTION_READ_ONLY_TOKEN");
  if (!token) throw new Error("Set NOTION_WRITE_TOKEN, NOTION_TOKEN, or NOTION_READ_ONLY_TOKEN.");

  const notion = createNotionClient(token);
  const dataSource = await retrieveMediaAssetsDataSource(notion);
  const pages = await queryAllDataSourcePages(notion, dataSource.id);
  const activePages = pages.filter((page) => !page.archived && !page.in_trash);

  const byAssetType = {};
  const byAvailability = {};
  const hideFromWebsite = {};
  const playbackVerified = {};
  const sourcePageIds = new Set();
  const workIds = new Set();

  const rows = activePages.map(compactRow);
  for (const row of rows) {
    increment(byAssetType, row.assetType);
    increment(byAvailability, row.availability);
    increment(hideFromWebsite, row.hideFromWebsite);
    increment(playbackVerified, row.playbackVerified);
    for (const workId of row.workIds) workIds.add(workId);
    if (row.sourcePageId) sourcePageIds.add(row.sourcePageId);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataSourceId: dataSource.id,
    activeMediaAssets: activePages.length,
    worksCovered: workIds.size,
    byAssetType,
    byAvailability,
    hideFromWebsite,
    playbackVerified,
    rows,
    traceability: {
      sourcePages: sourcePageIds.size,
      withSourcePageId: rows.filter((row) => row.sourcePageId).length,
      missingSourcePageId: rows.filter((row) => !row.sourcePageId).length,
      withMediaBlockId: rows.filter((row) => row.mediaBlockId).length,
      missingMediaBlockId: rows.filter((row) => !row.mediaBlockId).length,
      missingWorkRelation: rows.filter((row) => row.workIds.length === 0).length
    },
    missingSourcePageIdRows: rows.filter((row) => !row.sourcePageId),
    missingMediaBlockIdRows: rows.filter((row) => !row.mediaBlockId),
    missingWorkRelationRows: rows.filter((row) => row.workIds.length === 0)
  };

  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    activeMediaAssets: report.activeMediaAssets,
    worksCovered: report.worksCovered,
    byAssetType,
    byAvailability,
    hideFromWebsite,
    playbackVerified,
    traceability: report.traceability,
    reportPath: options.reportPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
