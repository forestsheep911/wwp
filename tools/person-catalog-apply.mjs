import "dotenv/config";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createPersonCatalogStore, createSearchIndexStore } from "@wwpdw/cache-store";
import { LocalRunLease, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { applyPersonCatalogPlan, planReviewedPeopleReportApply } from "../apps/api/src/person-catalog-apply.ts";

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report ?? ".local-data/people/dry-run-report.json");
const stateDir = path.resolve(args.stateDir ?? ".local-data/people");
const localDataDir = path.resolve(args.localDataDir ?? process.env.WWPDW_HOME_DATA_DIR ?? ".local-data/home-site");
process.env.WWPDW_LOCAL_DATA_DIR = localDataDir;
if (args.apply && !args.confirmReviewedPilot) {
  throw new Error("--apply requires --confirm-reviewed-pilot after a human review of names and identity matches.");
}

const lease = new LocalRunLease(path.join(stateDir, "catalog-apply.lock"));
await lease.acquire();
try {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const personStore = createPersonCatalogStore();
  const searchStore = createSearchIndexStore();
  const currentCatalog = await personStore.getState();
  const searchResults = await searchStore.search("", 1_000_000);
  const generatedAt = new Date().toISOString();
  const plan = planReviewedPeopleReportApply(currentCatalog, searchResults, report, generatedAt);

  const output = {
    mode: args.apply ? "apply" : "dry-run",
    reportPath,
    localDataDir,
    personStore: personStore.description,
    searchStore: searchStore.description,
    searchIndexWrites: plan.updatedResults.length,
    personCatalogWrite: plan.summary.catalogChanged ? 1 : 0,
    ...plan.summary
  };
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    const backupPath = path.join(stateDir, `apply-backup-${generatedAt.replace(/[:.]/g, "-")}.json`);
    await writeJsonAtomic(backupPath, {
      schemaVersion: 1,
      createdAt: generatedAt,
      reportPath,
      personCatalog: currentCatalog,
      searchResults: plan.originalResults
    });
    await applyPersonCatalogPlan({ plan, searchStore, personStore, indexedAt: generatedAt });
    process.stdout.write(`${JSON.stringify({ ...output, backupPath }, null, 2)}\n`);
  }
} finally {
  await lease.release();
}

function parseArgs(values) {
  const result = { apply: false, confirmReviewedPilot: false, report: undefined, stateDir: undefined, localDataDir: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") continue;
    if (value === "--apply") result.apply = true;
    else if (value === "--confirm-reviewed-pilot") result.confirmReviewedPilot = true;
    else if (value === "--report") result.report = required(values[++index], "--report");
    else if (value === "--state-dir") result.stateDir = required(values[++index], "--state-dir");
    else if (value === "--local-data-dir") result.localDataDir = required(values[++index], "--local-data-dir");
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}
