import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MovieCreditEntry, PersonCatalogIssue, PersonCatalogState, PersonProfile } from "@wwpdw/shared";
import { emptyPersonCatalogState } from "@wwpdw/cache-store";
import { materializePersonEvidence } from "./person-materialization.js";
import { ProviderHttpError } from "./person-sources/provider-http.js";
import type { PersonEvidence, WorkCreditEvidence } from "./person-sources/types.js";

export const evidenceSchemaVersion = 1;

export interface EnrichmentWorkCandidate {
  workId: string;
  title: string;
  kind: "movie" | "series";
  tmdbId: string;
  workHash: string;
}

export interface PersonEnrichmentProvider {
  fetchWorkCredits(input: { tmdbId: string; kind: "movie" | "series" }): Promise<WorkCreditEvidence>;
  fetchPersonEvidence(tmdbId: string): Promise<PersonEvidence>;
}

export interface EnrichmentCheckpoint {
  schemaVersion: 1;
  updatedAt: string;
  completed: Record<string, string>;
  failures: Array<{ workId: string; message: string; retryAfter?: string }>;
  assignedPersonIds: Record<string, string>;
  cursor?: { lastWorkId: string; processed: number };
  deferredConflicts: PersonCatalogIssue[];
  nextRetryAt?: string;
}

export interface PersonEnrichmentReport {
  schemaVersion: 1;
  mode: "offline" | "network-dry-run";
  generatedAt: string;
  candidateCount: number;
  completedWorkIds: string[];
  cachedWorkIds: string[];
  proposedPeople: PersonEvidence[];
  proposedProfiles: PersonProfile[];
  proposedCredits: Array<{ workId: string; title: string; credits: MovieCreditEntry[] }>;
  identityIssues: PersonCatalogIssue[];
  unresolved: Array<{ workId?: string; creditName?: string; reason: string }>;
  failures: EnrichmentCheckpoint["failures"];
  remainingWorkIds: string[];
  estimatedNotionWrites: number;
}

export class JsonEvidenceCache {
  constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {}

  async get<T>(provider: string, endpoint: string, id: string, language: string, maxAgeMs: number) {
    const filePath = this.pathFor(provider, endpoint, id, language);
    try {
      const info = await stat(filePath);
      if (this.now().getTime() - info.mtimeMs > maxAgeMs) return undefined;
      const value = JSON.parse(await readFile(filePath, "utf8")) as { schemaVersion?: number; value?: T };
      return value.schemaVersion === evidenceSchemaVersion ? value.value : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async put<T>(provider: string, endpoint: string, id: string, language: string, value: T) {
    const filePath = this.pathFor(provider, endpoint, id, language);
    await atomicJsonWrite(filePath, { schemaVersion: evidenceSchemaVersion, cachedAt: this.now().toISOString(), value });
  }

  private pathFor(provider: string, endpoint: string, id: string, language: string) {
    return path.join(this.root, safe(provider), safe(endpoint), `${safe(id)}.${safe(language)}.v${evidenceSchemaVersion}.json`);
  }
}

export class LocalRunLease {
  private handle?: Awaited<ReturnType<typeof open>>;

  constructor(private readonly leasePath: string) {}

  async acquire() {
    await mkdir(path.dirname(this.leasePath), { recursive: true });
    try {
      this.handle = await open(this.leasePath, "wx");
      await this.handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`People enrichment lease is already held: ${this.leasePath}`);
      }
      throw error;
    }
  }

  async release() {
    await this.handle?.close();
    this.handle = undefined;
    await rm(this.leasePath, { force: true });
  }
}

export function discoverPeopleCandidates(snapshot: unknown, workIds: string[] = []) {
  const selected = new Set(workIds);
  const root = snapshot as { entries?: Record<string, { result?: { metadata?: { work?: unknown } } }> };
  const candidates: EnrichmentWorkCandidate[] = [];
  for (const entry of Object.values(root.entries ?? {})) {
    const work = entry.result?.metadata?.work as {
      workId?: string;
      kind?: string;
      externalIds?: { tmdb?: string };
      display?: { title?: string };
      titles?: Array<{ title?: string }>;
      updatedAt?: string;
    } | undefined;
    const workId = work?.workId?.trim();
    const tmdbId = work?.externalIds?.tmdb?.trim();
    if (!workId || !tmdbId || (selected.size > 0 && !selected.has(workId))) continue;
    const title = work?.display?.title ?? work?.titles?.[0]?.title ?? workId;
    const kind = work?.kind === "series" ? "series" : "movie";
    candidates.push({ workId, title, kind, tmdbId, workHash: hash({ workId, tmdbId, kind, updatedAt: work?.updatedAt }) });
  }
  return candidates.sort((left, right) => left.workId.localeCompare(right.workId));
}

export async function runPersonEnrichment(input: {
  candidates: EnrichmentWorkCandidate[];
  provider?: PersonEnrichmentProvider;
  cache: JsonEvidenceCache;
  checkpoint: EnrichmentCheckpoint;
  offline?: boolean;
  limit?: number;
  now?: () => Date;
  persistCheckpoint?: (checkpoint: EnrichmentCheckpoint) => Promise<void>;
  catalogState?: PersonCatalogState;
  allocatePersonId?: (externalIds: { tmdb?: string; imdb?: string; wikidata?: string }) => string;
}) {
  const now = input.now ?? (() => new Date());
  const candidates = input.candidates.slice(0, input.limit ?? input.candidates.length);
  const report: PersonEnrichmentReport = {
    schemaVersion: 1,
    mode: input.offline ? "offline" : "network-dry-run",
    generatedAt: now().toISOString(),
    candidateCount: candidates.length,
    completedWorkIds: [],
    cachedWorkIds: [],
    proposedPeople: [],
    proposedProfiles: [],
    proposedCredits: [],
    identityIssues: [],
    unresolved: [],
    failures: [],
    remainingWorkIds: [],
    estimatedNotionWrites: 0
  };
  if (input.offline) {
    report.remainingWorkIds = candidates.map((candidate) => candidate.workId);
    report.unresolved = candidates.map((candidate) => ({ workId: candidate.workId, reason: "network_disabled" }));
    return report;
  }
  if (!input.provider) throw new Error("A provider is required unless --offline is used.");

  let consecutive429 = 0;
  for (const candidate of candidates) {
    if (input.checkpoint.completed[candidate.workId] === candidate.workHash) {
      report.completedWorkIds.push(candidate.workId);
      continue;
    }
    try {
      const cacheKey = `${candidate.kind}-${candidate.tmdbId}`;
      let workEvidence = await input.cache.get<WorkCreditEvidence>("tmdb", "credits", cacheKey, "en-US", 30 * 86_400_000);
      if (workEvidence) report.cachedWorkIds.push(candidate.workId);
      else {
        workEvidence = await input.provider.fetchWorkCredits({ tmdbId: candidate.tmdbId, kind: candidate.kind });
        await input.cache.put("tmdb", "credits", cacheKey, "en-US", workEvidence);
      }
      const people = new Map<string, PersonEvidence>();
      for (const credit of workEvidence.credits) {
        const tmdbPersonId = credit.externalIds?.tmdb;
        if (!tmdbPersonId || people.has(tmdbPersonId)) continue;
        let evidence = await input.cache.get<PersonEvidence>("tmdb", "person", tmdbPersonId, "en-US", 30 * 86_400_000);
        if (!evidence) {
          evidence = await input.provider.fetchPersonEvidence(tmdbPersonId);
          await input.cache.put("tmdb", "person", tmdbPersonId, "en-US", evidence);
        }
        people.set(tmdbPersonId, evidence);
      }
      report.proposedCredits.push({ workId: candidate.workId, title: candidate.title, credits: workEvidence.credits });
      report.proposedPeople.push(...people.values());
      input.checkpoint.completed[candidate.workId] = candidate.workHash;
      input.checkpoint.cursor = { lastWorkId: candidate.workId, processed: Object.keys(input.checkpoint.completed).length };
      input.checkpoint.nextRetryAt = undefined;
      input.checkpoint.updatedAt = now().toISOString();
      await input.persistCheckpoint?.(input.checkpoint);
      report.completedWorkIds.push(candidate.workId);
      consecutive429 = 0;
    } catch (error) {
      const retryAfter = error instanceof ProviderHttpError && error.retryAfterMs
        ? new Date(now().getTime() + error.retryAfterMs).toISOString()
        : undefined;
      const failure = { workId: candidate.workId, message: error instanceof Error ? error.message : String(error), ...(retryAfter ? { retryAfter } : {}) };
      report.failures.push(failure);
      input.checkpoint.failures.push(failure);
      if (retryAfter) input.checkpoint.nextRetryAt = retryAfter;
      if (error instanceof ProviderHttpError && error.status === 429) consecutive429 += 1;
      else consecutive429 = 0;
      if (consecutive429 >= 3) break;
    }
  }
  const done = new Set(report.completedWorkIds);
  report.remainingWorkIds = candidates.filter((candidate) => !done.has(candidate.workId)).map((candidate) => candidate.workId);
  report.proposedPeople = uniquePeople(report.proposedPeople);
  const materialized = materializePersonEvidence({
    state: input.catalogState ?? emptyPersonCatalogState(report.generatedAt),
    evidence: report.proposedPeople,
    workCredits: report.proposedCredits,
    allocatePersonId: input.allocatePersonId ?? ((externalIds) => checkpointPersonId(input.checkpoint, externalIds)),
    now: report.generatedAt
  });
  report.proposedProfiles = materialized.profiles;
  report.proposedCredits = materialized.creditReplacements;
  report.identityIssues = materialized.issues;
  input.checkpoint.deferredConflicts = materialized.issues;
  report.unresolved.push(...materialized.unresolved.map((issue) => ({
    ...(issue.workId ? { workId: issue.workId } : {}),
    ...(issue.creditName ? { creditName: issue.creditName } : {}),
    reason: issue.reason
  })));
  report.estimatedNotionWrites = report.proposedProfiles.length;
  input.checkpoint.updatedAt = now().toISOString();
  await input.persistCheckpoint?.(input.checkpoint);
  return report;
}

export async function readCheckpoint(filePath: string, now = new Date().toISOString()): Promise<EnrichmentCheckpoint> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as EnrichmentCheckpoint;
    if (value.schemaVersion !== 1) throw new Error(`Unsupported checkpoint schema: ${value.schemaVersion}`);
    value.assignedPersonIds ??= {};
    value.deferredConflicts ??= [];
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, updatedAt: now, completed: {}, failures: [], assignedPersonIds: {}, deferredConflicts: [] };
    throw error;
  }
}

export function writeJsonAtomic(filePath: string, value: unknown) {
  return atomicJsonWrite(filePath, value);
}

async function atomicJsonWrite(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function uniquePeople(values: PersonEvidence[]) {
  const result = new Map<string, PersonEvidence>();
  for (const value of values) {
    const key = value.externalIds.tmdb ?? value.externalIds.imdb ?? value.externalIds.wikidata;
    if (key) result.set(key, value);
  }
  return [...result.values()];
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function checkpointPersonId(checkpoint: EnrichmentCheckpoint, externalIds: { tmdb?: string; imdb?: string; wikidata?: string }) {
  const stableKey = externalIds.tmdb ? `tmdb:${externalIds.tmdb}`
    : externalIds.imdb ? `imdb:${externalIds.imdb}`
      : `wikidata:${externalIds.wikidata ?? "unknown"}`;
  return checkpoint.assignedPersonIds[stableKey] ??= `person_${randomUUID()}`;
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
