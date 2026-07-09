#!/usr/bin/env node

import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";

import { inspectCriticRatings } from "../.codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs";

const DEFAULT_REPORT_PATH = ".local-data/notion-critic-rating-enrichment-report.json";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    discoverOnly: false,
    searchOnly: false,
    timeoutMs: 30000,
    reportPath: DEFAULT_REPORT_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--discover-only") {
      options.discoverOnly = true;
      continue;
    }
    if (arg === "--search-only") {
      options.searchOnly = true;
      continue;
    }

    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;

    if (name === "page-id" || name === "page-url") options.pageId = extractNotionId(value);
    else if (name === "rotten-url") options.rottenUrl = value;
    else if (name === "metacritic-url") options.metacriticUrl = value;
    else if (name === "imdb-url") options.imdbUrl = value;
    else if (name === "ratings-json") options.ratingsJson = value;
    else if (name === "imdb-id") options.imdbId = normalizeImdbId(value);
    else if (name === "wikidata-json") options.wikidataJson = value;
    else if (name === "title") options.title = value;
    else if (name === "year") options.year = value;
    else if (name === "timeout-ms") options.timeoutMs = Number(value);
    else if (name === "report") options.reportPath = value;
    else if (name === "resolve-ip") options.resolveIp = value;
    else throw new Error(`Unknown argument: --${name}`);
  }

  return options;
}

function usage() {
  return `Usage:
  node tools/notion-critic-rating-enrichment.mjs --page-id <page-id> --rotten-url <official-url-or-html> --metacritic-url <official-url-or-html>
  node tools/notion-critic-rating-enrichment.mjs --page-id <page-id> --imdb-id <ttid>
  node tools/notion-critic-rating-enrichment.mjs --page-id <page-id> --ratings-json <trusted-evidence.json>
  node tools/notion-critic-rating-enrichment.mjs --page-id <page-id> --search-only

Default mode is dry-run. The tool only fills empty Notion critic-score fields
from verified fallback results parsed by the plugin critic-rating inspector.
Trusted evidence JSON must include source labels such as licensed-source:<name>
or manual-evidence:<name>.
Use --apply to write updates.
`;
}

function extractNotionId(value = "") {
  const compact = String(value).match(/([0-9a-f]{32})/i)?.[1];
  if (compact) {
    return [
      compact.slice(0, 8),
      compact.slice(8, 12),
      compact.slice(12, 16),
      compact.slice(16, 20),
      compact.slice(20)
    ].join("-");
  }
  return String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}

function normalizeImdbId(value) {
  const match = String(value ?? "").match(/\b(tt\d{6,10})\b/i);
  return match ? match[1].toLowerCase() : undefined;
}

function dotenv(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(".env")) return undefined;
  const raw = fs.readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match?.[1] === name) {
      return match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
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

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? item.text?.content ?? "").join("");
}

function propertyText(property) {
  if (!property) return "";
  if (property.type === "title") return plainText(property.title);
  if (property.type === "rich_text") return plainText(property.rich_text);
  if (property.type === "number") return property.number === null ? "" : `${property.number}`;
  if (property.type === "date") return property.date?.start ?? "";
  if (property.type === "url") return property.url ?? "";
  if (property.type === "checkbox") return property.checkbox ? "true" : "";
  if (property.type === "select") return property.select?.name ?? "";
  if (property.type === "multi_select") return property.multi_select.map((item) => item.name).join(" ");
  return "";
}

function propertyExists(properties, name) {
  return Object.prototype.hasOwnProperty.call(properties, name);
}

function hasValue(properties, name) {
  return Boolean(propertyText(properties[name]).trim());
}

function richText(content) {
  const chunks = `${content ?? ""}`.match(/[\s\S]{1,1900}/g) ?? [""];
  return { rich_text: chunks.map((chunk) => ({ type: "text", text: { content: chunk } })) };
}

function multiSelect(names) {
  return { multi_select: [...new Set(names.filter(Boolean))].map((name) => ({ name })) };
}

function currentMultiSelect(properties, name) {
  const property = properties[name];
  return property?.type === "multi_select" ? property.multi_select.map((item) => item.name).filter(Boolean) : [];
}

function scoreNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function pageTitle(page) {
  const properties = page.properties ?? {};
  for (const property of Object.values(properties)) {
    if (property?.type === "title") {
      const title = propertyText(property);
      if (title) return title;
    }
  }
  return "Untitled Notion page";
}

function derivePageIdentity(page) {
  const properties = page.properties ?? {};
  const title = propertyText(properties["English Title"]) || propertyText(properties["Original Title"]) || pageTitle(page);
  const year = propertyText(properties["Release Year"]) || pageTitle(page).match(/\b(18\d{2}|19\d{2}|20\d{2})\b/)?.[1];
  const imdbId = normalizeImdbId(
    propertyText(properties["IMDb ID"]) ||
    propertyText(properties["IMDb"]) ||
    propertyText(properties.imdb) ||
    propertyText(properties["IMDb URL"])
  );
  return { title, year, imdbId };
}

function buildEvidenceMemo(evidence, now) {
  if (!evidence.length) return "";
  const parts = evidence.map((item) => {
    const details = [item.source, item.url, item.reviewCount !== undefined ? `${item.reviewCount} reviews` : ""]
      .filter(Boolean)
      .join(", ");
    return `${item.field}=${item.value}${details ? ` (${details})` : ""}`;
  });
  return `[${now}] Critic rating fallback: ${parts.join("; ")}`;
}

export function planCriticRatingUpdates(page, criticResult = {}, options = {}) {
  const properties = page.properties ?? {};
  const now = options.now ?? new Date().toISOString().slice(0, 10);
  const updates = {};
  const evidence = [];
  const sources = [];

  const rottenScore = scoreNumber(criticResult.rottenTomatoes?.score);
  if (
    rottenScore !== undefined &&
    propertyExists(properties, "烂番茄新鲜度") &&
    !hasValue(properties, "烂番茄新鲜度")
  ) {
    updates["烂番茄新鲜度"] = { number: rottenScore };
    sources.push(criticResult.rottenTomatoes.source);
    evidence.push({
      field: "烂番茄新鲜度",
      value: rottenScore,
      source: criticResult.rottenTomatoes.source,
      url: criticResult.rottenTomatoes.url,
      reviewCount: criticResult.rottenTomatoes.reviewCount
    });
  }

  const metascore = scoreNumber(criticResult.metacritic?.score);
  if (metascore !== undefined && propertyExists(properties, "Metascore") && !hasValue(properties, "Metascore")) {
    updates.Metascore = { number: metascore };
    sources.push(criticResult.metacritic.source);
    evidence.push({
      field: "Metascore",
      value: metascore,
      source: criticResult.metacritic.source,
      url: criticResult.metacritic.url,
      reviewCount: criticResult.metacritic.reviewCount
    });
  }

  if (evidence.length > 0 && propertyExists(properties, "Metadata Source")) {
    const nextSources = [...currentMultiSelect(properties, "Metadata Source"), ...sources.filter(Boolean)];
    const uniqueSources = [...new Set(nextSources)];
    if (uniqueSources.join("\n") !== currentMultiSelect(properties, "Metadata Source").join("\n")) {
      updates["Metadata Source"] = multiSelect(uniqueSources);
    }
  }

  const evidenceMemo = buildEvidenceMemo(evidence, now);
  if (evidenceMemo && propertyExists(properties, "Developer Memo") && !hasValue(properties, "Developer Memo")) {
    updates["Developer Memo"] = richText(evidenceMemo);
  }

  if (evidence.length > 0 && propertyExists(properties, "Metadata Updated At")) {
    updates["Metadata Updated At"] = { date: { start: now } };
  }

  return {
    pageId: page.id,
    title: pageTitle(page),
    updates,
    updateFields: Object.keys(updates),
    evidence,
    evidenceMemo,
    discoveryOnly: Boolean(criticResult.officialSearch && evidence.length === 0)
  };
}

function inspectOptionsFromPage(options, page) {
  const identity = derivePageIdentity(page);
  const directInputs = options.rottenUrl || options.metacriticUrl || options.imdbUrl || options.wikidataJson || options.ratingsJson;
  const imdbId = options.imdbId ?? identity.imdbId;
  const title = options.title ?? identity.title;
  const year = options.year ?? identity.year;
  const searchOnly = options.searchOnly || (!directInputs && !imdbId);

  const inspectOptions = {
    timeoutMs: options.timeoutMs,
    rottenUrl: options.rottenUrl,
    metacriticUrl: options.metacriticUrl,
    imdbUrl: options.imdbUrl,
    ratingsJson: options.ratingsJson,
    wikidataJson: options.wikidataJson,
    discoverOnly: options.discoverOnly,
    searchOnly
  };
  if (imdbId) inspectOptions.imdbId = imdbId;
  if (searchOnly || options.title || options.year) {
    inspectOptions.title = title;
    inspectOptions.year = year;
  }
  return inspectOptions;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.pageId) {
    throw new Error("Set --page-id before running Notion critic rating enrichment.");
  }

  const notionToken = options.apply
    ? dotenv("NOTION_WRITE_TOKEN") ?? dotenv("NOTION_TOKEN")
    : dotenv("NOTION_READ_ONLY_TOKEN") ?? dotenv("NOTION_WRITE_TOKEN") ?? dotenv("NOTION_TOKEN");
  if (!notionToken) {
    throw new Error(options.apply
      ? "Set NOTION_WRITE_TOKEN or NOTION_TOKEN before running with --apply."
      : "Set NOTION_READ_ONLY_TOKEN, NOTION_WRITE_TOKEN, or NOTION_TOKEN.");
  }

  installNotionDnsOverride(options.resolveIp);
  const notion = new Client({ auth: notionToken, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") ?? 30000) });
  const page = await notion.pages.retrieve({ page_id: options.pageId });
  const criticResult = await inspectCriticRatings(inspectOptionsFromPage(options, page));
  const plan = planCriticRatingUpdates(page, criticResult);
  let applied = false;

  if (options.apply && plan.updateFields.length > 0) {
    await notion.pages.update({ page_id: plan.pageId, properties: plan.updates });
    applied = true;
  }

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    applied,
    pageId: plan.pageId,
    title: plan.title,
    updateFields: plan.updateFields,
    evidence: plan.evidence,
    discoveryOnly: plan.discoveryOnly,
    officialSearch: criticResult.officialSearch,
    discovery: criticResult.discovery
  };

  if (options.reportPath) {
    const reportPath = path.isAbsolute(options.reportPath) ? options.reportPath : path.resolve(options.reportPath);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
