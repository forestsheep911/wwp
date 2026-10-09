#!/usr/bin/env node
import { config, projectEnv } from "./lib/project-secrets.mjs";

import fs from "node:fs";
import dns from "node:dns";
import https from "node:https";
import nodeFetch from "node-fetch";
import { Client } from "@notionhq/client";
import { createPacedFetch } from "./lib/notion-request-limiter.mjs";

function readEnv() { config(); return { ...process.env }; }

function parseArgs(argv) {
  const options = { pageId: "", depth: 1, topLevelOnly: false, resolveIp: "", localAddress: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--page-id") options.pageId = argv[++index] ?? "";
    else if (arg === "--depth") options.depth = Number(argv[++index]);
    else if (arg === "--top-level-only") options.topLevelOnly = true;
    else if (arg === "--resolve-ip") options.resolveIp = argv[++index] ?? "";
    else if (arg === "--local-address") options.localAddress = argv[++index] ?? "";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.pageId) throw new Error("--page-id is required.");
  if (!Number.isInteger(options.depth) || options.depth < 0 || options.depth > 3) throw new Error("--depth must be 0 through 3.");
  if (Boolean(options.resolveIp) !== Boolean(options.localAddress)) throw new Error("--resolve-ip and --local-address must be used together.");
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

function videoSummary(block) {
  const video = block.video;
  const file = video?.[video.type];
  return {
    type: video?.type ?? null,
    caption: (video?.caption ?? []).map((item) => item.plain_text ?? "").join(""),
    fileName: file?.name ?? null,
    expiryTime: file?.expiry_time ?? null,
    hasSignedUrl: Boolean(file?.url)
  };
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
    const entry = { id: block.id, type: block.type, title: title(block), ...(block.type === "video" ? { video: videoSummary(block) } : {}), path: [...path, `${block.type}:${title(block)}`] };
    entries.push(entry);
    if (depth > 0 && block.has_children) entries.push(...await walk(notion, block.id, depth - 1, entry.path));
  }
  return entries;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("Usage: node tools/notion-child-page-list.mjs --page-id <id> [--depth 0..3] [--top-level-only] [--resolve-ip <fresh-api-ip> --local-address <physical-lan-ip>]");
  process.exit(0);
}
const env = readEnv();
installDnsOverride(options.resolveIp || env.NOTION_API_RESOLVE_IP);
const notionOptions = {
  auth: env.NOTION_READ_ONLY_TOKEN || env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN,
  timeoutMs: 120000,
  fetch: createPacedFetch(options.resolveIp ? nodeFetch : globalThis.fetch, { minIntervalMs: 1000 })
};
if (options.resolveIp) notionOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.localAddress });
const notion = new Client(notionOptions);
const page = await notion.pages.retrieve({ page_id: options.pageId });
const pageTitle = Object.values(page.properties ?? {}).find((property) => property.type === "title")
  ?.title?.map((item) => item.plain_text ?? "").join("") ?? "";
const entries = await walk(notion, options.pageId, options.depth);
const reportedEntries = options.topLevelOnly
  ? entries.filter((entry) => entry.type === "child_page" && entry.path.length === 1)
  : entries;
console.log(JSON.stringify({ pageId: options.pageId, pageTitle, depth: options.depth, entries: reportedEntries }, null, 2));
