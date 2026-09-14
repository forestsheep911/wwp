import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AzureSearchIndexStore, LocalSearchIndexStore } from "../packages/cache-store/src/search-index.ts";
import { auditPeopleWorkCoverage } from "../apps/api/src/people-work-coverage-audit.ts";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";
import { describePeopleCoverageTargets } from "./lib/person-coverage-target.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.backend) process.env.SEARCH_INDEX_BACKEND = options.backend;

const productionLock = acquireProductionLock({ owner: "people-work-coverage-audit", mode: "people-only" });
try {
  const backend = options.backend ?? process.env.SEARCH_INDEX_BACKEND ?? process.env.CACHE_BACKEND ?? "local";
  const store = backend === "azure"
    ? new AzureSearchIndexStore()
    : new LocalSearchIndexStore(path.resolve(process.env.WWPDW_LOCAL_DATA_DIR ?? ".local-data", "search-index.json"));
  const results = await store.search("", 1_000_000);
  const coverage = auditPeopleWorkCoverage(results, options.candidateLimit);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    searchStore: store.description,
    ...coverage,
    targets: describePeopleCoverageTargets(results, options.workIds)
  };

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    searchStore: report.searchStore,
    totalWorks: report.totalWorks,
    summary: report.summary,
    candidateCount: report.candidates.length,
    candidates: report.candidates,
    targets: report.targets
  }, null, 2)}\n`);
} finally {
  productionLock.release();
}

function parseArgs(values) {
  const options = { backend: undefined, output: undefined, candidateLimit: 100, workIds: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--backend") options.backend = required(values[++index], value);
    else if (value === "--output") options.output = required(values[++index], value);
    else if (value === "--candidate-limit") options.candidateLimit = positiveInteger(values[++index], value);
    else if (value === "--work-id") options.workIds.push(required(values[++index], value));
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer.`);
  return parsed;
}
