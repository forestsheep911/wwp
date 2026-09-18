import "dotenv/config";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createPersonCatalogStore, createSearchIndexStore, mergePersonCatalogEntries } from "@wwpdw/cache-store";
import { LocalRunLease, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { applyPersonCatalogPlan, planReviewedPeopleReportApply } from "../apps/api/src/person-catalog-apply.ts";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";
import { assertAuthorizedPersonPreflight } from "./lib/person-report-authorization.mjs";
import { verifyPeopleCatalogReadback } from "./lib/people-catalog-readback.mjs";

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report ?? ".local-data/people/dry-run-report.json");
const stateDir = path.resolve(args.stateDir ?? ".local-data/people");
const localDataDir = path.resolve(args.localDataDir ?? process.env.WWPDW_HOME_DATA_DIR ?? ".local-data/home-site");
process.env.WWPDW_LOCAL_DATA_DIR = localDataDir;
function storeBackend(store) {
  return store.description?.startsWith("azure:") ? "azure" : "local";
}
let authorizationPreflight;
if (args.apply && !args.confirmAuthorizedBatch) {
  throw new Error("--apply requires --confirm-authorized-batch after a clean preflight and explicit user authorization.");
}
if (args.apply && args.authorizationMode === "authorized_batch") {
  if (!args.preflight) throw new Error("--confirm-authorized-batch requires --preflight.");
  authorizationPreflight = JSON.parse(await readFile(path.resolve(args.preflight), "utf8"));
  assertAuthorizedPersonPreflight(authorizationPreflight, reportPath);
}

const lease = new LocalRunLease(path.join(stateDir, "catalog-apply.lock"));
const productionLock = acquireProductionLock({ owner: "person-catalog-apply", mode: "people-only" });
const runStatusPath = path.join(stateDir, "catalog-apply-run.json");
let runStartedAt;
try {
  await lease.acquire();
  runStartedAt = new Date().toISOString();
  await writeJsonAtomic(runStatusPath, {
    schemaVersion: 1,
    status: "in_progress",
    phase: "planning",
    startedAt: runStartedAt,
    pid: process.pid,
    reportPath
  });
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  let preferReviewedPersonIds = false;
  let reviewedNotionPageIds = {};
  if (args.notionCheckpoint) {
    const checkpoint = JSON.parse(await readFile(path.resolve(args.notionCheckpoint), "utf8"));
    const missing = (report.proposedProfiles ?? []).filter((profile) => !checkpoint.completed?.[profile.personId]);
    if (missing.length) throw new Error(`Notion checkpoint is missing ${missing.length} reviewed profile(s).`);
    preferReviewedPersonIds = true;
    reviewedNotionPageIds = Object.fromEntries((report.proposedProfiles ?? []).map((profile) => [
      profile.personId,
      checkpoint.completed[profile.personId].pageId
    ]));
  }
  const personStore = createPersonCatalogStore();
  const searchStore = createSearchIndexStore();
  if (args.apply && authorizationPreflight?.catalogBackend) {
    const expectedBackend = authorizationPreflight.catalogBackend;
    const actualBackends = [storeBackend(personStore), storeBackend(searchStore)];
    if (actualBackends.some((backend) => backend !== expectedBackend)) {
      throw new Error(`People apply backend mismatch: preflight=${expectedBackend}, personStore=${actualBackends[0]}, searchStore=${actualBackends[1]}. Re-run preflight and apply with the same backend.`);
    }
  }
  let currentCatalog = await personStore.getState();
  for (const merge of args.personMerges) {
    currentCatalog = mergePersonCatalogEntries(currentCatalog, merge.canonicalPersonId, merge.retiredPersonId);
  }
  // Biography-only repair batches have no work credits to inspect or update.
  // Avoid downloading the complete production movie index for those runs.
  const proposedWorkIds = [...new Set((report.proposedCredits ?? [])
    .map((credit) => credit.workId)
    .filter(Boolean))];
  const requiresSearchIndexResult = (report.proposedCredits ?? []).some((credit) => !credit.metadataOnlyWork);
  if (requiresSearchIndexResult && proposedWorkIds.length === 1 && !args.assetKey) {
    throw new Error("Single-work People apply requires --asset-key to avoid scanning the complete search index.");
  }
  const searchResults = requiresSearchIndexResult
    ? args.assetKey
      ? [await searchStore.getResult(args.assetKey)].filter(Boolean)
      : await searchStore.search("", 1_000_000)
    : [];
  if (report.proposedCredits?.length && args.assetKey && searchResults.length === 0) {
    throw new Error(`Search index result not found for --asset-key ${args.assetKey}.`);
  }
  const generatedAt = new Date().toISOString();
  const plan = planReviewedPeopleReportApply(currentCatalog, searchResults, report, generatedAt, {
    preferReviewedPersonIds,
    reviewedNotionPageIds
  });
  const unlinkedCredits = plan.updatedResults.flatMap((result) => {
    const work = result.metadata?.work;
    return (work?.credits ?? result.metadata?.credits ?? [])
      .filter((credit) => !credit.personId)
      .map((credit) => ({
        workId: work?.workId,
        name: credit.name,
        department: credit.department,
        ...(credit.job ? { job: credit.job } : {}),
        ...(credit.character ? { character: credit.character } : {}),
        ...(credit.externalIds ? { externalIds: credit.externalIds } : {})
      }));
  });

  const output = {
    mode: args.apply ? "apply" : "dry-run",
    reportPath,
    localDataDir,
    personStore: personStore.description,
    searchStore: searchStore.description,
    searchIndexWrites: plan.updatedResults.length,
    personCatalogWrite: plan.summary.catalogChanged ? 1 : 0,
    unlinkedCredits,
    ...plan.summary
  };
  const baselineUnlinkedCredits = searchResults.flatMap((result) => {
    const work = result.metadata?.work;
    return (work?.credits ?? result.metadata?.credits ?? []).filter((credit) => !credit.personId);
  }).length;
  const noProgress = args.apply
    && report.proposedCredits?.length > 0
    && plan.summary.unlinkedCreditCount > 0
    && plan.updatedResults.length === 0
    && !plan.summary.catalogChanged;
  if (noProgress) {
    throw new Error(`People apply made no progress: residual credits remain=${plan.summary.unlinkedCreditCount}, catalog/index writes=0. Rebuild the supplement from the authoritative residual credit list before retrying.`);
  }
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    await writeJsonAtomic(runStatusPath, {
      schemaVersion: 1,
      status: "in_progress",
      phase: "writing",
      startedAt: runStartedAt,
      updatedAt: new Date().toISOString(),
      pid: process.pid,
      reportPath,
      baselineUnlinkedCredits,
      plannedUnlinkedCredits: unlinkedCredits.length
    });
    const backupPath = path.join(stateDir, `apply-backup-${generatedAt.replace(/[:.]/g, "-")}.json`);
    await writeJsonAtomic(backupPath, {
      schemaVersion: 1,
      createdAt: generatedAt,
      reportPath,
      personCatalog: currentCatalog,
      searchResults: plan.originalResults
    });
    await applyPersonCatalogPlan({ plan, searchStore, personStore, indexedAt: generatedAt });
    if (plan.updatedResults.length > 0) {
      const readback = await verifyPeopleCatalogReadback({
        searchStore,
        expectedResults: plan.updatedResults,
        attempts: 3,
        delayMs: 1500
      });
      if (!readback.verified) {
        throw new Error(`People catalog readback did not converge after ${readback.attempts} attempt(s): ${JSON.stringify(readback.failures)}`);
      }
    }
    const completedOutput = { ...output, backupPath };
    await writeJsonAtomic(runStatusPath, {
      schemaVersion: 1,
      status: "completed",
      phase: "readback_verified",
      startedAt: runStartedAt,
      completedAt: new Date().toISOString(),
      pid: process.pid,
      reportPath,
      result: completedOutput
    });
    process.stdout.write(`${JSON.stringify(completedOutput, null, 2)}\n`);
  }
} catch (error) {
  if (runStartedAt) {
    await writeJsonAtomic(runStatusPath, {
      schemaVersion: 1,
      status: "failed_resumable",
      phase: "error",
      startedAt: runStartedAt,
      failedAt: new Date().toISOString(),
      pid: process.pid,
      reportPath,
      error: String(error?.message ?? error),
      nextTrigger: "保留同一批次报告与备份；先检查 Azure/Notion 读回，再重试同一批次或按残余清单拆分"
    });
  }
  throw error;
} finally {
  await lease.release();
  productionLock.release();
}

function parseArgs(values) {
  const result = { apply: false, confirmAuthorizedBatch: false, authorizationMode: null, report: undefined, preflight: undefined, notionCheckpoint: undefined, assetKey: undefined, personMerges: [], stateDir: undefined, localDataDir: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") continue;
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
    else if (value === "--notion-checkpoint") result.notionCheckpoint = required(values[++index], "--notion-checkpoint");
    else if (value === "--asset-key") result.assetKey = required(values[++index], "--asset-key");
    else if (value === "--merge-person") {
      const [retiredPersonId, canonicalPersonId, extra] = required(values[++index], "--merge-person").split("=");
      if (!retiredPersonId || !canonicalPersonId || extra) throw new Error("--merge-person requires retiredPersonId=canonicalPersonId.");
      result.personMerges.push({ retiredPersonId, canonicalPersonId });
    }
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
