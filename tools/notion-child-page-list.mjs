#!/usr/bin/env node

import fs from "node:fs";
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

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { pageId: "", depth: 1, topLevelOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--depth") options.depth = Number(args[++index]);
    else if (arg === "--top-level-only") options.topLevelOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pageId) throw new Error("--page-id is required.");
  if (!Number.isInteger(options.depth) || options.depth < 0 || options.depth > 3) throw new Error("--depth must be 0 through 3.");
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

function title(block) {
  if (block.type === "child_page") return block.child_page?.title ?? "";
  const payload = block[block.type];
  const richText = payload?.rich_text ?? payload?.text ?? [];
  return richText.map((item) => item.plain_text ?? "").join("");
}

async function children(notion, blockId) {
  const values = [];
  let cursor;
  do {
    const response = await notion.blocks.children.list({ block_id: blockId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    values.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return values;
}

async function walk(notion, blockId, depth, path = []) {
  const blocks = await children(notion, blockId);
  const entries = [];
  for (const block of blocks) {
    const entry = { id: block.id, type: block.type, title: title(block), ...(block.type === "video" ? { video: block.video } : {}), path: [...path, `${block.type}:${title(block)}`] };
    entries.push(entry);
    if (depth > 0 && block.has_children) entries.push(...await walk(notion, block.id, depth - 1, entry.path));
  }
  return entries;
}

const env = readEnv();
const options = parseArgs();
installDnsOverride(env.NOTION_API_RESOLVE_IP);
const notion = new Client({ auth: env.NOTION_READ_ONLY_TOKEN || env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN, timeoutMs: 120000 });
const entries = await walk(notion, options.pageId, options.depth);
const reportedEntries = options.topLevelOnly
  ? entries.filter((entry) => entry.type === "child_page" && entry.path.length === 1)
  : entries;
console.log(JSON.stringify({ pageId: options.pageId, depth: options.depth, entries: reportedEntries }, null, 2));
