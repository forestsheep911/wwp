#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import https from "node:https";
import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";

function parseArgs(argv = process.argv.slice(2)) {
  const options = { workPage: "", fromPrefix: "", toPrefix: "", expectedCount: 0, report: ".local-data/notion-series-display-label-correction.json", resolveIp: "", localAddress: "", apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === "--work-page") options.workPage = value();
    else if (argument === "--from-prefix") options.fromPrefix = value();
    else if (argument === "--to-prefix") options.toPrefix = value();
    else if (argument === "--expected-count") options.expectedCount = Number(value());
    else if (argument === "--report") options.report = value();
    else if (argument === "--resolve-ip") options.resolveIp = value();
    else if (argument === "--local-address") options.localAddress = value();
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && (!options.workPage || !options.fromPrefix || !options.toPrefix || !Number.isInteger(options.expectedCount) || options.expectedCount < 1)) {
    throw new Error("--work-page, --from-prefix, --to-prefix, and positive --expected-count are required.");
  }
  return options;
}

function usage() {
  console.log(`Usage:
  node tools/notion-series-display-label-correction.mjs --work-page <id> --from-prefix <old-spec-title> --to-prefix <new-spec-title> --expected-count <episodes> [--apply]

Targeted Media Assets correction. It only replaces an exact Display Label prefix
for the requested Work relation, and never updates Name, Work, visibility, or
playback fields.`);
}

function dotenv(name) {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
      if (match?.[1] === name) return match[2].trim();
    }
  }
  return process.env[name];
}

function installNotionDnsOverride(resolveIp) {
  const ip = resolveIp || dotenv("NOTION_API_RESOLVE_IP");
  if (!ip) return;
  const lookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return lookup(hostname, options, callback);
    if (typeof options === "function") return options(null, ip, 4);
    if (options?.all) return callback(null, [{ address: ip, family: 4 }]);
    return callback(null, ip, 4);
  };
}

function richText(property) {
  return property?.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
}

export function correctionActions(pages, options) {
  const prefix = `${options.fromPrefix} / Episode `;
  const matching = pages.filter((page) => richText(page.properties?.["Display Label"]).startsWith(prefix));
  const episodeNumbers = matching.map((page) => page.properties?.["Episode Number"]?.number);
  if (matching.length !== options.expectedCount) throw new Error(`Expected ${options.expectedCount} exact Display Label matches; found ${matching.length}.`);
  if (episodeNumbers.some((value) => !Number.isInteger(value)) || new Set(episodeNumbers).size !== matching.length) {
    throw new Error("Matched Media Assets must have unique integer Episode Number values.");
  }
  return matching.map((page) => {
    const before = richText(page.properties?.["Display Label"]);
    return { pageId: page.id, episodeNumber: page.properties?.["Episode Number"]?.number, before, after: `${options.toPrefix}${before.slice(options.fromPrefix.length)}` };
  }).sort((left, right) => left.episodeNumber - right.episodeNumber);
}

async function main() {
  const options = parseArgs();
  if (options.help) return usage();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  const dataSourceId = dotenv("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID");
  if (!token || !dataSourceId) throw new Error("NOTION_WRITE_TOKEN/NOTION_TOKEN and NOTION_MEDIA_ASSETS_DATA_SOURCE_ID are required.");
  const clientOptions = { auth: token, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) };
  if (options.localAddress) {
    clientOptions.fetch = nodeFetch;
    clientOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.localAddress });
  }
  const notion = new Client(clientOptions);
  const response = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, filter: { property: "Work", relation: { contains: options.workPage } } });
  if (response.has_more) throw new Error("Exact Work query returned more than 100 Media Assets; refusing correction.");
  const actions = correctionActions(response.results, options);
  if (options.apply) {
    for (const action of actions) {
      await notion.pages.update({ page_id: action.pageId, properties: { "Display Label": { rich_text: [{ type: "text", text: { content: action.after } }] } } });
      const readback = await notion.pages.retrieve({ page_id: action.pageId });
      if (richText(readback.properties?.["Display Label"]) !== action.after) throw new Error(`Display Label readback failed for ${action.pageId}.`);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  const report = { generatedAt: new Date().toISOString(), apply: options.apply, workPageId: options.workPage, fromPrefix: options.fromPrefix, toPrefix: options.toPrefix, actions };
  fs.mkdirSync(path.dirname(path.resolve(options.report)), { recursive: true });
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: options.report, apply: options.apply, matched: actions.length, changed: options.apply ? actions.length : 0 }, null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
