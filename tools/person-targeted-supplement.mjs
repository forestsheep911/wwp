#!/usr/bin/env node

import "./lib/project-env.mjs";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createPersonCatalogStore } from "@wwpdw/cache-store";
import { materializePersonEvidence } from "../apps/api/src/person-materialization.ts";
import { JsonEvidenceCache, LocalRunLease, readCheckpoint, writeJsonAtomic } from "../apps/api/src/person-enrichment.ts";
import { ProviderRateLimiter } from "../apps/api/src/person-sources/provider-http.ts";
import { assertWikidataPersonRole, WikidataPersonSource } from "../apps/api/src/person-sources/wikidata.ts";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";
import {
  mergeCreditIdentityEvidence,
  reviewedEvidenceForCredit,
  validateTargetedSupplementInput
} from "./lib/person-targeted-supplement-input.mjs";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.stateDir ?? path.dirname(args.output));
const outputPath = path.resolve(args.output);
const reviewedOutputPath = args.reviewedOutput ? path.resolve(args.reviewedOutput) : null;
const inputPath = path.resolve(args.input);
const cache = new JsonEvidenceCache(path.join(root, "cache"));
const lease = new LocalRunLease(path.join(root, "targeted-supplement.lock"));
const limiter = new ProviderRateLimiter(args.intervalMs);
const productionLock = acquireProductionLock({ owner: "person-targeted-supplement", mode: "people-only" });

await lease.acquire();
try {
  const input = validateTargetedSupplementInput(JSON.parse(await readFile(inputPath, "utf8")));
  const checkpointPath = path.join(root, "checkpoint.json");
  const checkpoint = await readCheckpoint(checkpointPath);
  const source = new WikidataPersonSource({ limiter });
  const evidence = [];
  for (const credit of input.credits) {
    const wikidataId = credit.externalIds.wikidata;
    if (!wikidataId) {
      evidence.push(withLegacyAliases(reviewedEvidenceForCredit(credit), credit));
      continue;
    }
    let person = await cache.get("wikidata", "person", wikidataId, "multilingual-human-v3-simplified-valid-dates", 30 * 86_400_000);
    if (!person) {
      person = await source.fetchPersonEvidence(wikidataId, [credit.department]);
      await cache.put("wikidata", "person", wikidataId, "multilingual-human-v3-simplified-valid-dates", person);
    }
    assertWikidataPersonRole(wikidataId, person, [credit.department]);
    evidence.push(withLegacyAliases(mergeCreditIdentityEvidence(person, credit), credit));
  }

  const catalog = await createPersonCatalogStore(args.backend).getState();
  const generatedAt = new Date().toISOString();
  const materialized = materializePersonEvidence({
    state: catalog,
    evidence,
    workCredits: [{ workId: input.work.workId, title: input.work.title, credits: input.credits }],
    allocatePersonId: (ids) => allocatePersonId(checkpoint, ids),
    now: generatedAt
  });
  checkpoint.updatedAt = generatedAt;
  checkpoint.deferredConflicts = materialized.issues;
  await writeJsonAtomic(checkpointPath, checkpoint);
  const report = {
    schemaVersion: 1,
    mode: "targeted-stable-id-supplement",
    generatedAt,
    ratePolicy: { concurrency: 1, minimumIntervalMs: args.intervalMs },
    profileBudget: input.credits.length,
    proposedPeople: evidence,
    proposedProfiles: materialized.profiles,
    proposedCredits: materialized.creditReplacements.map((set) => ({
      ...set,
      sourceWorkExternalIds: input.work.sourceWorkExternalIds
    })),
    identityIssues: materialized.issues,
    unresolved: materialized.unresolved
  };
  await writeJsonAtomic(outputPath, report);
  let reviewedReportPath = null;
  if (reviewedOutputPath && report.identityIssues.length === 0 && report.unresolved.length === 0) {
    // Promote only a clean, evidence-reviewed supplement into the publish path.
    await writeJsonAtomic(reviewedOutputPath, report);
    reviewedReportPath = reviewedOutputPath;
  }
  const credits = report.proposedCredits[0]?.credits ?? [];
  process.stdout.write(`${JSON.stringify({
    reportPath: outputPath,
    reviewedReportPath,
    workId: input.work.workId,
    proposedProfiles: report.proposedProfiles.length,
    linkedCredits: credits.filter((credit) => credit.personId).length,
    unresolved: report.unresolved.length,
    identityIssues: report.identityIssues.length
  }, null, 2)}\n`);
} finally {
  await lease.release();
  productionLock.release();
}

function parseArgs(values) {
  const result = { input: null, output: null, reviewedOutput: null, stateDir: null, backend: "azure", intervalMs: 1500 };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--input") result.input = required(values[++index], value);
    else if (value === "--output") result.output = required(values[++index], value);
    else if (value === "--reviewed-output") result.reviewedOutput = required(values[++index], value);
    else if (value === "--state-dir") result.stateDir = required(values[++index], value);
    else if (value === "--backend") result.backend = required(values[++index], value);
    else if (value === "--interval-ms") result.intervalMs = positiveInteger(values[++index], value);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.input || !result.output) throw new Error("--input and --output are required");
  if (!["local", "azure"].includes(result.backend)) throw new Error("--backend must be local or azure");
  return result;
}

function allocatePersonId(checkpoint, ids) {
  const key = ids.tmdb ? `tmdb:${ids.tmdb}` : ids.imdb ? `imdb:${ids.imdb}` : ids.wikidata ? `wikidata:${ids.wikidata}` : `douban:${ids.douban}`;
  return checkpoint.assignedPersonIds[key] ??= `person_${randomUUID()}`;
}

function required(value, option) {
  if (!value?.trim()) throw new Error(`${option} requires a value`);
  return value.trim();
}

function positiveInteger(value, option) {
  const parsed = Number(required(value, option));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer`);
  return parsed;
}

function withLegacyAliases(evidence, credit) {
  if (!evidence || !credit.legacyAliases?.length) return evidence;
  const source = credit.externalIds.wikidata ? "wikidata" : credit.externalIds.imdb ? "imdb" : "douban";
  return {
    ...evidence,
    names: [
      ...evidence.names,
      ...credit.legacyAliases.map((value) => ({
        value,
        language: "en",
        script: "Latn",
        kind: "alternate",
        source,
        status: "strong",
        sourceRef: credit.workCreditUrl ?? evidence.sourceRefs[0]?.url,
        observedAt: evidence.observedAt
      }))
    ]
  };
}
