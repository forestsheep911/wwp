import "dotenv/config";
import { runPeopleNotionSyncFromEnvironment } from "../apps/api/src/person-notion-sync-runtime.ts";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.localDataDir) process.env.WWPDW_LOCAL_DATA_DIR = args.localDataDir;
const productionLock = acquireProductionLock({ owner: "notion-people-sync", mode: "people-only" });
try {
  const result = await runPeopleNotionSyncFromEnvironment({
    apply: args.apply,
    limit: args.limit,
    maxApplied: args.maxApplied,
    pageSize: args.pageSize,
    personIds: args.personIds,
    stateDir: args.stateDir
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  productionLock.release();
}

function parseArgs(values) {
  const result = { apply: false, limit: undefined, maxApplied: undefined, pageSize: undefined, stateDir: undefined, localDataDir: undefined, personIds: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") continue;
    if (value === "--apply") result.apply = true;
    else if (value === "--limit") result.limit = positiveInteger(values[++index], "--limit");
    else if (value === "--max-applied") result.maxApplied = positiveInteger(values[++index], "--max-applied");
    else if (value === "--page-size") result.pageSize = positiveInteger(values[++index], "--page-size");
    else if (value === "--state-dir") result.stateDir = required(values[++index], "--state-dir");
    else if (value === "--person-id") result.personIds.push(required(values[++index], "--person-id"));
    else if (value === "--local-data-dir") result.localDataDir = required(values[++index], "--local-data-dir");
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function required(value, option) {
  if (!value?.trim()) throw new Error(`${option} requires a value.`);
  return value.trim();
}

function positiveInteger(value, option) {
  const parsed = Number(required(value, option));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}
