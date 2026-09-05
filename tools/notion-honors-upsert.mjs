import "dotenv/config";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProviderRateLimiter } from "../apps/api/src/person-sources/provider-http.ts";
import { LocalRunLease, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { NotionHonorsSource } from "../apps/api/src/notion-honors-source.ts";
import { validateWorkHonorRecord } from "../apps/api/src/work-honor.ts";
import { installNotionDnsOverride, notionProxyUrl } from "../apps/api/src/notion-network.ts";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input);
const input = JSON.parse(await readFile(inputPath, "utf8"));
const records = input.records ?? [];
const workPageIds = input.workPageIds ?? {};
const validation = records.map((record) => ({ honorId: record.honorId, ...validateWorkHonorRecord(record) }));
const errors = validation.filter((entry) => !entry.valid);
const missingWorkPages = records.filter((record) => !workPageIds[record.workId]).map((record) => record.workId);
if (errors.length || missingWorkPages.length) throw new Error(`Unsafe Honors input: ${JSON.stringify({ errors, missingWorkPages })}`);
if (!args.apply) {
  process.stdout.write(`${JSON.stringify({ mode: "dry-run", inputPath, records: records.length, estimatedQueries: records.length, estimatedMaximumWrites: records.length, estimatedReadbacks: records.length, honorIds: records.map((record) => record.honorId) }, null, 2)}\n`);
  process.exit(0);
}
if (!args.confirmReviewedPilot) throw new Error("--apply requires --confirm-reviewed-pilot.");
const token = required(process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN, "NOTION_WRITE_TOKEN or NOTION_TOKEN");
const dataSourceId = required(process.env.NOTION_HONORS_DATA_SOURCE_ID, "NOTION_HONORS_DATA_SOURCE_ID");
installNotionDnsOverride();
const proxyUrl = notionProxyUrl();
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: false }) : undefined;
const clientOptions = { auth: token, ...(proxyAgent ? { agent: proxyAgent } : {}) };
const limiter = new ProviderRateLimiter(1_000);
const source = new NotionHonorsSource(new Client(clientOptions), dataSourceId, (operation) => limiter.schedule(operation));
const stateDir = path.resolve(args.stateDir);
const checkpointPath = path.join(stateDir, "notion-honors-upsert-checkpoint.json");
const checkpoint = await readCheckpoint(checkpointPath);
const summary = { created: 0, updated: 0, unchanged: 0, completed: [], failures: [] };
const lease = new LocalRunLease(path.join(stateDir, "notion-honors.lock"));
const productionLock = acquireProductionLock({ owner: "notion-honors-upsert", mode: "enrichment-only" });
try {
  await lease.acquire();
  for (const record of records) {
    try {
      const result = await source.upsert(record, workPageIds[record.workId]);
      summary[result.action] += 1;
      summary.completed.push({ honorId: record.honorId, pageId: result.pageId, action: result.action });
      checkpoint.completed[record.honorId] = { pageId: result.pageId, appliedAt: new Date().toISOString() };
      await writeJsonAtomic(checkpointPath, checkpoint);
    } catch (error) {
      summary.failures.push({ honorId: record.honorId, message: error instanceof Error ? error.message : String(error) });
      break;
    }
  }
} finally {
  proxyAgent?.destroy();
  await lease.release();
  productionLock.release();
}
process.stdout.write(`${JSON.stringify({ mode: "applied", inputPath, checkpointPath, ...summary }, null, 2)}\n`);
if (summary.failures.length) process.exitCode = 1;

async function readCheckpoint(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return { schemaVersion: 1, completed: {} }; throw error; }
}

function parseArgs(values) {
  const result = { apply: false, confirmReviewedPilot: false, input: ".local-data/enrichment-pilot/2026-09-05/all-beauty-honors.json", stateDir: ".local-data/enrichment-pilot/2026-09-05/honors-state" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") result.apply = true;
    else if (value === "--confirm-reviewed-pilot") result.confirmReviewedPilot = true;
    else if (value === "--input") result.input = required(values[++index], "--input");
    else if (value === "--state-dir") result.stateDir = required(values[++index], "--state-dir");
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function required(value, name) { if (!value?.trim()) throw new Error(`${name} is required.`); return value.trim(); }
