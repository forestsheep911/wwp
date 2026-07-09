#!/usr/bin/env node

import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";

import { lookupImdbRating } from "../.codex/plugins/wwp-film-workflow/scripts/imdb-rating-inspect.mjs";

const DEFAULT_REPORT_PATH = ".local-data/notion-imdb-rating-enrichment-report.json";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
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
    if (arg === "--no-dataset") {
      options.dataset = false;
      continue;
    }
    if (arg === "--no-page") {
      options.page = false;
      continue;
    }

    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;

    if (name === "page-id" || name === "page-url") options.pageId = extractNotionId(value);
    else if (name === "imdb-id") options.imdbId = normalizeImdbId(value);
    else if (name === "ratings-tsv") options.ratingsTsv = value;
    else if (name === "timeout-ms") options.timeoutMs = Number(value);
    else if (name === "report") options.reportPath = value;
    else if (name === "resolve-ip") options.resolveIp = value;
    else throw new Error(`Unknown argument: --${name}`);
  }

  return options;
}

function usage() {
  return `Usage:
  node tools/notion-imdb-rating-enrichment.mjs --page-id <page-id>
  node tools/notion-imdb-rating-enrichment.mjs --page-id <page-id> --imdb-id <ttid>

Default mode is dry-run. The tool only fills an empty Notion IMDB评分 field
from the plugin IMDb fallback inspector. Use --apply to write updates.
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
    if (match?.[1] === name) return match[2].trim().replace(/^["']|["']$/g, "");
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

function deriveImdbId(page) {
  const properties = page.properties ?? {};
  return normalizeImdbId(
    propertyText(properties["IMDb ID"]) ||
    propertyText(properties["IMDb"]) ||
    propertyText(properties.imdb) ||
    propertyText(properties["IMDb URL"])
  );
}

function ratingNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function buildEvidenceMemo(result, now) {
  const votes = result.numVotes === null || result.numVotes === undefined ? "" : `, ${result.numVotes} votes`;
  return `[${now}] IMDb rating fallback: IMDB评分=${result.averageRating} (${result.source}${votes}, ${result.id})`;
}

export function planImdbRatingUpdates(page, ratingResult = {}, options = {}) {
  const properties = page.properties ?? {};
  const now = options.now ?? new Date().toISOString().slice(0, 10);
  const updates = {};
  const rating = ratingNumber(ratingResult.averageRating);

  if (rating === undefined || !propertyExists(properties, "IMDB评分") || hasValue(properties, "IMDB评分")) {
    return {
      pageId: page.id,
      title: pageTitle(page),
      updates,
      updateFields: [],
      evidenceMemo: "",
      ratingResult
    };
  }

  updates["IMDB评分"] = { number: rating };

  if (propertyExists(properties, "Metadata Source")) {
    const current = currentMultiSelect(properties, "Metadata Source");
    const next = [...new Set([...current, ratingResult.source].filter(Boolean))];
    if (next.join("\n") !== current.join("\n")) updates["Metadata Source"] = multiSelect(next);
  }

  const evidenceMemo = buildEvidenceMemo({ ...ratingResult, averageRating: rating }, now);
  if (propertyExists(properties, "Developer Memo") && !hasValue(properties, "Developer Memo")) {
    updates["Developer Memo"] = richText(evidenceMemo);
  }

  if (propertyExists(properties, "Metadata Updated At")) {
    updates["Metadata Updated At"] = { date: { start: now } };
  }

  return {
    pageId: page.id,
    title: pageTitle(page),
    updates,
    updateFields: Object.keys(updates),
    evidenceMemo,
    ratingResult
  };
}

async function writeReport(reportPath, payload) {
  if (!reportPath) return;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(payload, null, 2), "utf8");
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.pageId) throw new Error("--page-id is required.");

  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_WRITE_TOKEN or NOTION_TOKEN is required.");

  const notion = new Client({ auth: token, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) });
  const page = await notion.pages.retrieve({ page_id: options.pageId });
  const imdbId = options.imdbId || deriveImdbId(page);
  if (!imdbId) throw new Error("No IMDb ID found. Pass --imdb-id.");

  const ratingResult = await lookupImdbRating(imdbId, {
    dataset: options.dataset,
    page: options.page,
    ratingsTsv: options.ratingsTsv,
    timeoutMs: options.timeoutMs
  });
  const plan = planImdbRatingUpdates(page, ratingResult);
  const payload = {
    mode: options.apply ? "apply" : "dry-run",
    pageId: page.id,
    title: pageTitle(page),
    imdbId,
    ratingResult,
    updateFields: plan.updateFields,
    updates: plan.updates
  };

  if (options.apply && plan.updateFields.length > 0) {
    await notion.pages.update({ page_id: page.id, properties: plan.updates });
    payload.applied = true;
    const readback = await notion.pages.retrieve({ page_id: page.id });
    payload.readback = {
      imdbRating: propertyText(readback.properties?.["IMDB评分"]),
      metadataSource: currentMultiSelect(readback.properties ?? {}, "Metadata Source")
    };
  } else {
    payload.applied = false;
  }

  await writeReport(options.reportPath, payload);
  console.log(JSON.stringify(payload, null, 2));
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
