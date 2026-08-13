import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { discoverPeopleCandidates, JsonEvidenceCache, runPersonEnrichment, type EnrichmentCheckpoint } from "./person-enrichment.js";
import { ProviderHttpError } from "./person-sources/provider-http.js";

const candidate = { workId: "work-1", title: "A Film", kind: "movie" as const, tmdbId: "10", workHash: "hash-1" };

test("discovers stable TMDB candidates from the current search snapshot", () => {
  const result = discoverPeopleCandidates({ entries: {
    a: { result: { metadata: { work: { workId: "work-1", kind: "movie", externalIds: { tmdb: "10" }, display: { title: "A Film" }, updatedAt: "2026-01-01" } } } },
    b: { result: { metadata: { work: { workId: "work-2", kind: "series", externalIds: {}, display: { title: "No TMDB" } } } } }
  } });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "A Film");
  assert.match(result[0].workHash, /^[a-f0-9]{64}$/);
});

test("offline mode makes no provider request and exposes remaining work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "people-cache-"));
  const report = await runPersonEnrichment({
    candidates: [candidate],
    offline: true,
    cache: new JsonEvidenceCache(root),
    checkpoint: { schemaVersion: 1, updatedAt: "2026-01-01", completed: {}, failures: [], assignedPersonIds: {}, deferredConflicts: [] }
  });
  assert.deepEqual(report.remainingWorkIds, ["work-1"]);
  assert.equal(report.unresolved[0].reason, "network_disabled");
});

test("a repeated dry run reuses cache and checkpoint without provider calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "people-cache-"));
  let calls = 0;
  const provider = {
    async fetchWorkCredits() {
      calls += 1;
      return { workExternalId: "10", workKind: "movie" as const, credits: [{ name: "Actor", department: "acting" as const, externalIds: { tmdb: "20" } }], observedAt: "2026-01-01" };
    },
    async fetchPersonEvidence() {
      calls += 1;
      return { externalIds: { tmdb: "20" }, names: [], sourceRefs: [], observedAt: "2026-01-01" };
    }
  };
  const checkpoint: EnrichmentCheckpoint = { schemaVersion: 1, updatedAt: "2026-01-01", completed: {}, failures: [], assignedPersonIds: {}, deferredConflicts: [] };
  const cache = new JsonEvidenceCache(root);
  await runPersonEnrichment({ candidates: [candidate], provider, cache, checkpoint });
  assert.equal(calls, 2);
  await runPersonEnrichment({ candidates: [candidate], provider, cache, checkpoint });
  assert.equal(calls, 2);
});

test("stops after three consecutive 429 responses and records the retry boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "people-cache-"));
  const candidates = [1, 2, 3, 4].map((value) => ({ ...candidate, workId: `work-${value}`, tmdbId: String(value), workHash: `hash-${value}` }));
  let calls = 0;
  const checkpoint: EnrichmentCheckpoint = { schemaVersion: 1, updatedAt: "2026-01-01", completed: {}, failures: [], assignedPersonIds: {}, deferredConflicts: [] };
  const report = await runPersonEnrichment({
    candidates,
    provider: {
      async fetchWorkCredits() { calls += 1; throw new ProviderHttpError("rate limited", 429, 2_000); },
      async fetchPersonEvidence() { throw new Error("unexpected"); }
    },
    cache: new JsonEvidenceCache(root),
    checkpoint,
    now: () => new Date("2026-08-10T00:00:00.000Z")
  });
  assert.equal(calls, 3);
  assert.equal(report.failures.length, 3);
  assert.deepEqual(report.remainingWorkIds, ["work-1", "work-2", "work-3", "work-4"]);
  assert.equal(checkpoint.nextRetryAt, "2026-08-10T00:00:02.000Z");
});
