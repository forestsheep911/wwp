import "dotenv/config";
import { runPeopleNotionSyncFromEnvironment } from "../apps/api/src/person-notion-sync-runtime.ts";

const args = parseArgs(process.argv.slice(2));
if (args.localDataDir) process.env.WWPDW_LOCAL_DATA_DIR = args.localDataDir;
const result = await runPeopleNotionSyncFromEnvironment({
  apply: args.apply,
  limit: args.limit,
  pageSize: args.pageSize,
  stateDir: args.stateDir
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function parseArgs(values) {
  const result = { apply: false, limit: undefined, pageSize: undefined, stateDir: undefined, localDataDir: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") continue;
    if (value === "--apply") result.apply = true;
    else if (value === "--limit") result.limit = positiveInteger(values[++index], "--limit");
    else if (value === "--page-size") result.pageSize = positiveInteger(values[++index], "--page-size");
    else if (value === "--state-dir") result.stateDir = required(values[++index], "--state-dir");
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
