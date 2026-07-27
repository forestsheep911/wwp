#!/usr/bin/env node

import fs from "node:fs";
import dns from "node:dns";
import { Client } from "@notionhq/client";

const DEFAULT_TARGETS = [
  ["3a620ac1-2f0a-81a3-87c3-ea5f6a73f46b", "tt1187064"],
  ["3a620ac1-2f0a-817c-8a0c-cbb984ea87b7", "tt26443616"],
  ["3a620ac1-2f0a-813a-b53e-c18b5800afed", "tt0063759"],
  ["3a620ac1-2f0a-816e-90fc-e753417e2189", "tt32547691"],
  ["3a620ac1-2f0a-815c-b2dc-e2bbcb51f1d7", "tt0205143"],
  ["3a620ac1-2f0a-81da-8500-ea3862694e52", "tt35521394"]
];

function parseArgs(argv) {
  const options = { apply: false, targets: [] };
  let pendingPageId = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg === "--target") {
      const [pageId, imdbId] = `${argv[++index] ?? ""}`.split("=", 2);
      if (!pageId || !imdbId) throw new Error("--target expects pageId=imdbId.");
      options.targets.push([pageId, imdbId]);
    } else if (arg === "--page-id") {
      pendingPageId = `${argv[++index] ?? ""}`.trim();
      if (!pendingPageId) throw new Error("--page-id requires a value.");
    } else if (arg === "--imdb-id") {
      const imdbId = `${argv[++index] ?? ""}`.trim();
      if (!pendingPageId || !imdbId) throw new Error("--imdb-id requires a preceding --page-id.");
      options.targets.push([pendingPageId, imdbId]);
      pendingPageId = "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (pendingPageId) options.targets.push([pendingPageId, ""]);
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

function plain(items = []) { return items.map(item => item.plain_text ?? "").join("").trim(); }
function text(value) { return `${value ?? ""}`.trim(); }
function has(property) {
  if (!property) return false;
  const value = property[property.type];
  if (property.type === "rich_text" || property.type === "title") return plain(value).length > 0;
  if (property.type === "multi_select" || property.type === "files") return (value ?? []).length > 0;
  return value !== null && value !== undefined && value !== "";
}
function richText(value) { return { rich_text: [{ type: "text", text: { content: text(value) } }] }; }
function titleText(value) { return { title: [{ type: "text", text: { content: text(value) } }] }; }
function multiSelect(values) { return { multi_select: [...new Set(values.filter(Boolean).map(text))].map(name => ({ name })) }; }
function select(name) { return { select: name ? { name } : null }; }
function number(value) { return { number: Number(value) }; }
function propText(properties, name) {
  const property = properties[name];
  if (!property) return "";
  if (property.type === "rich_text" || property.type === "title") return plain(property[property.type]);
  if (property.type === "number") return property.number;
  if (property.type === "select") return property.select?.name ?? "";
  return "";
}
function split(value) { return text(value).split(/\s*,\s*/u).map(text).filter(Boolean); }
function ratingValue(payload, source) {
  const entry = (payload.Ratings ?? []).find(item => item.Source === source);
  const match = entry?.Value?.match(/\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : undefined;
}
function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10);
}
function parseRuntime(value) {
  const match = text(value).match(/(\d+)/u);
  return match ? Number(match[1]) : undefined;
}
function buildBasicInfo(payload) {
  return [
    ["导演", payload.Director], ["编剧", payload.Writer], ["主演", payload.Actors],
    ["类型", payload.Genre], ["制片国家/地区", payload.Country], ["语言", payload.Language],
    ["上映日期", payload.Released], ["片长", payload.Runtime], ["分级", payload.Rated], ["IMDb", payload.imdbID]
  ].filter(([, value]) => text(value)).map(([label, value]) => `${label}：${value}`).join("\n");
}
function patchFor(page, payload) {
  const p = page.properties ?? {};
  const patch = {};
  const setEmpty = (name, value, builder) => { if (p[name] && !has(p[name]) && value !== undefined && text(value)) patch[name] = builder(value); };
  const imdbRating = Number(payload.imdbRating);
  if (p["IMDB评分"] && !has(p["IMDB评分"]) && Number.isFinite(imdbRating)) patch["IMDB评分"] = number(imdbRating);
  const metascore = Number(payload.Metascore);
  if (p.Metascore && !has(p.Metascore) && Number.isFinite(metascore)) patch.Metascore = number(metascore);
  const rotten = ratingValue(payload, "Rotten Tomatoes");
  if (p["烂番茄新鲜度"] && !has(p["烂番茄新鲜度"]) && rotten !== undefined) patch["烂番茄新鲜度"] = number(rotten);
  setEmpty("Runtime Minutes", parseRuntime(payload.Runtime), number);
  if (p.Countries && !has(p.Countries)) patch.Countries = multiSelect(split(payload.Country));
  if (p.Languages && !has(p.Languages)) patch.Languages = multiSelect(split(payload.Language));
  setEmpty("Directors", payload.Director, richText);
  setEmpty("Writers", payload.Writer, richText);
  setEmpty("Cast", payload.Actors, richText);
  setEmpty("简介", payload.Plot, richText);
  setEmpty("基本信息", buildBasicInfo(payload), richText);
  setEmpty("上映日期", parseDate(payload.Released), value => ({ date: { start: value } }));
  setEmpty("Poster URL", payload.Poster, value => ({ url: value }));
  setEmpty("Original Title", payload.Title, richText);
  if (p["分级"] && !has(p["分级"]) && text(payload.Rated) && payload.Rated !== "N/A") patch["分级"] = multiSelect([payload.Rated]);
  if (p["Metadata Source"]) {
    const current = p["Metadata Source"].multi_select?.map(item => item.name) ?? [];
    if (!current.includes("omdb")) patch["Metadata Source"] = multiSelect([...current, "omdb"]);
  }
  if (p["Metadata Status"] && ["", "draft"].includes(propText(p, "Metadata Status"))) patch["Metadata Status"] = select("partial");
  if (p["Match Status"] && propText(p, "Match Status") !== "verified") patch["Match Status"] = select("verified");
  if (p["Metadata Confidence"] && (!has(p["Metadata Confidence"]) || Number(p["Metadata Confidence"].number) < 0.85)) patch["Metadata Confidence"] = number(0.85);
  if (p["Metadata Updated At"] && Object.keys(patch).length) patch["Metadata Updated At"] = { date: { start: new Date().toISOString().slice(0, 10) } };
  return patch;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apply = options.apply;
  const targets = options.targets.length ? options.targets : DEFAULT_TARGETS;
  const apiKey = env("OMDB_API_KEY");
  if (!apiKey) throw new Error("OMDB_API_KEY is not configured.");
  installDnsOverride();
  const notion = new Client({ auth: env("NOTION_WRITE_TOKEN") || env("NOTION_TOKEN"), timeoutMs: 120000 });
  const report = { generatedAt: new Date().toISOString(), apply, records: [] };
  for (const [pageId, configuredImdbId] of targets) {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const imdbId = configuredImdbId || propText(page.properties, "IMDb ID") || propText(page.properties, "imdb");
    if (!imdbId) {
      report.records.push({ pageId, status: "error", message: "IMDb ID is missing; pass --imdb-id explicitly." });
      continue;
    }
    const response = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&i=${encodeURIComponent(imdbId)}&plot=full`);
    const payload = await response.json();
    if (payload.Response !== "True") {
      report.records.push({ pageId, imdbId, status: "error", message: payload.Error ?? "OMDb lookup failed" });
      continue;
    }
    const patch = patchFor(page, payload);
    const record = { pageId, imdbId, title: propText(page.properties, "Title"), omdbTitle: payload.Title, fields: Object.keys(patch), status: apply ? "updated" : "dry_run" };
    if (apply && Object.keys(patch).length) {
      await notion.pages.update({ page_id: pageId, properties: patch });
      const readback = await notion.pages.retrieve({ page_id: pageId });
      record.readback = Object.fromEntries(Object.keys(patch).map(name => {
        const property = readback.properties?.[name];
        return [name, property?.type === "rich_text" ? plain(property.rich_text) : property?.type === "number" ? property.number : property?.type === "select" ? property.select?.name : property?.type === "multi_select" ? property.multi_select.map(item => item.name) : property?.type === "date" ? property.date?.start : property?.type === "url" ? property.url : null];
      }));
    }
    report.records.push(record);
    console.log(JSON.stringify(record));
  }
  fs.writeFileSync(".local-data/notion-omdb-backfill-report.json", JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
