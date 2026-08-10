#!/usr/bin/env node

import fs from "node:fs";
import dns from "node:dns";
import { Client } from "@notionhq/client";

function readEnv() {
  const env = { ...process.env };
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].trim();
    }
  }
  return env;
}

function parseArgs() {
  const options = { apply: false, pageId: "", expectedCurrent: "", expectedImdbId: "" };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => args[++index];
    if (arg === "--page-id") options.pageId = value();
    else if (arg === "--title") options.title = value();
    else if (arg === "--chinese-title") options.chineseTitle = value();
    else if (arg === "--english-title") options.englishTitle = value();
    else if (arg === "--original-title") options.originalTitle = value();
    else if (arg === "--imdb-id") options.imdbId = value();
    else if (arg === "--expected-imdb-id") options.expectedImdbId = value();
    else if (arg === "--expected-current") options.expectedCurrent = value();
    else if (arg === "--apply") options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pageId) throw new Error("--page-id is required.");
  if (!options.title && !options.chineseTitle && !options.englishTitle && !options.originalTitle && !options.imdbId) {
    throw new Error("Provide at least one identity field.");
  }
  return options;
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

function text(items = []) {
  return items.map((item) => item.plain_text ?? item.text?.content ?? "").join("");
}

function richText(content) {
  return [{ type: "text", text: { content } }];
}

const env = readEnv();
const options = parseArgs();
installDnsOverride(env.NOTION_API_RESOLVE_IP);
const notion = new Client({ auth: env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN, timeoutMs: 120000 });
const page = await notion.pages.retrieve({ page_id: options.pageId });
const titleEntry = Object.entries(page.properties ?? {}).find(([, property]) => property.type === "title");
const currentTitle = titleEntry ? text(titleEntry[1].title) : "";
if (options.expectedCurrent && currentTitle !== options.expectedCurrent) {
  throw new Error(`Current title mismatch: expected ${options.expectedCurrent}, got ${currentTitle}`);
}
const currentImdbId = text(page.properties?.["IMDb ID"]?.rich_text);
if (options.expectedImdbId && currentImdbId !== options.expectedImdbId) {
  throw new Error(`Current IMDb ID mismatch: expected ${options.expectedImdbId}, got ${currentImdbId}`);
}

const proposed = {};
if (options.title && titleEntry) proposed[titleEntry[0]] = { title: richText(options.title) };
for (const [name, value] of [
  ["Simplified Chinese Title", options.chineseTitle],
  ["English Title", options.englishTitle],
  ["Original Title", options.originalTitle]
]) {
  if (value === undefined) continue;
  const property = page.properties?.[name];
  if (!property) continue;
  if (property.type !== "rich_text") throw new Error(`${name} is not a rich_text property.`);
  proposed[name] = { rich_text: richText(value) };
}
if (options.imdbId !== undefined && page.properties?.["IMDb ID"]?.type === "rich_text") {
  proposed["IMDb ID"] = { rich_text: richText(options.imdbId) };
}
if (options.imdbId !== undefined && page.properties?.imdb?.type === "rich_text") {
  proposed.imdb = { rich_text: richText(options.imdbId) };
}

const result = { mode: options.apply ? "apply" : "dry_run", pageId: options.pageId, currentTitle, updates: proposed };
if (options.apply && Object.keys(proposed).length > 0) {
  await notion.pages.update({ page_id: options.pageId, properties: proposed });
  result.updated = true;
} else {
  result.updated = false;
}
console.log(JSON.stringify(result, null, 2));
