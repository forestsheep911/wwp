import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = path.resolve("tools/film-ledger.mjs");
function run(args, cwd, env = {}) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }); }

test("CLI initializes and reports a clean JSON status", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    assert.equal(run(["--db", db, "init"], dir).status, 0);
    const result = run(["--db", db, "status", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      production: {}, publication: {}, handoff: {}, totals: { variants: 0, syncReady: 0 },
      workflowTasks: {}, queues: { collaboration: 0, intake: 0, metadata: 0, production: 0, publication: 0 }
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI discovery imports scan JSON and rejects invalid contracts", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const scan = path.join(dir, "scan.json");
    writeFileSync(scan, JSON.stringify({ root: "X:\\queue", scannedAt: "2026-07-12T00:00:00.000Z", entries: [] }));
    assert.equal(run(["--db", db, "discover", "--scan", scan, "--json"], dir).status, 0);
    const bad = run(["--db", db, "next", "--stage", "other"], dir);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /production\|publication/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI exposes intake and metadata queues separately from playable publication", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-work-queues-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const scan = path.join(dir, "scan.json");
    writeFileSync(scan, JSON.stringify({ root: "X:\\queue", scannedAt: "2026-07-20T00:00:00.000Z", entries: [{
      name: "New Film", relativePath: "New Film", fileCount: 1, mediaCount: 1, subtitleCount: 1,
      nfoCount: 0, totalBytes: 100, largestMedia: [], flags: {}
    }] }));
    assert.equal(run(["--db", dbPath, "discover", "--scan", scan, "--json"], dir).status, 0);
    const intake = JSON.parse(run(["--db", dbPath, "queue", "--stage", "intake", "--json"], dir).stdout);
    assert.equal(intake.length, 1);
    assert.equal(intake[0].task_type, "intake");
    assert.equal(intake[0].relative_path, "New Film");

    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "New Film", year: 2025, workType: "movie", priorityScore: 80 });
    db.close();

    const metadata = JSON.parse(run(["--db", dbPath, "queue", "--stage", "metadata", "--json"], dir).stdout);
    assert.equal(metadata.length, 1);
    assert.equal(metadata[0].task_type, "metadata_backfill");
    assert.equal(metadata[0].work_id, work.id);
    const completed = run(["--db", dbPath, "complete-task", "--task", String(metadata[0].id), "--failure-detail", "backfill completed", "--json"], dir);
    assert.equal(completed.status, 0, completed.stderr);
    assert.deepEqual(JSON.parse(run(["--db", dbPath, "queue", "--stage", "metadata", "--json"], dir).stdout), []);
    const scheduled = run(["--db", dbPath, "schedule-metadata", "--work-id", String(work.id), "--failure-detail", "refresh stale ratings", "--json"], dir);
    assert.equal(scheduled.status, 0, scheduled.stderr);
    assert.equal(JSON.parse(scheduled.stdout).status, "pending");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI exposes and advances the bounded collaboration handoff queue", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-handoff-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Handoff", year: 2025, workType: "movie" });
    repo.recordWorkHandoff(work.id, { status: "已上传待 AI 收尾", actor: "human" });
    db.close();

    const queued = run(["--db", dbPath, "queue", "--stage", "handoff", "--limit", "3", "--json"], dir);
    assert.equal(queued.status, 0, queued.stderr);
    assert.equal(JSON.parse(queued.stdout)[0].workflow_status, "已上传待 AI 收尾");

    const claimed = run([
      "--db", dbPath, "set-handoff", "--work-id", String(work.id),
      "--status", "AI 处理中", "--actor", "ai", "--json"
    ], dir);
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.equal(JSON.parse(claimed.stdout).row.workflow_status, "AI 处理中");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cycle reports catalog maintenance as an independent lane and refreshes due work", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-cycle-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Old Catalog Work", year: 2020, workType: "movie", nextReviewAt: "2020-01-01T00:00:00.000Z" });
    repo.transitionWorkflowTask(repo.listWorkflowTasks({ taskType: "metadata_backfill", limit: 1 })[0].id, "done");
    db.close();

    const result = run(["--db", dbPath, "cycle", "--limit", "3", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.lanes.catalogMaintenance.length, 1);
    assert.equal(payload.lanes.catalogMaintenance[0].work_id, work.id);
    assert.deepEqual(payload.refreshedIntakeTasks, []);
    assert.deepEqual(payload.refreshedMetadataTasks.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI records source probe and media evidence after intake routing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-source-evidence-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const scan = path.join(dir, "scan.json");
    writeFileSync(scan, JSON.stringify({ root: "X:\\queue", scannedAt: "2026-07-20T00:00:00.000Z", entries: [{
      name: "Evidence", relativePath: "Evidence", fileCount: 1, mediaCount: 1, subtitleCount: 0,
      nfoCount: 0, totalBytes: 100, largestMedia: [], flags: {}
    }] }));
    assert.equal(run(["--db", db, "discover", "--scan", scan, "--json"], dir).status, 0);
    const routed = run(["--db", db, "route-intake", "--source-id", "1", "--canonical-title", "Evidence", "--year", "2025", "--json"], dir);
    assert.equal(routed.status, 0, routed.stderr);
    const updated = run(["--db", db, "update-source", "--source-id", "1", "--probe-path", ".local-data/probe.json",
      "--quality-state", "4k_hevc", "--subtitle-evidence", '{"bakedChinese":true}', "--audio-evidence", '{"tracks":["mandarin"]}',
      "--color-risk", "none", "--json"], dir);
    assert.equal(updated.status, 0, updated.stderr);
    const source = JSON.parse(updated.stdout);
    assert.equal(source.probe_path, ".local-data/probe.json");
    assert.equal(source.quality_state, "4k_hevc");
    assert.equal(source.subtitle_evidence, '{"bakedChinese":true}');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI attaches a legacy variant to a verified source", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-attach-source-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const root = repo.upsertInputRoot("X:\\queue");
    const work = repo.ensureWork({ canonicalTitle: "Legacy", year: 2025, workType: "movie" });
    const source = repo.upsertDiscoveredSource({
      inputRootId: root.id,
      workId: work.id,
      relativePath: "Legacy",
      absolutePath: "X:\\queue\\Legacy",
      fingerprint: "legacy",
      sourceKind: "folder"
    });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "legacy", displayTitle: "Legacy output" });
    db.close();

    const result = run([
      "--db", dbPath, "attach-variant-source", "--variant", String(variant.id),
      "--source-id", String(source.id), "--failure-detail", "verified source", "--json"
    ], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).source_id, source.id);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI splits a collection source into identified member sources", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-source-split-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const scan = path.join(dir, "scan.json");
    const members = path.join(dir, "members.json");
    writeFileSync(scan, JSON.stringify({ root: "X:\\queue", scannedAt: "2026-07-20T00:00:00.000Z", entries: [{
      name: "Collection", relativePath: "Collection", fileCount: 2, mediaCount: 2, subtitleCount: 0,
      nfoCount: 0, totalBytes: 100, largestMedia: [], flags: {}
    }] }));
    assert.equal(run(["--db", db, "discover", "--scan", scan, "--json"], dir).status, 0);
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const liveDb = openLedger(db);
    const repo = createLedgerRepository(liveDb);
    const work = repo.ensureWork({ canonicalTitle: "Member", year: 2025, workType: "movie" });
    liveDb.close();
    writeFileSync(members, JSON.stringify([{ relativePath: "Collection\\Member.iso", absolutePath: "X:\\queue\\Collection\\Member.iso", fingerprint: "member", workId: work.id }]));
    const result = run(["--db", db, "split-source", "--source-id", "1", "--members", members, "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.members.length, 1);
    assert.equal(payload.parentTask.status, "done");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI supports the default database and emits clean JSON", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-default-"));
  try {
    const init = run(["init", "--json"], dir);
    assert.equal(init.status, 0, init.stderr);
    assert.deepEqual(Object.keys(JSON.parse(init.stdout)).sort(), ["database", "initialized"]);
    assert.equal(existsSync(path.join(dir, ".local-data", "wwp-film-workflow.sqlite")), true);
    assert.equal(init.stdout.trim().split("\n").length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI migrate-local-data accepts repeated baselines and an explicit corrections manifest", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-migrate-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const queueA = path.join(dir, "queue-a.json");
    const queueB = path.join(dir, "queue-b.json");
    const report = path.join(dir, "report.json");
    const corrections = path.join(dir, "corrections.json");
    const baseline = (root, name) => ({ root, scannedAt: "2026-07-12T00:00:00.000Z", entries: [{ name, relativePath: name,
      fileCount: 1, mediaCount: 1, subtitleCount: 0, nfoCount: 0, totalBytes: 1, largestMedia: [], flags: {} }] });
    writeFileSync(queueA, JSON.stringify(baseline("X:\\queue", "One")));
    writeFileSync(queueB, JSON.stringify(baseline("Y:\\queue", "Two")));
    writeFileSync(report, JSON.stringify({ pages: [] }));
    writeFileSync(corrections, JSON.stringify({ variants: [] }));
    const result = run(["--db", db, "migrate-local-data", "--queue-state", queueA, "--queue-state", queueB,
      "--organizer-report", report, "--corrections", corrections, "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { queueStates: 2, organizerReports: 1, corrections: 0, sources: { inserted: 2, unchanged: 0, changed: 0, missing: 0 }, targetsRegistered: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI imports a completed production manifest into a qc-passed Notion-targeted variant idempotently", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-production-manifest-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const manifest = path.join(dir, "production.json");
    writeFileSync(manifest, JSON.stringify({
      work: "Example Film (2025)",
      output: "E:\\video_made\\Example.Film.2025.1080p.h265.eng.chs.4.50GB.mp4",
      outputBytes: 4500000000,
      outputSpec: "简 H.265 4.50GB",
      targetSpecPageId: "spec-page",
      workPageId: "work-page",
      evidence: { probe: ".local-data/example-final-ffprobe.json", sampleFrame: ".local-data/example-sample.jpg" },
      publicationState: "manual_upload_pending"
    }));

    const first = run(["--db", db, "import-production-manifest", "--production-manifest", manifest, "--json"], dir);
    assert.equal(first.status, 0, first.stderr);
    const imported = JSON.parse(first.stdout);
    assert.equal(imported.status, "imported");
    assert.equal(imported.variant.production_state, "qc_passed");
    assert.equal(imported.variant.output_path, "e:\\video_made\\example.film.2025.1080p.h265.eng.chs.4.50gb.mp4");
    assert.equal(imported.target.work_page_id, "work-page");
    assert.equal(imported.target.spec_page_id, "spec-page");

    const second = run(["--db", db, "import-production-manifest", "--production-manifest", manifest, "--json"], dir);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).status, "already_imported");

    const next = run(["--db", db, "next", "--stage", "production", "--json"], dir);
    assert.equal(next.status, 0, next.stderr);
    assert.deepEqual(JSON.parse(next.stdout), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI imports only the bounded newest production manifests per target", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-production-manifests-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const writeManifest = (name, output, spec) => writeFileSync(path.join(dir, name), JSON.stringify({
      work: "Bounded Film (2025)", output, outputBytes: 100, outputSpec: spec,
      targetSpecPageId: "spec-page", workPageId: "work-page"
    }));
    writeManifest("old-production.json", "E:\\old.mp4", "旧 1GB");
    writeManifest("new-production.json", "E:\\new.mp4", "新 1GB");
    const now = Date.now() / 1000;
    utimesSync(path.join(dir, "old-production.json"), now - 10, now - 10);
    utimesSync(path.join(dir, "new-production.json"), now, now);
    const result = run(["--db", db, "import-production-manifests", "--manifest-dir", dir, "--limit", "1", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.scanned, 1);
    assert.equal(payload.results[0].fileName, "new-production.json");
    assert.equal(payload.results[0].variant.output_path, "e:\\new.mp4");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI dry-run does not import production manifests", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-production-dry-run-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const manifest = path.join(dir, "production.json");
    writeFileSync(manifest, JSON.stringify({
      work: "Dry Run (2025)", output: "E:\\dry-run.mp4", outputBytes: 100,
      outputSpec: "简英 1GB", targetSpecPageId: "spec", workPageId: "work"
    }));
    const result = run(["--db", db, "import-production-manifests", "--manifest-dir", dir, "--dry-run", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).results[0].status, "would_import");
    const status = JSON.parse(run(["--db", db, "status", "--json"], dir).stdout);
    assert.equal(status.totals.variants, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI adopts a QC-verified local output into an existing migrated target but clears unverified media-block evidence", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-adopt-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Legacy", year: null, workType: "movie" });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "legacy-main", displayTitle: "Legacy main" });
    repo.registerNotionTarget(variant.id, { workPageId: "work", specPageId: "spec", mediaBlockId: "media-block" });
    db.close();

    const result = run(["--db", dbPath, "adopt-existing-variant", "--variant", String(variant.id), "--year", "2025", "--output-path", "E:\\video_made\\Legacy.mp4", "--output-size", "1000", "--probe-path", "probe.json", "--qc-artifact", "qc.jpg", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    const adopted = JSON.parse(result.stdout);
    assert.equal(adopted.variant.production_state, "qc_passed");
    assert.equal(adopted.variant.publication_state, "structure_pending");
    assert.equal(adopted.target.media_block_id, null);
    assert.equal(adopted.variant.output_path, "e:\\video_made\\legacy.mp4");
    assert.equal(adopted.variant.year, 2025);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI handoff lists only QC-passed target pages still awaiting their expected upload", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-handoff-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Handoff", year: 2025, workType: "movie" });
    const waiting = repo.ensureVariant({ workId: work.id, specKey: "waiting", displayTitle: "Handoff 简", outputPath: "E:\\video_made\\Handoff.mp4" });
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) repo.transitionProduction(waiting.id, state);
    repo.transitionPublication(waiting.id, "structure_pending");
    repo.registerNotionTarget(waiting.id, { workPageId: "work", specPageId: "spec", expectedFilename: "Handoff.mp4" });
    const complete = repo.ensureVariant({ workId: work.id, specKey: "complete", displayTitle: "Complete", outputPath: "E:\\video_made\\Complete.mp4" });
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) repo.transitionProduction(complete.id, state);
    repo.transitionPublication(complete.id, "structure_pending");
    repo.registerNotionTarget(complete.id, { workPageId: "complete-work", specPageId: "complete-spec" });
    repo.recordNotionInspection(complete.id, { structureVerified: true, mediaVerified: true, mediaBlockId: "media", assetsVerified: true, mediaAssetPageId: "asset" });
    repo.transitionPublication(complete.id, "upload_pending");
    repo.transitionPublication(complete.id, "upload_seen");
    repo.transitionPublication(complete.id, "assets_pending");
    repo.transitionPublication(complete.id, "verification_pending");
    repo.transitionPublication(complete.id, "sync_ready");
    db.close();

    const result = run(["--db", dbPath, "handoff", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{
      variantId: waiting.id,
      workTitle: "Handoff",
      year: 2025,
      specTitle: "Handoff 简",
      outputPath: "e:\\video_made\\handoff.mp4",
      outputSizeBytes: null,
      workPageId: "work",
      specPageId: "spec",
      episodePageId: null,
      expectedFilename: "Handoff.mp4",
      publicationState: "structure_pending"
    }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI next, show, record-qc, and register-target cover the ledger workflow", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-workflow-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Example", year: 2025, workType: "movie" });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Example" });
    repo.transitionProduction(variant.id, "evaluated");
    repo.transitionProduction(variant.id, "selected");
    repo.transitionProduction(variant.id, "encoding");
    db.close();

    const next = run(["--db", dbPath, "next", "--stage", "production", "--limit", "1", "--json"], dir);
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout)[0].id, variant.id);

    const prepared = run(["--db", dbPath, "register-target", "--variant", String(variant.id), "--work-page", "work", "--spec-page", "spec", "--episode-page", "episode", "--json"], dir);
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(JSON.parse(prepared.stdout).spec_page_id, "spec");

    const qc = run(["--db", dbPath, "record-qc", "--variant", String(variant.id), "--pass", "--output-path", "out.mp4", "--output-size", "1000", "--json"], dir);
    assert.equal(qc.status, 0, qc.stderr);
    assert.equal(JSON.parse(qc.stdout).production_state, "qc_passed");
    assert.equal(JSON.parse(qc.stdout).publication_state, "structure_pending");

    const target = run(["--db", dbPath, "register-target", "--variant", String(variant.id), "--work-page", "work", "--spec-page", "spec", "--episode-page", "episode", "--json"], dir);
    assert.equal(target.status, 0, target.stderr);
    assert.equal(JSON.parse(target.stdout).episode_page_id, "episode");

    const show = run(["--db", dbPath, "show", "--variant", String(variant.id), "--json"], dir);
    assert.equal(show.status, 0, show.stderr);
    const shown = JSON.parse(show.stdout);
    assert.equal(shown.variant.publication_state, "structure_pending");
    assert.equal(shown.target.spec_page_id, "spec");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI can reselect a failed production for a corrected retry", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-retry-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Retry Film", year: 2025, workType: "movie" });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "retry", displayTitle: "Retry" });
    repo.transitionProduction(variant.id, "evaluated");
    repo.transitionProduction(variant.id, "selected");
    db.close();
    assert.equal(run(["--db", dbPath, "start-production", "--variant", String(variant.id)], dir).status, 0);
    assert.equal(run(["--db", dbPath, "record-qc", "--variant", String(variant.id), "--fail", "--failure-code", "test_retry"], dir).status, 0);
    const retried = run(["--db", dbPath, "retry-production", "--variant", String(variant.id), "--failure-detail", "corrected filter"], dir);
    assert.equal(retried.status, 0, retried.stderr);
    assert.match(retried.stdout, /variant \d+: selected/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI retires a cancelled QC-passed variant from publication work", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-retire-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Cancelled Variant", year: 2025, workType: "movie" });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "cancelled", displayTitle: "Cancelled Variant 4.7GB" });
    repo.transitionProduction(variant.id, "evaluated");
    repo.transitionProduction(variant.id, "selected");
    repo.transitionProduction(variant.id, "encoding");
    repo.transitionProduction(variant.id, "qc_passed", { outputPath: "cancelled.mp4", outputSizeBytes: 1000 });
    repo.registerNotionTarget(variant.id, { workPageId: "work", specPageId: "empty-spec", expectedFilename: "cancelled.mp4" });
    db.close();

    const retired = run([
      "--db", dbPath,
      "retire-variant",
      "--variant", String(variant.id),
      "--failure-code", "user_cancelled_optional_spec",
      "--failure-detail", "User declined this optional specification",
      "--json"
    ], dir);
    assert.equal(retired.status, 0, retired.stderr);
    const row = JSON.parse(retired.stdout);
    assert.equal(row.production_state, "rejected");
    assert.equal(row.failure_code, "user_cancelled_optional_spec");
    assert.equal(row.failure_detail, "User declined this optional specification");

    const handoff = run(["--db", dbPath, "handoff", "--json"], dir);
    assert.equal(handoff.status, 0, handoff.stderr);
    assert.deepEqual(JSON.parse(handoff.stdout), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI reconcile-notion enforces a maximum of three before loading an adapter", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-reconcile-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const result = run(["--db", db, "reconcile-notion", "--limit", "4", "--json"], dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--limit must be between 1 and 3/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI reconcile-notion loads a Notion token from the repository .env", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-dotenv-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const markerPath = path.join(dir, "token.txt");
    const adapterPath = path.join(dir, "dotenv-adapter.mjs");
    writeFileSync(path.join(dir, ".env"), "NOTION_TOKEN=dotenv-test-token\n");
    writeFileSync(adapterPath, `import { writeFileSync } from "node:fs";
export function createAdapter() {
  writeFileSync(process.env.WWP_LEDGER_DOTENV_MARKER, process.env.NOTION_TOKEN ?? "missing");
  return { async inspectTarget() { return { structureVerified: false, mediaVerified: false, assetsVerified: false, evidence: {} }; } };
}`);
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Dotenv", year: 2025, workType: "movie" });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Dotenv" });
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) repo.transitionProduction(variant.id, state);
    repo.transitionPublication(variant.id, "structure_pending");
    repo.registerNotionTarget(variant.id, { workPageId: "work", specPageId: "spec" });
    db.close();

    const result = run(["--db", dbPath, "reconcile-notion", "--json"], dir, {
      NOTION_TOKEN: undefined,
      WWP_FILM_LEDGER_NOTION_ADAPTER_MODULE: adapterPath,
      WWP_LEDGER_DOTENV_MARKER: markerPath
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(markerPath, "utf8"), "dotenv-test-token");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI --force-after-429 bypasses an open breaker and invokes the adapter", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-force-breaker-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const markerPath = path.join(dir, "adapter-called.txt");
    const adapterPath = path.join(dir, "offline-adapter.mjs");
    writeFileSync(adapterPath, `import { writeFileSync } from "node:fs";
export function createAdapter() {
  return { async inspectTarget() {
    writeFileSync(process.env.WWP_LEDGER_ADAPTER_MARKER, "called");
    return { structureVerified: false, mediaVerified: false, assetsVerified: false, evidence: {} };
  } };
}`);
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db, { now: () => "2026-07-12T00:00:00.000Z" });
    const work = repo.ensureWork({ canonicalTitle: "Force", year: 2025, workType: "movie" });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Force" });
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) repo.transitionProduction(variant.id, state);
    repo.transitionPublication(variant.id, "structure_pending");
    repo.registerNotionTarget(variant.id, { workPageId: "work", specPageId: "spec" });
    repo.setSchedulerState("notion_backoff_until", "2099-01-01T00:00:00.000Z");
    db.close();

    const result = run(["--db", dbPath, "reconcile-notion", "--force-after-429", "--json"], dir, {
      WWP_FILM_LEDGER_NOTION_ADAPTER_MODULE: adapterPath,
      WWP_LEDGER_ADAPTER_MARKER: markerPath
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).checked, 1);
    assert.equal(existsSync(markerPath), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
