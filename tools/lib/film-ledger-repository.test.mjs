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

test("attachVariantSource repairs legacy links only within the same work", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Linked", year: 2025, workType: "movie" });
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      workId: work.id,
      relativePath: "Linked",
      absolutePath: "X:\\queue\\Linked",
      fingerprint: "linked",
      sourceKind: "folder"
    });
    const variant = f.repo.ensureVariant({ workId: work.id, specKey: "legacy", displayTitle: "Legacy", sourceId: null });

    const attached = f.repo.attachVariantSource(variant.id, source.id, { reason: "verified legacy source" });
    assert.equal(attached.source_id, source.id);
    assert.equal(f.repo.attachVariantSource(variant.id, source.id).source_id, source.id);
    assert.equal(f.repo.getEvents({ entityType: "variant", entityId: variant.id }).filter((event) => event.event_type === "variant_source_attached").length, 1);

    const otherWork = f.repo.ensureWork({ canonicalTitle: "Other", year: 2025, workType: "movie" });
    const otherSource = f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      workId: otherWork.id,
      relativePath: "Other",
      absolutePath: "X:\\queue\\Other",
      fingerprint: "other",
      sourceKind: "folder"
    });
    assert.throws(() => f.repo.attachVariantSource(variant.id, otherSource.id), /not variant work/);
  } finally { f.close(); }
});

test("Notion page identity wins when a manifest uses a renamed canonical title", () => {
  const f = fixture();
  try {
    const first = f.repo.ensureWork({ canonicalTitle: "Canonical Title", year: 2025, workType: "movie", notionWorkPageId: "notion-work-1" });
    const reused = f.repo.ensureWork({ canonicalTitle: "Legacy Alias", year: 2025, workType: "movie", notionWorkPageId: "notion-work-1" });
    assert.equal(reused.id, first.id);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM works").get().count, 1);
    assert.equal(f.db.prepare("SELECT notion_work_page_id FROM works WHERE id=?").get(first.id).notion_work_page_id, "notion-work-1");
  } finally { f.close(); }
});

test("renameWork updates canonical identity with an expected-title guard", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({
      canonicalTitle: "南京照相馆 Dead to Rights",
      year: 2025,
      workType: "movie",
      notionWorkPageId: "notion-work-nanjing"
    });
    const renamed = f.repo.renameWork(work.id, "南京照相馆", {
      expectedCurrent: "南京照相馆 Dead to Rights"
    });
    assert.equal(renamed.canonical_title, "南京照相馆");
    assert.throws(
      () => f.repo.renameWork(work.id, "错误标题", { expectedCurrent: "旧标题" }),
      /work title mismatch/
    );
    const events = f.repo.getEvents({ entityType: "work", entityId: work.id });
    assert.equal(events.at(-1).event_type, "work_title_changed");
  } finally { f.close(); }
});

test("workflow handoff mirrors Notion state without creating duplicate events", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({
      canonicalTitle: "Handoff Example",
      year: 2025,
      workType: "movie",
      notionWorkPageId: "notion-handoff-1",
      priorityScore: 50
    });
    const first = f.repo.recordWorkHandoffByNotionPage("notion-handoff-1", {
      status: "已上传待 AI 收尾",
      note: "2026-07-25 人：视频上传完成。",
      actor: "human",
      observedAt: "2026-07-25T00:00:00.000Z"
    });
    const repeated = f.repo.recordWorkHandoffByNotionPage("notion-handoff-1", {
      status: "已上传待 AI 收尾",
      note: "2026-07-25 人：视频上传完成。",
      actor: "human",
      observedAt: "2026-07-25T00:05:00.000Z"
    });

    assert.equal(first.changed, true);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.row.workflow_status_observed_at, "2026-07-25T00:05:00.000Z");
    assert.deepEqual(f.repo.listWorkHandoffs({ limit: 3 }).map((row) => row.id), [work.id]);
    assert.equal(f.repo.getEvents({ entityType: "work", entityId: work.id }).length, 1);
  } finally { f.close(); }
});

test("workflow handoff enforces AI-authored transitions but accepts observed human state", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({ canonicalTitle: "Transition Example", year: 2025, workType: "movie" });
    f.repo.recordWorkHandoff(work.id, { status: "人工上传中", actor: "human" });
    assert.throws(
      () => f.repo.recordWorkHandoff(work.id, { status: "已完成", actor: "ai" }, { enforceTransition: true }),
      /illegal workflow handoff transition/
    );
    const observed = f.repo.recordWorkHandoff(work.id, { status: "已完成", actor: "human" });
    assert.equal(observed.row.workflow_status, "已完成");
  } finally { f.close(); }
});

test("metadata maintenance can be requeued after an earlier backfill", () => {
  const f = fixture("2026-07-20T00:00:00.000Z");
  try {
    const { work } = seed(f.repo);
    const task = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`metadata:work:${work.id}`);
    f.repo.transitionWorkflowTask(task.id, "done", { reason: "initial metadata readback complete" });
    assert.equal(f.repo.listWorkflowTasks({ taskType: "metadata_backfill" }).length, 0);
    const requeued = f.repo.requeueMetadataTask(work.id, { reason: "AI fields need a later refresh" });
    assert.equal(requeued.status, "pending");
    assert.equal(requeued.reason, "AI fields need a later refresh");
    assert.equal(f.repo.getEvents({ entityType: "work", entityId: work.id }).at(-1).event_type, "metadata_task_requeued");
    f.repo.requeueMetadataTask(work.id, { nextRunAt: "2026-08-01T00:00:00.000Z" });
    assert.equal(f.db.prepare("SELECT next_review_at FROM works WHERE id=?").get(work.id).next_review_at, "2026-08-01T00:00:00.000Z");
  } finally { f.close(); }
});

test("due deferred intake reviews are requeued while future reviews remain deferred", () => {
  const f = fixture("2026-07-20T00:00:00.000Z");
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const due = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "due", absolutePath: "X:\\queue\\due", fingerprint: "due", sourceKind: "folder" });
    const future = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "future", absolutePath: "X:\\queue\\future", fingerprint: "future", sourceKind: "folder" });
    const dueTask = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`intake:source:${due.id}`);
    const futureTask = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`intake:source:${future.id}`);
    f.repo.transitionWorkflowTask(dueTask.id, "deferred", { nextRunAt: "2026-07-19T00:00:00.000Z" });
    f.repo.transitionWorkflowTask(futureTask.id, "deferred", { nextRunAt: "2026-07-21T00:00:00.000Z" });

    const refreshed = f.repo.refreshDueIntakeTasks({ limit: 10 });
    assert.deepEqual(refreshed.map(task => task.id), [dueTask.id]);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE id=?").get(dueTask.id).status, "pending");
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE id=?").get(futureTask.id).status, "deferred");
    assert.equal(f.repo.getEvents({ entityType: "workflow_task", entityId: dueTask.id }).at(-1).event_type, "intake_task_requeued");
  } finally { f.close(); }
});

test("due work review automatically requeues metadata on the next identity pass", () => {
  const f = fixture("2026-07-20T00:00:00.000Z");
  try {
    const first = seed(f.repo, "Due");
    const task = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`metadata:work:${first.work.id}`);
    f.repo.transitionWorkflowTask(task.id, "done");
    f.db.prepare("UPDATE works SET next_review_at=? WHERE id=?").run("2026-07-19T00:00:00.000Z", first.work.id);
    f.repo.ensureWork({ canonicalTitle: "ExampleDue", year: 2025, workType: "movie" });
    assert.equal(f.repo.listWorkflowTasks({ taskType: "metadata_backfill" }).length, 1);
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

test("binding a discovered source completes and links its intake task", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const source = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "incoming", absolutePath: "X:\\queue\\incoming", fingerprint: "incoming", sourceKind: "folder" });
    const work = f.repo.ensureWork({ canonicalTitle: "Incoming", year: 2025, workType: "movie" });
    const bound = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "incoming", absolutePath: "X:\\queue\\incoming", fingerprint: "incoming", sourceKind: "folder", workId: work.id });
    const task = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`);
    assert.equal(bound.work_id, work.id);
    assert.equal(task.status, "done");
    assert.equal(task.source_id, source.id);
    assert.equal(task.work_id, work.id);
  } finally { f.close(); }
});

test("source evidence can be updated after identity binding without reopening intake", () => {
  const f = fixture();
  try {
    const { source } = seed(f.repo);
    const updated = f.repo.updateSourceEvidence(source.id, {
      probePath: ".local-data/sample.json",
      qualityState: "4k_hevc",
      subtitleEvidence: { bakedChinese: true, streamCount: 0 },
      audioEvidence: { tracks: ["mandarin", "commentary"] },
      colorRisk: "none",
      reason: "sample checked"
    });
    assert.equal(updated.probe_path, ".local-data/sample.json");
    assert.equal(updated.quality_state, "4k_hevc");
    assert.equal(updated.subtitle_evidence, '{"bakedChinese":true,"streamCount":0}');
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM workflow_tasks WHERE task_key=? AND status='pending'").get(`intake:source:${source.id}`).count, 0);
    assert.equal(f.repo.getEvents({ entityType: "source", entityId: source.id }).at(-1).event_type, "source_evidence_updated");
  } finally { f.close(); }
});

test("collection sources fan out into member sources and close the parent intake when all are bound", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const parent = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "Collection", absolutePath: "X:\\queue\\Collection", fingerprint: "collection", sourceKind: "collection" });
    const movie = f.repo.ensureWork({ canonicalTitle: "Member", year: 2025, workType: "movie" });
    const result = f.repo.splitSourceCollection(parent.id, [{ relativePath: "Collection\\Member.iso", absolutePath: "X:\\queue\\Collection\\Member.iso", fingerprint: "member", workId: movie.id }]);
    assert.equal(result.members.length, 1);
    assert.equal(result.members[0].work_id, movie.id);
    assert.equal(result.parentTask.status, "done");
    assert.equal(f.repo.getEvents({ entityType: "source", entityId: parent.id }).at(-1).event_type, "source_collection_split");
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

test("production output paths use the same Windows identity as correction lookup", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo, "Path");
    for (const state of ["evaluated", "selected", "encoding"]) f.repo.transitionProduction(variant.id, state);
    f.repo.transitionProduction(variant.id, "qc_passed", { outputPath: "E:\\Video_Made\\Example.mp4\\" });
    assert.equal(f.repo.findVariantByOutputPath("e:\\video_made\\example.mp4")?.id, variant.id);
  } finally { f.close(); }
});

test("duplicate variants with the same Notion target can merge into the canonical record", () => {
  const f = fixture();
  try {
    const work = f.repo.ensureWork({ canonicalTitle: "Merge Target", year: 2025 });
    const canonical = f.repo.ensureVariant({
      workId: work.id,
      specKey: "legacy",
      displayTitle: "旧规格",
      outputPath: "E:\\old.mp4"
    });
    const duplicate = f.repo.ensureVariant({
      workId: work.id,
      specKey: "new",
      displayTitle: "繁体 H.265 4.8GB",
      audioVariant: "韩语 AAC 5.1",
      subtitleVariant: "繁体硬字幕",
      outputPath: "E:\\new.mp4",
      targetSizeBytes: 200
    });
    f.repo.registerNotionTarget(canonical.id, { workPageId: "work", specPageId: "spec", mediaBlockId: "block" });
    f.repo.registerNotionTarget(duplicate.id, { workPageId: "work", specPageId: "spec" });

    const merged = f.repo.mergeDuplicateVariant(duplicate.id, canonical.id);
    assert.equal(merged.id, canonical.id);
    assert.equal(merged.output_path, "e:\\new.mp4");
    assert.equal(merged.subtitle_variant, "繁体硬字幕");
    assert.equal(f.db.prepare("SELECT count(*) count FROM variants").get().count, 1);
    assert.equal(f.db.prepare("SELECT media_block_id FROM notion_targets WHERE variant_id=?").get(canonical.id).media_block_id, "block");
    assert.equal(f.repo.getEvents({ entityType: "variant", entityId: canonical.id }).at(-1).event_type, "variant_duplicate_merged");
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

test("deferred production candidates stay out until an explicit review time is due", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo, "Deferred");
    f.db.prepare("UPDATE variants SET production_state='deferred', next_review_at=NULL WHERE id=?").run(variant.id);
    assert.deepEqual(f.repo.listProductionCandidates({ limit: 99 }).map((row) => row.id), []);

    f.db.prepare("UPDATE variants SET next_review_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z", variant.id);
    assert.deepEqual(f.repo.listProductionCandidates({ limit: 99 }).map((row) => row.id), [variant.id]);
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
    assert.deepEqual(f.repo.getStatusSummary(), {
      production: { discovered: 1 },
      publication: { not_ready: 1 },
      handoff: {},
      totals: { variants: 1, syncReady: 0 }
    });
  } finally { f.close(); }
});

test("Notion reconciliation persistence separates evidence from failures and stores scheduler state", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo);
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) f.repo.transitionProduction(variant.id, state);
    f.repo.transitionPublication(variant.id, "structure_pending");
    f.repo.registerNotionTarget(variant.id, { workPageId: "w", specPageId: "s" });
    assert.equal(f.repo.listDueNotionTargets({ limit: 9 }).length, 1);
    f.repo.recordNotionInspection(variant.id, { structureVerified: true, mediaVerified: true, mediaBlockId: "block" }, "2026-07-12T00:00:00.000Z", "2026-07-12T00:05:00.000Z");
    f.repo.recordNotionFailure(variant.id, { code: "temporary", detail: "failed", nextCheckAt: "2026-07-12T00:20:00.000Z" });
    const target = f.db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(variant.id);
    assert.equal(target.media_block_id, "block");
    assert.equal(target.media_verified_at, "2026-07-12T00:00:00.000Z");
    assert.equal(target.last_error_code, "temporary");
    f.repo.setSchedulerState("notion_backoff_until", "2026-07-12T01:00:00.000Z");
    assert.equal(f.repo.getSchedulerState("notion_backoff_until"), "2026-07-12T01:00:00.000Z");
  } finally { f.close(); }
});
