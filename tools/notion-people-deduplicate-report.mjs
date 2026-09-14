import "dotenv/config";
import https from "node:https";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";

import { NotionPeopleSource } from "../apps/api/src/notion-people-source.ts";
import { ProviderRateLimiter } from "../apps/api/src/person-sources/provider-http.ts";
import { installNotionDnsOverride } from "../apps/api/src/notion-network.ts";

async function main() {
const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(required(args.report, "--report"));
const report = JSON.parse(await readFile(reportPath, "utf8"));
const profiles = report.proposedProfiles ?? [];
const token = required(process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN, "NOTION_WRITE_TOKEN or NOTION_TOKEN");
const dataSourceId = required(process.env.NOTION_PEOPLE_DATA_SOURCE_ID, "NOTION_PEOPLE_DATA_SOURCE_ID");

installNotionDnsOverride(args.resolveIp);
const directAgent = args.localAddress
  ? new https.Agent({ keepAlive: true, localAddress: args.localAddress })
  : undefined;
const client = new Client({ auth: token, ...(directAgent ? { fetch: nodeFetch, agent: directAgent } : {}) });
const limiter = new ProviderRateLimiter(1_000);
const source = new NotionPeopleSource(client, dataSourceId, limiter);
const rows = (await source.listChanged()).filter((row) => "personId" in row && !row.archived);
const byPersonId = new Map(rows.map((row) => [row.personId, row]));
const plan = [];

for (const profile of profiles) {
  const canonical = byPersonId.get(profile.personId);
  if (!canonical) continue;
  const expected = normalizedIds(profile.externalIds);
  for (const candidate of rows) {
    if (candidate.personId === profile.personId) continue;
    const actual = normalizedIds(candidate.externalIds);
    const shared = Object.entries(expected).filter(([provider, id]) => actual[provider] === id);
    const conflicts = Object.entries(actual).filter(([provider, id]) => expected[provider] && expected[provider] !== id);
    if (shared.length < 2 || conflicts.length) continue;
    plan.push({
      canonicalPersonId: profile.personId,
      canonicalPageId: canonical.pageId,
      canonicalName: canonical.name,
      retiredPersonId: candidate.personId,
      retiredPageId: candidate.pageId,
      retiredName: candidate.name,
      sharedExternalIds: Object.fromEntries(shared),
      canonicalQualityScore: canonical.qualityScore,
      retiredQualityScore: candidate.qualityScore
    });
  }
}

const uniquePlan = [...new Map(plan.map((item) => [item.retiredPageId, item])).values()];
if (!args.apply) {
  process.stdout.write(`${JSON.stringify({ mode: "dry-run", reportPath, scannedRows: rows.length, duplicateCount: uniquePlan.length, plan: uniquePlan }, null, 2)}\n`);
  return;
}
if (!args.confirmExactDuplicates) throw new Error("--apply requires --confirm-exact-external-id-duplicates.");

const archived = [];
try {
  for (const item of uniquePlan) {
    await limiter.schedule(() => client.pages.update({ page_id: item.retiredPageId, archived: true }));
    const readback = await limiter.schedule(() => client.pages.retrieve({ page_id: item.retiredPageId }));
    if (!readback.archived && !readback.in_trash) throw new Error(`Archive readback failed for ${item.retiredPageId}.`);
    archived.push(item);
  }
} finally {
  directAgent?.destroy();
}
process.stdout.write(`${JSON.stringify({ mode: "applied", reportPath, archivedCount: archived.length, archived }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function normalizedIds(ids = {}) {
  return Object.fromEntries(Object.entries(ids)
    .map(([provider, value]) => [provider.toLowerCase(), String(value ?? "").trim().toLowerCase()])
    .filter(([, value]) => value));
}

export function parseArgs(values) {
  const result = { report: undefined, apply: false, confirmExactDuplicates: false, resolveIp: undefined, localAddress: undefined, noProxy: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--report") result.report = values[++index];
    else if (value === "--apply") result.apply = true;
    else if (value === "--confirm-exact-external-id-duplicates") result.confirmExactDuplicates = true;
    else if (value === "--resolve-ip") result.resolveIp = required(values[++index], value);
    else if (value === "--local-address") result.localAddress = required(values[++index], value);
    else if (value === "--no-proxy") result.noProxy = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (result.resolveIp && (!result.localAddress || !result.noProxy)) {
    throw new Error("--resolve-ip requires --local-address <physical-lan-ip> and --no-proxy; refusing an unsafe raw-IP route.");
  }
  if (result.localAddress && (!result.resolveIp || !result.noProxy)) {
    throw new Error("--local-address requires --resolve-ip <api-ip> and --no-proxy.");
  }
  return result;
}

function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
