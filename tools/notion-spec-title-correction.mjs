#!/usr/bin/env node

import dns from "node:dns";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";

const NOTION_REQUEST_INTERVAL_MS = 1000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
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

export function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (["--work-page", "--spec-page", "--expected-current", "--title"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replaceAll("-", "_")] = value;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  for (const [key, flag] of [
    ["work_page", "--work-page"],
    ["spec_page", "--spec-page"],
    ["expected_current", "--expected-current"],
    ["title", "--title"]
  ]) {
    if (!options[key]) throw new Error(`${flag} is required`);
  }
  if (options.expected_current === options.title) throw new Error("--title must differ from --expected-current");
  return options;
}

function titleProperty(page) {
  const entry = Object.entries(page.properties ?? {}).find(([, property]) => property.type === "title");
  if (!entry) throw new Error("spec page has no title property");
  return { key: entry[0], value: entry[1].title.map((item) => item.plain_text ?? "").join("") };
}

export function correctionPlan(page, options) {
  if (page.parent?.type !== "page_id" || page.parent.page_id !== options.work_page) {
    throw new Error(`spec page is not a direct child of work page ${options.work_page}`);
  }
  const current = titleProperty(page);
  if (current.value !== options.expected_current) {
    throw new Error(`current title mismatch: expected ${JSON.stringify(options.expected_current)}, got ${JSON.stringify(current.value)}`);
  }
  return {
    workPageId: options.work_page,
    specPageId: options.spec_page,
    titleProperty: current.key,
    before: current.value,
    after: options.title
  };
}

function usage() {
  console.log(`Usage:
  node tools/notion-spec-title-correction.mjs --work-page <id> --spec-page <id>
    --expected-current <title> --title <canonical-title> [--apply]

Dry-run is the default. The tool verifies the exact direct parent and current
title, applies only that page title, then retrieves the page again to prove the
new value.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();
  loadEnv();
  installDnsOverride(process.env.NOTION_API_RESOLVE_IP);
  const notion = new Client({
    auth: process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN,
    timeoutMs: 120000
  });
  const page = await notion.pages.retrieve({ page_id: options.spec_page });
  const plan = correctionPlan(page, options);
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", plan }, null, 2));
    return;
  }
  await wait(NOTION_REQUEST_INTERVAL_MS);
  await notion.pages.update({
    page_id: options.spec_page,
    properties: {
      [plan.titleProperty]: { title: [{ type: "text", text: { content: plan.after } }] }
    }
  });
  await wait(NOTION_REQUEST_INTERVAL_MS);
  const readback = correctionPlan(
    await notion.pages.retrieve({ page_id: options.spec_page }),
    { ...options, expected_current: plan.after, title: plan.before }
  );
  console.log(JSON.stringify({ mode: "apply", plan, readbackTitle: readback.before }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
