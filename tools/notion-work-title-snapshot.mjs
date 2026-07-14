import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";

function readEnv() {
  const env = { ...process.env };
  if (!fs.existsSync(".env")) return env;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

function installDnsOverride(ip) {
  if (!ip) return;
  const original = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return original(hostname, options, callback);
    if (typeof options === "function") return options(null, ip, 4);
    if (options?.all) return callback(null, [{ address: ip, family: 4 }]);
    return callback(null, ip, 4);
  };
}

function propertyValue(property) {
  if (!property) return "";
  if (property.type === "number") return property.number;
  if (property.type === "checkbox") return property.checkbox;
  if (property.type === "url") return property.url ?? "";
  if (property.type === "select") return property.select?.name ?? "";
  if (property.type === "title" || property.type === "rich_text") {
    return property[property.type].map((item) => item.plain_text ?? "").join("");
  }
  return property[property.type]?.map?.((item) => item.name ?? item.plain_text).join(" / ") ?? "";
}

function fileCount(property) {
  return property?.type === "files" ? property.files.length : 0;
}

const env = readEnv();
installDnsOverride(env.NOTION_API_RESOLVE_IP);
const token = env.NOTION_READ_ONLY_TOKEN || env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN;
if (!token) throw new Error("Set NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN.");
let dataSourceId = env.NOTION_LIBRARY_DATA_SOURCE_ID || env.NOTION_DATA_SOURCE_ID;
const notion = new Client({ auth: token, timeoutMs: 120000 });
if (!dataSourceId) {
  const database = await notion.databases.retrieve({ database_id: env.NOTION_LIBRARY_DATABASE_ID || env.NOTION_DATABASE_ID });
  dataSourceId = database.data_sources?.[0]?.id;
}
if (!dataSourceId) throw new Error("Notion library data source ID is unavailable.");

const rows = [];
let cursor;
do {
  const response = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
  for (const page of response.results) {
    const properties = page.properties ?? {};
    const title = propertyValue(Object.values(properties).find((property) => property.type === "title"));
    rows.push({
      pageId: page.id,
      archived: page.archived,
      inTrash: page.in_trash,
      title,
      releaseYear: propertyValue(properties["Release Year"]),
      chineseTitle: propertyValue(properties["Simplified Chinese Title"]),
      englishTitle: propertyValue(properties["English Title"]),
      originalTitle: propertyValue(properties["Original Title"]),
      doubanId: propertyValue(properties["Douban Subject ID"]),
      imdbId: propertyValue(properties["IMDb ID"]),
      tmdbId: propertyValue(properties["TMDB ID"]),
      hideFromWebsite: propertyValue(properties["Hide from Website"]),
      needsReview: propertyValue(properties["Needs Review"]),
      mediaAvailability: propertyValue(properties["Media Availability"]),
      posterFileCount: fileCount(properties["海报"]),
      posterUrl: propertyValue(properties["Poster URL"]),
      descriptionPresent: Boolean(propertyValue(properties["简介"])),
      basicInfoPresent: Boolean(propertyValue(properties["基本信息"])),
      imdbRating: propertyValue(properties["IMDB评分"]),
      doubanRating: propertyValue(properties["豆瓣评分"]),
      aiMinimumAge: propertyValue(properties["AI建议最低年龄"]),
      metadataStatus: propertyValue(properties["Metadata Status"]),
      metadataConfidence: propertyValue(properties["Metadata Confidence"]),
    });
  }
  cursor = response.has_more ? response.next_cursor : undefined;
} while (cursor);

const report = { generatedAt: new Date().toISOString(), dataSourceId, total: rows.length, rows };
const output = path.resolve(process.argv[2] || ".local-data/notion-work-title-snapshot-current.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, total: rows.length, generatedAt: report.generatedAt }, null, 2));
