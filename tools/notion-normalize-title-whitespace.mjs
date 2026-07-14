#!/usr/bin/env node

import fs from "node:fs";
import dns from "node:dns";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@notionhq/client";

function loadEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { apply: false, limit: 25, delayMs: 500, snapshot: ".local-data/notion-work-title-snapshot-current.json" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--limit") options.limit = Number(args[++index]);
    else if (arg === "--delay-ms") options.delayMs = Number(args[++index]);
    else if (arg === "--snapshot") options.snapshot = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
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

function normalizeWhitespace(title) {
  return title.replace(/[\u00a0\u202f]/gu, " ").replace(/[ \t]+/gu, " ").trim();
}

loadEnv();
const options = parseArgs();
installDnsOverride(process.env.NOTION_API_RESOLVE_IP);
const report = JSON.parse(fs.readFileSync(options.snapshot, "utf8"));
const targets = report.rows
  .filter((row) => !row.archived && !row.inTrash && /[\u00a0\u202f]/u.test(row.title))
  .slice(0, options.limit)
  .map((row) => ({ pageId: row.pageId, before: row.title, after: normalizeWhitespace(row.title) }));

const notion = new Client({ auth: process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN, timeoutMs: 120000 });
let applied = 0;
if (options.apply) {
  for (const target of targets) {
    if (target.before === target.after) continue;
    await notion.pages.update({
      page_id: target.pageId,
      properties: { Title: { title: [{ type: "text", text: { content: target.after } }] } }
    });
    applied += 1;
    if (options.delayMs > 0) await sleep(options.delayMs);
  }
}

console.log(JSON.stringify({ mode: options.apply ? "apply" : "dry-run", snapshot: options.snapshot, planned: targets.length, applied, sample: targets.slice(0, 10) }, null, 2));
