#!/usr/bin/env node

import fs from "node:fs";
import dns from "node:dns";
import https from "node:https";
import { Client } from "@notionhq/client";

function envFile() {
  const env = { ...process.env };
  if (!fs.existsSync(".env")) return env;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    result[key.slice(2).replaceAll("-", "_")] = argv[++i];
  }
  for (const key of ["asset_page", "work_page", "approx_size_gb"]) {
    if (!result[key]) throw new Error(`--${key.replaceAll("_", "-")} is required.`);
  }
  return result;
}

function dnsOverride(ip) {
  if (!ip) return;
  const original = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return original(hostname, options, callback);
    if (typeof options === "function") return options(null, ip, 4);
    if (options?.all) return callback(null, [{ address: ip, family: 4 }]);
    return callback(null, ip, 4);
  };
}

const env = envFile();
const options = args(process.argv.slice(2));
dnsOverride(env.NOTION_API_RESOLVE_IP);
const token = env.NOTION_WRITE_TOKEN || env.NOTION_TOKEN;
if (!token) throw new Error("Set NOTION_WRITE_TOKEN or NOTION_TOKEN.");
const clientOptions = { auth: token, timeoutMs: 120000 };
if (options.local_address) clientOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.local_address });
const notion = new Client(clientOptions);
const page = await notion.pages.retrieve({ page_id: options.asset_page });
const properties = page.properties ?? {};
if (properties.Work?.type !== "relation") throw new Error("Asset page has no Work relation property.");
if (properties["Approx Size GB"]?.type !== "number") throw new Error("Asset page has no Approx Size GB number property.");
const approxSizeGb = Number(options.approx_size_gb);
if (!Number.isFinite(approxSizeGb) || approxSizeGb <= 0) throw new Error("--approx-size-gb must be positive.");
await notion.pages.update({
  page_id: options.asset_page,
  properties: {
    Work: { relation: [{ id: options.work_page }] },
    "Approx Size GB": { number: approxSizeGb }
  }
});
const readback = await notion.pages.retrieve({ page_id: options.asset_page });
const workIds = (readback.properties?.Work?.relation ?? []).map((item) => item.id.replaceAll("-", "").toLowerCase());
const expectedWork = options.work_page.replaceAll("-", "").toLowerCase();
const actualSize = readback.properties?.["Approx Size GB"]?.number;
if (!workIds.includes(expectedWork) || actualSize !== approxSizeGb) throw new Error("Work relation or Approx Size GB readback failed.");
console.log(JSON.stringify({ assetPage: options.asset_page, workPage: options.work_page, approxSizeGb: actualSize, verified: true }, null, 2));
