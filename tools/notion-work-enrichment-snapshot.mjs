import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";

import { installNotionDnsOverride, notionProxyUrl } from "../apps/api/src/notion-network.ts";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";

const options = parseArgs(process.argv.slice(2));
const token = process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_TOKEN;
if (!token?.trim()) throw new Error("NOTION_READ_ONLY_TOKEN or NOTION_TOKEN is required.");

installNotionDnsOverride();
const clientOptions = { auth: token.trim() };
const proxyUrl = notionProxyUrl();
if (proxyUrl) clientOptions.agent = new HttpsProxyAgent(proxyUrl, { keepAlive: false });
const notion = new Client(clientOptions);
const lock = acquireProductionLock({ owner: "notion-work-enrichment-snapshot", mode: "enrichment-only" });

try {
  const works = [];
  for (let index = 0; index < options.pageIds.length; index += 1) {
    if (index > 0) await sleep(1_100);
    const page = await notion.pages.retrieve({ page_id: options.pageIds[index] });
    if (!("properties" in page)) throw new Error(`Notion page ${options.pageIds[index]} has no properties.`);
    works.push(snapshotPage(page));
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    requestCount: works.length,
    works
  };
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  lock.release();
}

function snapshotPage(page) {
  const properties = page.properties;
  const titleEntry = Object.entries(properties).find(([, property]) => property.type === "title");
  const value = (name) => propertyValue(properties[name]);
  return {
    pageId: page.id,
    url: page.url,
    title: titleEntry ? propertyValue(titleEntry[1]) : "",
    workId: value("WW Work ID"),
    kind: value("影别"),
    releaseYear: value("Release Year"),
    synopsis: value("简介"),
    genres: value("旨趣"),
    directors: value("Directors"),
    writers: value("Writers"),
    cast: value("Cast"),
    productionCompanies: value("Production Companies"),
    distributors: value("Distributors"),
    studios: value("Studios"),
    legacyHighlights: value("闻达"),
    imdbId: value("IMDb ID"),
    doubanId: value("Douban Subject ID"),
    tmdbId: value("TMDB ID"),
    metadataStatus: value("Metadata Status"),
    metadataConfidence: value("Metadata Confidence"),
    needsReview: value("Needs Review"),
    humanIssue: value("Human Issue"),
    aiIssue: value("AI Issue")
  };
}

function propertyValue(property) {
  if (!property) return null;
  if (property.type === "title" || property.type === "rich_text") {
    return property[property.type].map((part) => part.plain_text ?? "").join("");
  }
  if (property.type === "select" || property.type === "status") return property[property.type]?.name ?? null;
  if (property.type === "multi_select") return property.multi_select.map((option) => option.name);
  if (property.type === "number") return property.number;
  if (property.type === "checkbox") return property.checkbox;
  if (property.type === "url") return property.url;
  if (property.type === "date") return property.date?.start ?? null;
  if (property.type === "relation") return property.relation.map((relation) => relation.id);
  return null;
}

function parseArgs(values) {
  const options = { pageIds: [], output: undefined };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--page-id") options.pageIds.push(required(values[++index], "--page-id"));
    else if (values[index] === "--output") options.output = required(values[++index], "--output");
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (options.pageIds.length === 0 || options.pageIds.length > 10) throw new Error("Provide between 1 and 10 --page-id values.");
  return options;
}

function required(value, option) {
  if (!value?.trim()) throw new Error(`${option} requires a value.`);
  return value.trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
