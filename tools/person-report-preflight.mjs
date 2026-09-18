import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AzurePersonCatalogStore } from "../packages/cache-store/src/person-catalog-azure.ts";
import { reviewPersonCoreProfile } from "../apps/api/src/person-biography-quality.ts";
import { classifyPersonReportAuthorization } from "./lib/person-report-authorization.mjs";

const options = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(options.report);
const catalogPath = path.resolve(options.catalog ?? ".local-data/home-site/person-catalog.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const catalogBackend = options.backend
  ?? process.env.PERSON_CATALOG_BACKEND
  ?? process.env.SEARCH_INDEX_BACKEND
  ?? process.env.CACHE_BACKEND
  ?? "local";
if (catalogBackend === "azure" && process.env.PERSON_CATALOG_AZURE_DISABLE_RANGE_QUERY === "1") {
  console.error("Azure person preflight: range query disabled; using bounded chunk reads.");
}
let catalog;
let catalogSource = `local:${catalogPath}`;
if (catalogBackend === "azure") {
  const catalogStore = new AzurePersonCatalogStore();
  catalog = await catalogStore.getState();
  catalogSource = catalogStore.description;
} else {
  catalog = JSON.parse(await readFile(catalogPath, "utf8"));
}

const proposedProfileIds = new Set((report.proposedProfiles ?? []).map((profile) => profile.personId).filter(Boolean));
const catalogPersonIds = new Set(Object.keys(catalog.people ?? {}));
const dangling = [];
const externalIds = new Map();
const externalIdConflicts = [];
for (const profile of report.proposedProfiles ?? []) {
  for (const [source, value] of Object.entries(profile.externalIds ?? {})) {
    if (typeof value !== "string" || !value.trim() || !profile.personId) continue;
    const key = `${source}:${value.trim().toLowerCase()}`;
    const previous = externalIds.get(key);
    if (previous && previous !== profile.personId) {
      externalIdConflicts.push({
        externalKey: key,
        personIds: [previous, profile.personId],
        reason: "external_id_conflict"
      });
    } else if (!previous) {
      externalIds.set(key, profile.personId);
    }
  }
}
const seen = new Set();
for (const work of report.proposedCredits ?? []) {
  for (const credit of work.credits ?? []) {
    if (!credit.personId || proposedProfileIds.has(credit.personId) || catalogPersonIds.has(credit.personId)) continue;
    const key = `${work.workId}\u0000${credit.personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dangling.push({
      workId: work.workId,
      workTitle: work.title,
      personId: credit.personId,
      creditName: credit.name,
      reason: "person_id_not_materialized"
    });
  }
}

const identityIssues = report.identityIssues ?? [];
const unresolved = report.unresolved ?? [];
const allIdentityIssues = [...identityIssues, ...externalIdConflicts];
const verifiedProfileQualityIssues = (report.proposedProfiles ?? [])
  .filter((profile) => profile.dataQuality?.status === "verified")
  .map((profile) => ({
    personId: profile.personId,
    displayName: profile.names?.find((name) => name.kind === "display")?.value ?? profile.personId,
    issues: reviewPersonCoreProfile(profile).issues
  }))
  .filter((entry) => entry.issues.length > 0);
const authorization = classifyPersonReportAuthorization({
  identityIssues: allIdentityIssues,
  danglingPersonIds: dangling,
  unresolved,
  verifiedProfileQualityIssues
});
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  reportPath,
  catalogPath,
  catalogBackend,
  catalogSource,
  status: authorization.status,
  profileCount: proposedProfileIds.size,
  workCount: (report.proposedCredits ?? []).length,
  identityIssueCount: allIdentityIssues.length,
  externalIdConflictCount: externalIdConflicts.length,
  unresolvedCount: unresolved.length,
  verifiedProfileQualityIssueCount: verifiedProfileQualityIssues.length,
  verifiedProfileQualityIssues,
  danglingPersonIdCount: dangling.length,
  danglingPersonIds: dangling,
  authorization: {
    explicitTaskAuthorizationRequired: authorization.explicitTaskAuthorizationRequired,
    humanReviewRequired: authorization.humanReviewRequired,
    humanReviewItemCount: authorization.humanReviewItems.length,
    humanReviewItems: authorization.humanReviewItems,
    deferredUnresolvedCount: authorization.deferredUnresolved.length,
    deferredUnresolved: authorization.deferredUnresolved
  },
  gates: {
    identityIssues: allIdentityIssues.length === 0,
    danglingPersonIds: dangling.length === 0,
    unresolvedCreditsAccountedFor: true,
    verifiedProfileQuality: verifiedProfileQualityIssues.length === 0,
    explicitTaskAuthorizationRequired: true,
    humanReviewRequired: authorization.humanReviewRequired
  }
};

if (options.output) {
  await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status === "blocked") process.exitCode = 2;

function parseArgs(values) {
  const result = { report: undefined, catalog: undefined, output: undefined, backend: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--report") result.report = required(values[++index], value);
    else if (value === "--catalog") result.catalog = required(values[++index], value);
    else if (value === "--output") result.output = required(values[++index], value);
    else if (value === "--backend") result.backend = required(values[++index], value);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.report) throw new Error("--report is required.");
  return result;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}
