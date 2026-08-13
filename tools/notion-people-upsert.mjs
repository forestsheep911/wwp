import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";

import { assertUniqueExternalIds, NotionPeopleSource } from "../apps/api/src/notion-people-source.ts";
import { ProviderRateLimiter } from "../apps/api/src/person-sources/provider-http.ts";
import { LocalRunLease, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { installNotionDnsOverride, notionProxyUrl } from "../apps/api/src/notion-network.ts";

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report ?? ".local-data/people/dry-run-report.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const profiles = (report.proposedProfiles ?? []).slice(0, args.limit ?? Number.MAX_SAFE_INTEGER);
assertUniqueExternalIds(profiles);
if (!args.apply) {
  process.stdout.write(`${JSON.stringify({
    mode: "dry-run",
    reportPath,
    profileCount: profiles.length,
    estimatedQueries: profiles.length,
    estimatedMaximumWrites: profiles.length,
    estimatedReadbacks: profiles.length,
    identityIssueCount: report.identityIssues?.length ?? 0,
    unresolvedCount: report.unresolved?.length ?? 0,
    gate: "Review every proposed profile, identity issue, and unresolved credit before --apply."
  }, null, 2)}\n`);
  process.exit(0);
}
if (!args.confirmReviewedPilot) {
  throw new Error("--apply requires --confirm-reviewed-pilot after the report has been reviewed.");
}
if ((report.identityIssues?.length ?? 0) > 0) {
  throw new Error("The report contains identity conflicts; resolve them before applying People rows.");
}
if (profiles.some((profile) => !/^person_[0-9a-f-]{36}$/i.test(profile.personId))) {
  throw new Error("Every applied profile must have a lease-allocated immutable person_<uuid> ID.");
}

const token = required(process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN, "NOTION_WRITE_TOKEN or NOTION_TOKEN");
const dataSourceId = required(process.env.NOTION_PEOPLE_DATA_SOURCE_ID, "NOTION_PEOPLE_DATA_SOURCE_ID");
installNotionDnsOverride();
const clientOptions = { auth: token };
const proxyUrl = notionProxyUrl();
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: false }) : undefined;
if (proxyAgent) clientOptions.agent = proxyAgent;
const source = new NotionPeopleSource(new Client(clientOptions), dataSourceId, new ProviderRateLimiter(1_000));
const stateDir = path.resolve(args.stateDir ?? process.env.WWPDW_PEOPLE_STATE_DIR ?? ".local-data/people");
const checkpointPath = path.resolve(args.checkpoint ?? path.join(stateDir, "notion-upsert-checkpoint.json"));
const checkpoint = await readCheckpoint(checkpointPath);
const summary = { created: 0, updated: 0, unchanged: 0, completed: [], failures: [] };
const lease = new LocalRunLease(path.join(stateDir, "notion-people.lock"));

await lease.acquire();
try {
  for (const profile of profiles) {
    try {
      const result = await source.upsert(profile);
      summary[result.action] += 1;
      summary.completed.push({ personId: profile.personId, pageId: result.pageId, action: result.action });
      checkpoint.completed[profile.personId] = { pageId: result.pageId, appliedAt: new Date().toISOString() };
      await writeJsonAtomic(checkpointPath, checkpoint);
    } catch (error) {
      summary.failures.push({ personId: profile.personId, message: error instanceof Error ? error.message : String(error) });
      break;
    }
  }
} finally {
  proxyAgent?.destroy();
  await lease.release();
}
process.stdout.write(`${JSON.stringify({ mode: "applied", reportPath, checkpointPath, ...summary }, null, 2)}\n`);
if (summary.failures.length) process.exitCode = 1;

async function readCheckpoint(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, completed: {} };
    throw error;
  }
}

function parseArgs(values) {
  const result = { apply: false, confirmReviewedPilot: false, report: undefined, checkpoint: undefined, stateDir: undefined, limit: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") result.apply = true;
    else if (value === "--confirm-reviewed-pilot") result.confirmReviewedPilot = true;
    else if (value === "--report") result.report = required(values[++index], "--report");
    else if (value === "--checkpoint") result.checkpoint = required(values[++index], "--checkpoint");
    else if (value === "--state-dir") result.stateDir = required(values[++index], "--state-dir");
    else if (value === "--limit") result.limit = positiveInteger(values[++index], "--limit");
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function positiveInteger(value, name) {
  const parsed = Number(required(value, name));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
