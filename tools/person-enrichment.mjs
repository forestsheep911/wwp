import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  discoverPeopleCandidates,
  JsonEvidenceCache,
  LocalRunLease,
  readCheckpoint,
  runPersonEnrichment,
  writeJsonAtomic
} from "../apps/api/src/person-enrichment.ts";
import { TmdbPersonSource } from "../apps/api/src/person-sources/tmdb.ts";
import { createPersonCatalogStore } from "@wwpdw/cache-store";

const args = parseArgs(process.argv.slice(2));
if (args.apply) throw new Error("--apply is gated until the reviewed Notion People schema and pilot are complete.");
const root = path.resolve(args.stateDir ?? ".local-data/people");
const snapshotPath = path.resolve(args.snapshot ?? ".local-data/home-site/search-index.json");
const checkpointPath = path.join(root, "checkpoint.json");
const reportPath = path.resolve(args.output ?? path.join(root, "dry-run-report.json"));
const lease = new LocalRunLease(path.join(root, "enrichment.lock"));

await lease.acquire();
try {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const candidates = discoverPeopleCandidates(snapshot, args.workIds);
  const checkpoint = args.resume ? await readCheckpoint(checkpointPath) : await readCheckpoint(`${checkpointPath}.new-run`);
  const provider = args.offline ? undefined : new TmdbPersonSource();
  const catalogState = await createPersonCatalogStore().getState();
  const selectedWorkIds = args.personId
    ? (catalogState.creditsByPersonId[args.personId] ?? []).map((credit) => credit.workId)
    : args.workIds;
  const selectedCandidates = selectedWorkIds.length ? candidates.filter((candidate) => selectedWorkIds.includes(candidate.workId)) : candidates;
  const report = await runPersonEnrichment({
    candidates: selectedCandidates,
    provider,
    offline: args.offline,
    limit: args.limit,
    cache: new JsonEvidenceCache(path.join(root, "cache")),
    checkpoint,
    catalogState,
    persistCheckpoint: (value) => writeJsonAtomic(checkpointPath, value)
  });
  await writeJsonAtomic(reportPath, report);
  process.stdout.write(`${JSON.stringify({ reportPath, mode: report.mode, candidates: report.candidateCount, completed: report.completedWorkIds.length, remaining: report.remainingWorkIds.length, proposedPeople: report.proposedProfiles.length, linkedCredits: report.proposedCredits.reduce((count, work) => count + work.credits.filter((credit) => credit.personId).length, 0), identityIssues: report.identityIssues.length }, null, 2)}\n`);
} finally {
  await lease.release();
}

function parseArgs(values) {
  const result = { offline: false, apply: false, resume: false, limit: undefined, output: undefined, snapshot: undefined, stateDir: undefined, workIds: [], personId: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--offline") result.offline = true;
    else if (value === "--dry-run") continue;
    else if (value === "--apply") result.apply = true;
    else if (value === "--resume") result.resume = true;
    else if (value === "--limit") result.limit = positiveInteger(values[++index], "--limit");
    else if (value === "--output") result.output = required(values[++index], "--output");
    else if (value === "--snapshot") result.snapshot = required(values[++index], "--snapshot");
    else if (value === "--state-dir") result.stateDir = required(values[++index], "--state-dir");
    else if (value === "--work-id") result.workIds.push(required(values[++index], "--work-id"));
    else if (value === "--person-id") result.personId = required(values[++index], "--person-id");
    else throw new Error(`Unknown argument: ${value}`);
  }
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
