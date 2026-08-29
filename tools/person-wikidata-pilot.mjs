import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createPersonCatalogStore, createSearchIndexStore } from "@wwpdw/cache-store";
import { materializePersonEvidence } from "../apps/api/src/person-materialization.ts";
import { prioritizePeopleCandidateBatch } from "../apps/api/src/person-candidate-priority.ts";
import { JsonEvidenceCache, LocalRunLease, readCheckpoint, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { ProviderRateLimiter } from "../apps/api/src/person-sources/provider-http.ts";
import { assertWikidataPersonRole, NonHumanWikidataEntityError, WikidataPersonSource, WikidataRoleMismatchError } from "../apps/api/src/person-sources/wikidata.ts";
import { WikidataWorkCreditsSource } from "../apps/api/src/person-sources/wikidata-work.ts";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.stateDir ?? ".local-data/people/wikidata-pilot");
const outputPath = path.resolve(args.output ?? path.join(root, "review-report.json"));
const checkpointPath = path.join(root, "checkpoint.json");
const cache = new JsonEvidenceCache(path.join(root, "cache"));
const lease = new LocalRunLease(path.join(root, "pilot.lock"));
const limiter = new ProviderRateLimiter(args.intervalMs);
const catalogBackend = resolveCatalogBackend(args.searchBackend);

await lease.acquire();
try {
  const work = await loadWork(args);
  const checkpoint = await readCheckpoint(checkpointPath);
  const workSource = new WikidataWorkCreditsSource({ limiter });
  const personSource = new WikidataPersonSource({ limiter });
  const workCacheKey = `${args.kind}-${args.wikidataId}`;
  const workCreditLocale = "multilingual-v3-voice-actor-english-original-name";
  let workEvidence = await cache.get("wikidata", "work-credits", workCacheKey, workCreditLocale, 30 * 86_400_000);
  const cachedWork = Boolean(workEvidence);
  if (!workEvidence) {
    workEvidence = await workSource.fetchWorkCredits(args.wikidataId, args.kind);
    await cache.put("wikidata", "work-credits", workCacheKey, workCreditLocale, workEvidence);
  }

  const excludedIds = new Set(args.excludeWikidataIds.map((value) => value.toUpperCase()));
  const candidateIds = selectProfileIds(workEvidence.credits, work.credits).filter((value) => !excludedIds.has(value));
  const evidence = [];
  const skippedNonHuman = [];
  const skippedIdentityMismatches = [];
  let cachedPeople = 0;
  for (const wikidataId of candidateIds) {
    if (evidence.length >= args.profileBudget) break;
    try {
      let person = await cache.get("wikidata", "person", wikidataId, "multilingual-human-v3-simplified-valid-dates", 30 * 86_400_000);
      if (person) cachedPeople += 1;
      else {
        person = await personSource.fetchPersonEvidence(wikidataId, expectedDepartmentsFor(wikidataId, workEvidence.credits));
        await cache.put("wikidata", "person", wikidataId, "multilingual-human-v3-simplified-valid-dates", person);
      }
      assertWikidataPersonRole(wikidataId, person, expectedDepartmentsFor(wikidataId, workEvidence.credits));
      evidence.push(person);
    } catch (error) {
      if (error instanceof NonHumanWikidataEntityError) {
        skippedNonHuman.push(wikidataId);
        continue;
      }
      if (error instanceof WikidataRoleMismatchError) {
        skippedIdentityMismatches.push({ wikidataId, reason: error.message });
        continue;
      }
      throw error;
    }
  }

  const catalogState = await createPersonCatalogStore(catalogBackend).getState();
  const generatedAt = new Date().toISOString();
  const materialized = materializePersonEvidence({
    state: catalogState,
    evidence,
    workCredits: [{ workId: args.workId, title: work.title, credits: workEvidence.credits }],
    allocatePersonId: (ids) => allocatePersonId(checkpoint, ids),
    now: generatedAt
  });
  checkpoint.updatedAt = generatedAt;
  checkpoint.deferredConflicts = materialized.issues;
  await writeJsonAtomic(checkpointPath, checkpoint);
  const report = {
    schemaVersion: 1,
    mode: "wikidata-network-dry-run",
    generatedAt,
    ratePolicy: { concurrency: 1, minimumIntervalMs: args.intervalMs },
    profileBudget: args.profileBudget,
    excludedWikidataIds: [...excludedIds],
    proposedPeople: evidence,
    proposedProfiles: materialized.profiles,
    proposedCredits: materialized.creditReplacements,
    identityIssues: materialized.issues,
    skippedIdentityMismatches,
    unresolved: materialized.unresolved.map((entry) => ({
      ...(entry.workId ? { workId: entry.workId } : {}),
      ...(entry.creditName ? { creditName: entry.creditName } : {}),
      reason: entry.reason
    }))
  };
  await writeJsonAtomic(outputPath, report);
  const linked = materialized.creditReplacements[0]?.credits.filter((credit) => credit.personId).length ?? 0;
  const totalCredits = materialized.creditReplacements[0]?.credits.length ?? 0;
  process.stdout.write(`${JSON.stringify({
    reportPath: outputPath,
    workId: args.workId,
    title: work.title,
    totalCredits,
    linkedCredits: linked,
    pendingCredits: totalCredits - linked,
    proposedProfiles: materialized.profiles.length,
    identityIssues: materialized.issues.length,
    cachedWork,
    cachedPeople,
    excludedWikidataIds: [...excludedIds],
    skippedNonHuman,
    skippedIdentityMismatches,
    ratePolicy: report.ratePolicy
  }, null, 2)}\n`);
} finally {
  await lease.release();
}

function selectProfileIds(credits, anchors = []) {
  return prioritizePeopleCandidateBatch(credits, anchors)
    .map((credit) => credit.externalIds?.wikidata)
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function expectedDepartmentsFor(wikidataId, credits) {
  return [...new Set(credits.filter((credit) => credit.externalIds?.wikidata === wikidataId).map((credit) => credit.department))];
}

function allocatePersonId(checkpoint, ids) {
  const key = ids.tmdb ? `tmdb:${ids.tmdb}` : ids.imdb ? `imdb:${ids.imdb}` : `wikidata:${ids.wikidata}`;
  return checkpoint.assignedPersonIds[key] ??= `person_${randomUUID()}`;
}

function findWork(snapshot, workId) {
  for (const entry of Object.values(snapshot.entries ?? {})) {
    const work = entry?.result?.metadata?.work;
    if (work?.workId !== workId) continue;
    return {
      title: work.display?.title ?? work.titles?.[0]?.title ?? entry.result.title ?? workId,
      credits: work.credits ?? []
    };
  }
  throw new Error(`Work ${workId} was not found in ${args.snapshot}.`);
}

async function loadWork(options) {
  if (!options.searchBackend) {
    const snapshot = JSON.parse(await readFile(path.resolve(options.snapshot), "utf8"));
    return findWork(snapshot, options.workId);
  }
  const results = await createSearchIndexStore(options.searchBackend).search(options.workId, 20);
  for (const result of results) {
    const work = result.metadata?.work;
    if (work?.workId !== options.workId) continue;
    return {
      title: work.display?.title ?? work.titles?.[0]?.title ?? result.title ?? options.workId,
      credits: work.credits ?? []
    };
  }
  throw new Error(`Work ${options.workId} was not found in the ${options.searchBackend} search index.`);
}

function parseArgs(values) {
  const result = {
    workId: undefined,
    wikidataId: undefined,
    kind: "movie",
    profileBudget: 10,
    intervalMs: 1300,
    snapshot: ".local-data/home-site/search-index.json",
    searchBackend: undefined,
    stateDir: undefined,
    output: undefined,
    excludeWikidataIds: []
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--work-id") result.workId = required(values[++index], value);
    else if (value === "--wikidata-id") result.wikidataId = required(values[++index], value);
    else if (value === "--kind") result.kind = required(values[++index], value) === "series" ? "series" : "movie";
    else if (value === "--profile-budget") result.profileBudget = positiveInteger(values[++index], value);
    else if (value === "--interval-ms") result.intervalMs = positiveInteger(values[++index], value);
    else if (value === "--snapshot") result.snapshot = required(values[++index], value);
    else if (value === "--search-backend") result.searchBackend = required(values[++index], value);
    else if (value === "--state-dir") result.stateDir = required(values[++index], value);
    else if (value === "--output") result.output = required(values[++index], value);
    else if (value === "--exclude-wikidata-id") result.excludeWikidataIds.push(required(values[++index], value));
    else throw new Error(`Unknown argument: ${value}`);
  }
  result.workId = required(result.workId, "--work-id");
  result.wikidataId = required(result.wikidataId, "--wikidata-id");
  return result;
}

function resolveCatalogBackend(searchBackend) {
  const configured = process.env.PERSON_CATALOG_BACKEND;
  if (searchBackend && configured && searchBackend !== configured) {
    throw new Error(`Search backend ${searchBackend} conflicts with PERSON_CATALOG_BACKEND=${configured}.`);
  }
  return configured ?? searchBackend;
}

function required(value, name) {
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(required(value, name));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
