import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createPersonCatalogStore } from "@wwpdw/cache-store";
import { materializePersonEvidence } from "../apps/api/src/person-materialization.ts";
import { JsonEvidenceCache, LocalRunLease, readCheckpoint, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { ProviderRateLimiter } from "../apps/api/src/person-sources/provider-http.ts";
import { NonHumanWikidataEntityError, WikidataPersonSource } from "../apps/api/src/person-sources/wikidata.ts";
import { WikidataWorkCreditsSource } from "../apps/api/src/person-sources/wikidata-work.ts";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.stateDir ?? ".local-data/people/wikidata-pilot");
const outputPath = path.resolve(args.output ?? path.join(root, "review-report.json"));
const checkpointPath = path.join(root, "checkpoint.json");
const cache = new JsonEvidenceCache(path.join(root, "cache"));
const lease = new LocalRunLease(path.join(root, "pilot.lock"));
const limiter = new ProviderRateLimiter(args.intervalMs);

await lease.acquire();
try {
  const snapshot = JSON.parse(await readFile(path.resolve(args.snapshot), "utf8"));
  const work = findWork(snapshot, args.workId);
  const checkpoint = await readCheckpoint(checkpointPath);
  const workSource = new WikidataWorkCreditsSource({ limiter });
  const personSource = new WikidataPersonSource({ limiter });
  const workCacheKey = `${args.kind}-${args.wikidataId}`;
  let workEvidence = await cache.get("wikidata", "work-credits", workCacheKey, "multilingual", 30 * 86_400_000);
  const cachedWork = Boolean(workEvidence);
  if (!workEvidence) {
    workEvidence = await workSource.fetchWorkCredits(args.wikidataId, args.kind);
    await cache.put("wikidata", "work-credits", workCacheKey, "multilingual", workEvidence);
  }

  const excludedIds = new Set(args.excludeWikidataIds.map((value) => value.toUpperCase()));
  const candidateIds = selectProfileIds(workEvidence.credits).filter((value) => !excludedIds.has(value));
  const evidence = [];
  const skippedNonHuman = [];
  let cachedPeople = 0;
  for (const wikidataId of candidateIds) {
    if (evidence.length >= args.profileBudget) break;
    try {
      let person = await cache.get("wikidata", "person", wikidataId, "multilingual-human-v3-simplified-valid-dates", 30 * 86_400_000);
      if (person) cachedPeople += 1;
      else {
        person = await personSource.fetchPersonEvidence(wikidataId);
        await cache.put("wikidata", "person", wikidataId, "multilingual-human-v3-simplified-valid-dates", person);
      }
      evidence.push(person);
    } catch (error) {
      if (error instanceof NonHumanWikidataEntityError) {
        skippedNonHuman.push(wikidataId);
        continue;
      }
      throw error;
    }
  }

  const catalogState = await createPersonCatalogStore().getState();
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
    ratePolicy: report.ratePolicy
  }, null, 2)}\n`);
} finally {
  await lease.release();
}

function selectProfileIds(credits) {
  const priority = { directing: 0, writing: 1, production: 2, camera: 3, editing: 4, music: 5, acting: 6 };
  return [...credits]
    .sort((left, right) => (priority[left.department] ?? 9) - (priority[right.department] ?? 9)
      || (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
    .map((credit) => credit.externalIds?.wikidata)
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function allocatePersonId(checkpoint, ids) {
  const key = ids.tmdb ? `tmdb:${ids.tmdb}` : ids.imdb ? `imdb:${ids.imdb}` : `wikidata:${ids.wikidata}`;
  return checkpoint.assignedPersonIds[key] ??= `person_${randomUUID()}`;
}

function findWork(snapshot, workId) {
  for (const entry of Object.values(snapshot.entries ?? {})) {
    const work = entry?.result?.metadata?.work;
    if (work?.workId !== workId) continue;
    return { title: work.display?.title ?? work.titles?.[0]?.title ?? entry.result.title ?? workId };
  }
  throw new Error(`Work ${workId} was not found in ${args.snapshot}.`);
}

function parseArgs(values) {
  const result = {
    workId: undefined,
    wikidataId: undefined,
    kind: "movie",
    profileBudget: 6,
    intervalMs: 1300,
    snapshot: ".local-data/home-site/search-index.json",
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
    else if (value === "--state-dir") result.stateDir = required(values[++index], value);
    else if (value === "--output") result.output = required(values[++index], value);
    else if (value === "--exclude-wikidata-id") result.excludeWikidataIds.push(required(values[++index], value));
    else throw new Error(`Unknown argument: ${value}`);
  }
  result.workId = required(result.workId, "--work-id");
  result.wikidataId = required(result.wikidataId, "--wikidata-id");
  return result;
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
