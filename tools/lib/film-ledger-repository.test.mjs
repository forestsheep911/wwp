import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger } from "./film-ledger-schema.mjs";
import { createLedgerRepository } from "./film-ledger-repository.mjs";

function fixture(now = "2026-07-12T00:00:00.000Z") {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-repo-"));
  const db = openLedger(path.join(dir, "ledger.sqlite"));
  return {
    db,
    repo: createLedgerRepository(db, { now: () => now }),
    close() { db.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

function seed(repo, suffix = "") {
  const root = repo.upsertInputRoot(`X:\\queue${suffix}`);
  const work = repo.ensureWork({ canonicalTitle: `Example${suffix}`, year: 2025, workType: "movie" });
  const source = repo.upsertDiscoveredSource({ inputRootId: root.id, workId: work.id, relativePath: `Example${suffix}`, absolutePath: `X:\\queue\\Example${suffix}`, fingerprint: `v1${suffix}`, sourceKind: "folder" });
  const variant = repo.ensureVariant({ workId: work.id, sourceId: source.id, specKey: `main${suffix}`, displayTitle: `Example${suffix} 国配简 1.4GB` });
  return { root, work, source, variant };
}

test("idempotent upserts preserve identities and update mutable evidence", () => {
  const f = fixture();
  try {
    const a = seed(f.repo);
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Example", year: 2025, workType: "movie", priorityScore: 7 });
    const source = f.repo.upsertDiscoveredSource({ inputRootId: root.id, workId: work.id, relativePath: "Example", absolutePath: "X:\\queue\\Renamed", fingerprint: "v2", sourceKind: "folder", subtitleEvidence: { chs: true } });
    const variant = f.repo.ensureVariant({ workId: work.id, sourceId: source.id, specKey: "main", displayTitle: "Updated", targetSizeBytes: 100 });
    assert.equal(root.id, a.root.id);
    assert.equal(work.id, a.work.id);
    assert.equal(source.id, a.source.id);
    assert.equal(variant.id, a.variant.id);
    assert.equal(source.absolute_path, "X:\\queue\\Renamed");
    assert.equal(source.subtitle_evidence, '{"chs":true}');
    assert.equal(variant.display_title, "Updated");
    assert.equal(f.db.prepare("SELECT count(*) count FROM variants").get().count, 1);
  } finally { f.close(); }
});

test("null-year works and renamed sources remain idempotent", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const firstWork = f.repo.ensureWork({ canonicalTitle: "Unknown Year", workType: "movie" });
    const secondWork = f.repo.ensureWork({ canonicalTitle: "Unknown Year", workType: "movie" });
    assert.equal(secondWork.id, firstWork.id);
    const first = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "old", absolutePath: "X:\\queue\\old", fingerprint: "same", sourceKind: "folder" });
    const renamed = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "new", absolutePath: "X:\\queue\\new", fingerprint: "same", sourceKind: "folder" });
    assert.equal(renamed.id, first.id);
    assert.equal(renamed.relative_path, "new");
    assert.equal(f.db.prepare("SELECT count(*) count FROM works").get().count, 1);
    assert.equal(f.db.prepare("SELECT count(*) count FROM sources").get().count, 1);
  } finally { f.close(); }
});

test("source reconciliation lists one root and can mark missing then reopen", () => {
  const f = fixture();
  try {
    const firstRoot = f.repo.upsertInputRoot("X:\\queue-a");
    const secondRoot = f.repo.upsertInputRoot("X:\\queue-b");
    const first = f.repo.upsertDiscoveredSource({ inputRootId: firstRoot.id, relativePath: "first", absolutePath: "X:\\queue-a\\first", fingerprint: "first", sourceKind: "folder" });
    const second = f.repo.upsertDiscoveredSource({ inputRootId: firstRoot.id, relativePath: "second", absolutePath: "X:\\queue-a\\second", fingerprint: "second", sourceKind: "folder" });
    f.repo.upsertDiscoveredSource({ inputRootId: secondRoot.id, relativePath: "other", absolutePath: "X:\\queue-b\\other", fingerprint: "other", sourceKind: "folder" });

    assert.deepEqual(f.repo.listSourcesForRoot(firstRoot.id).map(source => source.id), [first.id, second.id]);
    assert.equal(f.repo.markSourceMissing(first.id).missing, 1);
    assert.equal(f.repo.listSourcesForRoot(firstRoot.id)[0].missing, 1);
    assert.equal(f.repo.markSourceMissing(first.id, false).missing, 0);
    assert.equal(f.repo.listSourcesForRoot(firstRoot.id)[0].missing, 0);
  } finally { f.close(); }
});

test("qc-passed work leaves production and remains due for publication", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo);
    for (const state of ["evaluated", "selected", "encoding"]) f.repo.transitionProduction(variant.id, state);
    f.repo.transitionProduction(variant.id, "qc_passed", { outputSizeBytes: 1_394_073_253, outputPath: "E:\\video_made\\Example.mp4" });
    f.repo.transitionPublication(variant.id, "structure_pending");
    assert.deepEqual(f.repo.listProductionCandidates({ limit: 5 }), []);
    assert.equal(f.repo.listPublicationCandidates({ limit: 3 })[0].id, variant.id);
    const events = f.repo.getEvents({ entityType: "variant", entityId: variant.id });
    assert.equal(events.at(-1).event_type, "publication_state_changed");
    assert.equal(events.at(-1).payload_json, '{"from":"not_ready","to":"structure_pending"}');
    assert.throws(() => f.repo.transitionProduction(variant.id, "selected"), /illegal production transition/);
  } finally { f.close(); }
});

test("candidate queries honor due dates, exclusions, priority, and bounds", () => {
  const f = fixture();
  try {
    const low = seed(f.repo, "Low");
    const high = seed(f.repo, "High");
    f.db.prepare("UPDATE works SET priority_score = ? WHERE id = ?").run(9, high.work.id);
    f.db.prepare("UPDATE variants SET next_review_at = ? WHERE id = ?").run("2026-07-13T00:00:00.000Z", low.variant.id);
    assert.deepEqual(f.repo.listProductionCandidates({ limit: 99 }).map(x => x.id), [high.variant.id]);
    f.db.prepare("UPDATE variants SET next_review_at = NULL WHERE id = ?").run(low.variant.id);
    assert.deepEqual(f.repo.listProductionCandidates({ limit: 1 }).map(x => x.id), [high.variant.id]);
  } finally { f.close(); }
});

test("Notion target upsert preserves verified timestamps and publication due dates", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo);
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) f.repo.transitionProduction(variant.id, state);
    f.repo.registerNotionTarget(variant.id, { workPageId: "w", specPageId: "s", structureVerifiedAt: "2026-07-11T00:00:00.000Z", nextCheckAt: "2026-07-13T00:00:00.000Z" });
    f.repo.registerNotionTarget(variant.id, { workPageId: "w2", specPageId: "s2" });
    const target = f.db.prepare("SELECT * FROM notion_targets WHERE variant_id = ?").get(variant.id);
    assert.equal(target.work_page_id, "w2");
    assert.equal(target.structure_verified_at, "2026-07-11T00:00:00.000Z");
    assert.deepEqual(f.repo.listPublicationCandidates({ limit: 3 }), []);
    f.repo.registerNotionTarget(variant.id, { workPageId: "w2", specPageId: "s2", nextCheckAt: "2026-07-11T00:00:00.000Z" });
    assert.equal(f.repo.listPublicationCandidates({ limit: 3 })[0].id, variant.id);
  } finally { f.close(); }
});

test("status summary reports production and publication states", () => {
  const f = fixture();
  try {
    seed(f.repo);
    assert.deepEqual(f.repo.getStatusSummary(), { production: { discovered: 1 }, publication: { not_ready: 1 }, totals: { variants: 1, syncReady: 0 } });
  } finally { f.close(); }
});
