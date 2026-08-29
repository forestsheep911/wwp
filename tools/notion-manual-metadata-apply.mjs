#!/usr/bin/env node
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { createPacedFetch } from "./notion-work-identity-preflight.mjs";

const ALLOWED_FIELDS = new Set([
  "Simplified Chinese Title", "English Title", "Original Title",
  "Traditional Chinese Title (Taiwan)", "Traditional Chinese Title (Hong Kong)",
  "Release Year", "上映日期", "Countries", "Languages", "旨趣",
  "外部类型原文", "未映射类型", "Runtime Minutes", "Directors", "Writers", "Cast",
  "Production Companies", "Distributors", "Studios", "简介", "基本信息",
  "Poster URL", "Metadata Source", "Metadata Confidence", "Match Status",
  "Metadata Status", "Metadata Updated At", "Needs Review", "Developer Memo"
]);

function loadEnv() {
  const env = { ...process.env };
  if (!fs.existsSync(".env")) return env;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

function installDnsOverride(address) {
  if (!address) return;
  const original = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return original(hostname, options, callback);
    if (typeof options === "function") return options(null, address, 4);
    if (options?.all) return callback(null, [{ address, family: 4 }]);
    return callback(null, address, 4);
  };
}

function parseArgs(argv) {
  const options = { apply: false, delayMs: 1000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") options.manifest = path.resolve(argv[++index]);
    else if (arg === "--report") options.report = path.resolve(argv[++index]);
    else if (arg === "--delay-ms") options.delayMs = Number(argv[++index]);
    else if (arg === "--apply") options.apply = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.manifest) throw new Error("--manifest is required");
  if (!Number.isFinite(options.delayMs) || options.delayMs < 1000) {
    throw new Error("--delay-ms must be at least 1000 for Notion rate safety");
  }
  return options;
}

function richText(value) {
  const text = String(value ?? "");
  const chunks = text.match(/[\s\S]{1,2000}/gu) ?? [];
  return chunks.map((content) => ({ type: "text", text: { content } }));
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? item.text?.content ?? "").join("");
}

function currentValue(property) {
  if (!property) return undefined;
  if (property.type === "rich_text") return plainText(property.rich_text);
  if (property.type === "number") return property.number;
  if (property.type === "url") return property.url;
  if (property.type === "checkbox") return property.checkbox;
  if (property.type === "select") return property.select?.name ?? null;
  if (property.type === "multi_select") return (property.multi_select ?? []).map((item) => item.name);
  if (property.type === "date") return property.date?.start ?? null;
  throw new Error(`Unsupported metadata property type: ${property.type}`);
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

function propertyPayload(property, value) {
  if (property.type === "rich_text") return { rich_text: richText(value) };
  if (property.type === "number") {
    if (value == null) return { number: null };
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`number metadata value must be finite: ${value}`);
    return { number };
  }
  if (property.type === "url") return { url: value || null };
  if (property.type === "checkbox") {
    if (typeof value !== "boolean") throw new Error(`checkbox metadata value must be boolean: ${value}`);
    return { checkbox: value };
  }
  if (property.type === "select") return { select: value ? { name: String(value) } : null };
  if (property.type === "multi_select") {
    if (!Array.isArray(value)) throw new Error("multi_select metadata values must be arrays");
    return { multi_select: [...new Set(value.map(String).filter(Boolean))].map((name) => ({ name })) };
  }
  if (property.type === "date") return { date: value ? { start: String(value) } : null };
  throw new Error(`Unsupported metadata property type: ${property.type}`);
}

export function buildMetadataPatch(properties, fields) {
  const patch = {};
  const skipped = {};
  for (const [name, rawSpec] of Object.entries(fields ?? {})) {
    if (!ALLOWED_FIELDS.has(name)) throw new Error(`Field is not allowed for manual metadata apply: ${name}`);
    const property = properties[name];
    if (!property) throw new Error(`Notion metadata property is missing: ${name}`);
    const spec = rawSpec && typeof rawSpec === "object" && !Array.isArray(rawSpec) && Object.hasOwn(rawSpec, "value")
      ? rawSpec
      : { value: rawSpec };
    const current = currentValue(property);
    let next = spec.value;
    if (spec.merge) {
      if (property.type !== "multi_select") throw new Error(`merge is supported only for multi_select fields: ${name}`);
      next = [...new Set([...(current ?? []), ...(Array.isArray(spec.value) ? spec.value : [])])];
    } else if (hasValue(current) && !spec.overwrite) {
      skipped[name] = "existing_value_preserved";
      continue;
    }
    patch[name] = propertyPayload(property, next);
  }
  return { patch, skipped };
}

function titleOf(page) {
  const property = Object.values(page.properties ?? {}).find((item) => item.type === "title");
  return plainText(property?.title);
}

function readback(properties, fieldNames) {
  return Object.fromEntries(fieldNames.map((name) => [name, currentValue(properties[name])]));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(options.manifest, "utf8"));
  const entries = manifest.pages ?? [manifest];
  if (entries.length < 1 || entries.length > 20) throw new Error("manifest must contain between 1 and 20 pages");
  const env = loadEnv();
  installDnsOverride(env.NOTION_API_RESOLVE_IP);
  const token = options.apply
    ? env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN
    : env.NOTION_READ_ONLY_TOKEN || env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN;
  if (!token) throw new Error("A Notion token is required");
  const notion = new Client({
    auth: token,
    timeoutMs: 120000,
    fetch: createPacedFetch(globalThis.fetch.bind(globalThis), options.delayMs)
  });
  const results = [];
  for (const entry of entries) {
    if (!entry.pageId || !entry.expectedTitle) throw new Error("Each page requires pageId and expectedTitle");
    const page = await notion.pages.retrieve({ page_id: entry.pageId });
    const actualTitle = titleOf(page);
    if (actualTitle !== entry.expectedTitle) {
      throw new Error(`Title guard failed for ${entry.pageId}: expected ${entry.expectedTitle}, got ${actualTitle}`);
    }
    const { patch, skipped } = buildMetadataPatch(page.properties ?? {}, entry.fields);
    let finalPage = page;
    if (options.apply && Object.keys(patch).length > 0) {
      await notion.pages.update({ page_id: entry.pageId, properties: patch });
      finalPage = await notion.pages.retrieve({ page_id: entry.pageId });
    }
    results.push({
      pageId: entry.pageId,
      title: actualTitle,
      applied: options.apply,
      updateFields: Object.keys(patch),
      skipped,
      readback: readback(finalPage.properties ?? {}, Object.keys(entry.fields ?? {}))
    });
  }
  const report = { generatedAt: new Date().toISOString(), mode: options.apply ? "apply" : "dry-run", results };
  if (options.report) {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
