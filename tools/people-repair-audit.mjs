import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPersonCatalogStore } from "@wwpdw/cache-store";
import { auditPeopleRepairCandidates } from "../apps/api/src/people-repair-audit.ts";

const options = parseArgs(process.argv.slice(2));
if (options.backend) process.env.PERSON_CATALOG_BACKEND = options.backend;
if (options.localDataDir) process.env.WWPDW_LOCAL_DATA_DIR = path.resolve(options.localDataDir);

const store = createPersonCatalogStore();
const state = await store.getState();
const audit = auditPeopleRepairCandidates(state, options.candidateLimit);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  catalogGeneratedAt: state.generatedAt,
  personStore: store.description,
  ...audit
};

if (options.outputDir) {
  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "repair-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "repair-queue.json"), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    catalogGeneratedAt: report.catalogGeneratedAt,
    personStore: report.personStore,
    candidateLimit: options.candidateLimit,
    actionableCount: report.actionableCount,
    queue: report.queue
  }, null, 2)}\n`, "utf8");
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: report.schemaVersion,
  generatedAt: report.generatedAt,
  catalogGeneratedAt: report.catalogGeneratedAt,
  personStore: report.personStore,
  totalPeople: report.totalPeople,
  summary: report.summary,
  actionableCount: report.actionableCount,
  optionalObservationCount: report.optionalObservationCount,
  queued: report.queue.length,
  queue: report.queue
}, null, 2)}\n`);

function parseArgs(values) {
  const options = { backend: undefined, outputDir: undefined, candidateLimit: 100, localDataDir: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--backend") options.backend = required(values[++index], value);
    else if (value === "--output-dir") options.outputDir = required(values[++index], value);
    else if (value === "--local-data-dir") options.localDataDir = required(values[++index], value);
    else if (value === "--candidate-limit") options.candidateLimit = positiveInteger(values[++index], value);
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
