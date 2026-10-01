import "./lib/project-env.mjs";
import https from "node:https";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

import { assertUniqueExternalIds, NotionPeopleSource, PeopleBatchIdentityConflictError } from "../apps/api/src/notion-people-source.ts";
import { ProviderRateLimiter } from "../apps/api/src/person-sources/provider-http.ts";
import { LocalRunLease, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { installNotionDnsOverride, notionProxyUrl } from "../apps/api/src/notion-network.ts";
import { assertVerifiedPersonProfileQuality } from "../apps/api/src/person-biography-quality.ts";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";
import { assertAuthorizedPersonPreflight } from "./lib/person-report-authorization.mjs";
import { remapReportToExistingPeople } from "./lib/person-report-identity-remap.mjs";

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report ?? ".local-data/people/dry-run-report.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
let effectiveReport = report;
let profiles = (effectiveReport.proposedProfiles ?? []).slice(0, args.limit ?? Number.MAX_SAFE_INTEGER);
assertUniqueExternalIds(profiles);
for (const profile of profiles) assertVerifiedPersonProfileQuality(profile);
if (!args.apply) {
  process.stdout.write(`${JSON.stringify({
    mode: "dry-run",
    reportPath,
    profileCount: profiles.length,
    estimatedIdentityScanPages: "ceil(current Notion People rows / 100)",
    estimatedQueries: profiles.length,
    estimatedMaximumWrites: profiles.length,
    estimatedReadbacks: profiles.length,
    identityIssueCount: report.identityIssues?.length ?? 0,
    unresolvedCount: report.unresolved?.length ?? 0,
    gate: "Apply only from a clean preflight under an explicit people-publication objective; identity ambiguity still requires human review."
  }, null, 2)}\n`);
  process.exit(0);
}
if (!args.confirmAuthorizedBatch) {
  throw new Error("--apply requires --confirm-authorized-batch after a clean preflight and explicit user authorization.");
}
if (args.authorizationMode === "authorized_batch") {
  if (!args.preflight) throw new Error("--confirm-authorized-batch requires --preflight.");
  const preflight = JSON.parse(await readFile(path.resolve(args.preflight), "utf8"));
  assertAuthorizedPersonPreflight(preflight, reportPath);
}
if ((report.identityIssues?.length ?? 0) > 0) {
  throw new Error("The report contains identity conflicts; resolve them before applying People rows.");
}
assertLeaseAllocatedPersonIds(profiles);

const token = required(process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN, "NOTION_WRITE_TOKEN or NOTION_TOKEN");
const dataSourceId = required(process.env.NOTION_PEOPLE_DATA_SOURCE_ID, "NOTION_PEOPLE_DATA_SOURCE_ID");
if (args.resolveIp) process.env.NOTION_API_RESOLVE_IP = args.resolveIp;
installNotionDnsOverride(args.resolveIp);
const clientOptions = { auth: token };
const proxyUrl = args.noProxy ? undefined : notionProxyUrl();
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: false }) : undefined;
const directAgent = args.localAddress
  ? new https.Agent({ keepAlive: true, localAddress: args.localAddress })
  : undefined;
if (directAgent) {
  clientOptions.fetch = nodeFetch;
  clientOptions.agent = directAgent;
} else if (proxyAgent) {
  clientOptions.agent = proxyAgent;
}
const source = new NotionPeopleSource(new Client(clientOptions), dataSourceId, new ProviderRateLimiter(1_000));
const stateDir = path.resolve(args.stateDir ?? process.env.WWPDW_PEOPLE_STATE_DIR ?? ".local-data/people");
const checkpointPath = path.resolve(args.checkpoint ?? path.join(stateDir, "notion-upsert-checkpoint.json"));
const checkpoint = await readCheckpoint(checkpointPath);
const summary = { created: 0, updated: 0, unchanged: 0, completed: [], failures: [] };
const lease = new LocalRunLease(path.join(stateDir, "notion-people.lock"));
const productionLock = acquireProductionLock({ owner: "notion-people-upsert", mode: "people-only" });

try {
  await lease.acquire();
  let identitySafety;
  try {
    identitySafety = await source.assertBatchIdentitySafety(profiles);
  } catch (error) {
    if (!(error instanceof PeopleBatchIdentityConflictError) || !args.identityConflicts) throw error;
    const conflictPath = path.resolve(args.identityConflicts);
    const conflictArtifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      reportPath,
      conflicts: error.conflicts
    };
    await writeJsonAtomic(conflictPath, conflictArtifact);
    if (args.autoRemapReport) {
      try {
        effectiveReport = remapReportToExistingPeople(report, conflictArtifact);
        const autoRemapReportPath = path.resolve(args.autoRemapReport);
        await writeJsonAtomic(autoRemapReportPath, effectiveReport);
        profiles = (effectiveReport.proposedProfiles ?? []).slice(0, args.limit ?? Number.MAX_SAFE_INTEGER);
        assertUniqueExternalIds(profiles);
        for (const profile of profiles) assertVerifiedPersonProfileQuality(profile);
        assertLeaseAllocatedPersonIds(profiles);
        identitySafety = await source.assertBatchIdentitySafety(profiles);
        summary.identityRemap = {
          reportPath: autoRemapReportPath,
          remappedProfiles: effectiveReport.identityRemaps?.length ?? 0,
          conflictPath
        };
      } catch (remapError) {
        summary.failures.push({
          personId: null,
          message: remapError instanceof Error ? remapError.message : String(remapError),
          conflictPath
        });
      }
    } else {
      summary.failures.push({ personId: null, message: error.message, conflictPath });
    }
  }
  if (identitySafety) {
    summary.identitySafety = identitySafety;
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
  }
} finally {
  proxyAgent?.destroy();
  directAgent?.destroy();
  await lease.release();
  productionLock.release();
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
  const result = { apply: false, confirmAuthorizedBatch: false, authorizationMode: null, report: undefined, preflight: undefined, checkpoint: undefined, identityConflicts: undefined, autoRemapReport: undefined, stateDir: undefined, limit: undefined, resolveIp: undefined, localAddress: undefined, noProxy: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") result.apply = true;
    else if (value === "--confirm-authorized-batch") {
      result.confirmAuthorizedBatch = true;
      result.authorizationMode = "authorized_batch";
    } else if (value === "--confirm-reviewed-pilot") {
      result.confirmAuthorizedBatch = true;
      result.authorizationMode = "legacy_reviewed_pilot";
    }
    else if (value === "--report") result.report = required(values[++index], "--report");
    else if (value === "--preflight") result.preflight = required(values[++index], "--preflight");
    else if (value === "--checkpoint") result.checkpoint = required(values[++index], "--checkpoint");
    else if (value === "--identity-conflicts") result.identityConflicts = required(values[++index], "--identity-conflicts");
    else if (value === "--auto-remap-report") result.autoRemapReport = required(values[++index], "--auto-remap-report");
    else if (value === "--state-dir") result.stateDir = required(values[++index], "--state-dir");
    else if (value === "--limit") result.limit = positiveInteger(values[++index], "--limit");
    else if (value === "--resolve-ip") result.resolveIp = required(values[++index], "--resolve-ip");
    else if (value === "--local-address") result.localAddress = required(values[++index], "--local-address");
    else if (value === "--no-proxy") result.noProxy = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (result.autoRemapReport && !result.identityConflicts) {
    throw new Error("--auto-remap-report requires --identity-conflicts so the remap keeps its evidence artifact.");
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

function positiveInteger(value, name) {
  const parsed = Number(required(value, name));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function assertLeaseAllocatedPersonIds(values) {
  if (values.some((profile) => !/^person_[0-9a-f-]{36}$/i.test(profile.personId))) {
    throw new Error("Every applied profile must have a lease-allocated immutable person_<uuid> ID.");
  }
}
