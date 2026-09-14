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

test("incomplete source intake waits until a later scan confirms a complete source", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const incomplete = f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      relativePath: "Downloading Movie",
      absolutePath: "X:\\queue\\Downloading Movie",
      fingerprint: "download-1",
      sourceKind: "folder",
      qualityState: "incomplete"
    });
    const waiting = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`intake:source:${incomplete.id}`);
    assert.equal(waiting.status, "deferred");
    assert.match(waiting.reason, /download is incomplete/u);
    assert.equal(f.repo.listWorkflowTasks({ taskType: "intake" }).length, 0);

    f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      relativePath: "Downloading Movie",
      absolutePath: "X:\\queue\\Downloading Movie",
      fingerprint: "download-1",
      sourceKind: "folder",
      qualityState: "acceptable"
    });
    const resumed = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`intake:source:${incomplete.id}`);
    assert.equal(resumed.status, "pending");
    assert.match(resumed.reason, /now complete/u);
  } finally { f.close(); }
});

test("source disposition defers incomplete-download intake and reopens it when artifacts disappear", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      relativePath: "Downloading Movie",
      absolutePath: "X:\\queue\\Downloading Movie",
      fingerprint: "download-2",
      sourceKind: "folder",
      qualityState: "unknown"
    });
    const deferred = f.repo.syncSourceIntakeAvailability([{ sourceId: source.id, disposition: "source_download_incomplete" }]);
    assert.equal(deferred.length, 1);
    assert.equal(deferred[0].status, "deferred");
    assert.match(deferred[0].reason, /download is incomplete/u);

    assert.equal(f.repo.syncSourceIntakeAvailability([{ sourceId: source.id, disposition: "source_download_incomplete" }]).length, 0);
    const resumed = f.repo.syncSourceIntakeAvailability([{ sourceId: source.id, disposition: "ai_action_pending" }]);
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].status, "pending");
    assert.match(resumed[0].reason, /now complete/u);
  } finally { f.close(); }
});

test("correctSourceWork records an auditable identity correction", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const wrong = f.repo.ensureWork({ canonicalTitle: "Wrong", year: 2007, workType: "movie" });
    const right = f.repo.ensureWork({ canonicalTitle: "Right", year: 2017, workType: "movie" });
    const source = f.repo.upsertDiscoveredSource({ inputRootId: root.id, workId: wrong.id, relativePath: "spider.ts", absolutePath: "X:\\queue\\spider.ts", fingerprint: "spider", sourceKind: "movie_file" });
    const corrected = f.repo.correctSourceWork(source.id, right.id, { reason: "Frame evidence identifies the other work" });
    assert.equal(corrected.work_id, right.id);
    const event = f.db.prepare("SELECT event_type, payload_json FROM events WHERE entity_type='source' AND entity_id=? ORDER BY id DESC LIMIT 1").get(source.id);
    assert.equal(event.event_type, "source_work_corrected");
    assert.match(event.payload_json, /Frame evidence identifies/);
  } finally { f.close(); }
});

test("explicit duplicate source marking survives discovery refresh", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const source = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "copy", absolutePath: "X:\\queue\\copy", fingerprint: "copy-1", sourceKind: "folder" });
    const canonical = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "canonical", absolutePath: "X:\\queue\\canonical", fingerprint: "canonical-1", sourceKind: "folder" });
    f.repo.markDuplicateSource(source.id, canonical.id, { reason: "Same content, copied path" });
    const refreshed = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "copy", absolutePath: "X:\\queue\\copy", fingerprint: "copy-2", sourceKind: "folder" });
    assert.equal(refreshed.source_kind, "duplicate_source");
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`).status, "done");
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

test("ensureVariant rejects a source belonging to another work", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const first = f.repo.ensureWork({ canonicalTitle: "First", year: 2025, workType: "movie" });
    const second = f.repo.ensureWork({ canonicalTitle: "Second", year: 2025, workType: "movie" });
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      workId: first.id,
      relativePath: "First",
      absolutePath: "X:\\queue\\First",
      fingerprint: "first-source",
      sourceKind: "folder"
    });
    assert.throws(() => f.repo.ensureVariant({
      workId: second.id,
      sourceId: source.id,
      specKey: "wrong-source",
      displayTitle: "Wrong source"
    }), /belongs to work .* not variant work/);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM variants").get().count, 0);
  } finally { f.close(); }
});

test("correctVariantSource records the actual encode input without losing source history", () => {
  const f = fixture();
  try {
    const { root, work, source, variant } = seed(f.repo);
    const actual = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Actual", absolutePath: "X:\\queue\\Actual",
      fingerprint: "actual", sourceKind: "file"
    });
    const corrected = f.repo.correctVariantSource(variant.id, actual.id, { reason: "encode probe confirmed actual input" });
    assert.equal(corrected.source_id, actual.id);
    const event = f.repo.getEvents({ entityType: "variant", entityId: variant.id }).at(-1);
    assert.equal(event.event_type, "variant_source_corrected");
    assert.match(event.payload_json, new RegExp(`"previousSourceId":${source.id}`));
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

test("completed due metadata maintenance schedules the next review instead of reopening immediately", () => {
  const f = fixture("2026-07-20T00:00:00.000Z");
  try {
    const { work } = seed(f.repo, "CompletedDue");
    f.db.prepare("UPDATE works SET next_review_at=? WHERE id=?").run("2026-07-19T00:00:00.000Z", work.id);
    const task = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`metadata:work:${work.id}`);
    f.repo.transitionWorkflowTask(task.id, "done", { reason: "metadata readback complete" });
    const row = f.db.prepare("SELECT next_review_at FROM works WHERE id=?").get(work.id);
    assert.equal(row.next_review_at, "2026-10-18T00:00:00.000Z");
    assert.deepEqual(f.repo.refreshDueMetadataTasks({ now: "2026-07-20T00:00:00.000Z" }), []);
  } finally { f.close(); }
});

test("deferred metadata maintenance stays deferred until its next run time", () => {
  const f = fixture("2026-07-20T00:00:00.000Z");
  try {
    const { work } = seed(f.repo, "DeferredDue");
    f.db.prepare("UPDATE works SET next_review_at=? WHERE id=?").run("2026-07-19T00:00:00.000Z", work.id);
    const task = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`metadata:work:${work.id}`);
    f.repo.transitionWorkflowTask(task.id, "deferred", {
      reason: "waiting for a better source",
      nextRunAt: "2026-08-01T00:00:00.000Z"
    });

    assert.deepEqual(f.repo.refreshDueMetadataTasks({ now: "2026-07-20T00:00:00.000Z" }), []);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE id=?").get(task.id).status, "deferred");
    assert.equal(f.repo.refreshDueMetadataTasks({ now: "2026-08-02T00:00:00.000Z" }).length, 1);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE id=?").get(task.id).status, "pending");
  } finally { f.close(); }
});

test("deferred metadata tasks requeue from task next_run_at even without work next_review_at", () => {
  const f = fixture("2026-07-20T00:00:00.000Z");
  try {
    const { work } = seed(f.repo, "TaskOnlyDue");
    f.db.prepare("UPDATE works SET next_review_at=NULL WHERE id=?").run(work.id);
    const task = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`metadata:work:${work.id}`);
    f.repo.transitionWorkflowTask(task.id, "deferred", {
      reason: "waiting for a better source",
      nextRunAt: "2026-07-21T00:00:00.000Z"
    });

    assert.deepEqual(f.repo.refreshDueMetadataTasks({ now: "2026-07-20T00:00:00.000Z" }), []);
    assert.equal(f.repo.refreshDueMetadataTasks({ now: "2026-07-22T00:00:00.000Z" }).length, 1);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE id=?").get(task.id).status, "pending");
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

test("collection parents defer instead of obscuring unbound member intake", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const parent = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "Collection", absolutePath: "X:\\queue\\Collection", fingerprint: "collection", sourceKind: "collection" });
    const result = f.repo.splitSourceCollection(parent.id, [{ relativePath: "Collection\\Member.iso", absolutePath: "X:\\queue\\Collection\\Member.iso", fingerprint: "member" }]);
    assert.equal(result.parentTask.status, "deferred");
    assert.equal(f.repo.listWorkflowTasks({ taskType: "intake", limit: 10 }).some(task => task.source_id === parent.id), false);
    assert.equal(f.repo.listWorkflowTasks({ taskType: "intake", limit: 10 }).some(task => task.source_id === result.members[0].id), true);
  } finally { f.close(); }
});

test("nested collection parents close after every leaf source is identified", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const parent = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "Collection", absolutePath: "X:\\queue\\Collection", fingerprint: "collection", sourceKind: "collection" });
    const nested = f.repo.upsertDiscoveredSource({ inputRootId: root.id, relativePath: "Collection\\Nested", absolutePath: "X:\\queue\\Collection\\Nested", fingerprint: "nested", sourceKind: "collection_member" });
    f.repo.splitSourceCollection(parent.id, [{ relativePath: nested.relative_path, absolutePath: nested.absolute_path, fingerprint: nested.fingerprint }]);
    const movie = f.repo.ensureWork({ canonicalTitle: "Leaf", year: 2025, workType: "movie" });
    f.repo.splitSourceCollection(nested.id, [{ relativePath: "Collection\\Nested\\Leaf.mkv", absolutePath: "X:\\queue\\Collection\\Nested\\Leaf.mkv", fingerprint: "leaf", workId: movie.id }]);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${nested.id}`).status, "done");
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${parent.id}`).status, "done");
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
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${first.id}`).status, "done");
    assert.equal(f.repo.markSourceMissing(first.id, false).missing, 0);
    assert.equal(f.repo.listSourcesForRoot(firstRoot.id)[0].missing, 0);
  } finally { f.close(); }
});

test("reappeared unbound source reopens intake after a missing-source close", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const input = { inputRootId: root.id, relativePath: "reappeared", absolutePath: "X:\\queue\\reappeared", fingerprint: "reappeared", sourceKind: "folder" };
    const source = f.repo.upsertDiscoveredSource(input);
    f.repo.markSourceMissing(source.id);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`).status, "done");
    const reopened = f.repo.upsertDiscoveredSource(input);
    const task = f.db.prepare("SELECT status, reason FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`);
    assert.equal(reopened.missing, 0);
    assert.equal(task.status, "pending");
    assert.match(task.reason, /reappeared/u);
  } finally { f.close(); }
});

test("reappeared completed collection parent does not reopen intake", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const input = { inputRootId: root.id, relativePath: "collection", absolutePath: "X:\\queue\\collection", fingerprint: "collection", sourceKind: "folder" };
    const source = f.repo.upsertDiscoveredSource(input);
    f.repo.transitionWorkflowTask(f.db.prepare("SELECT id FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`).id, "done", {
      reason: "All collection member source(s) have verified work identities"
    });
    f.repo.markSourceMissing(source.id);
    const reopened = f.repo.upsertDiscoveredSource(input);
    const task = f.db.prepare("SELECT status, reason FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`);
    assert.equal(reopened.missing, 0);
    assert.equal(task.status, "done");
    assert.match(task.reason, /All collection member/);
  } finally { f.close(); }
});

test("synthetic flat source does not reopen intake when it reappears", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const input = { inputRootId: root.id, relativePath: "@flat\\episode-01", absolutePath: "X:\\queue\\episode-01.mkv", fingerprint: "flat-1", sourceKind: "folder" };
    const source = f.repo.upsertDiscoveredSource(input);
    f.repo.markSourceMissing(source.id, true);
    f.repo.transitionWorkflowTask(f.db.prepare("SELECT id FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`).id, "done", { reason: "synthetic scan cleanup" });
    const reopened = f.repo.upsertDiscoveredSource({ ...input, missing: false });
    const task = f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${reopened.id}`);
    assert.equal(task.status, "done");
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

test("evidence correction can reopen a rejected variant without bypassing the audit trail", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo, "Reopen");
    f.repo.transitionProduction(variant.id, "evaluated");
    f.repo.transitionProduction(variant.id, "rejected", {
      failureCode: "source_color_mismatch",
      failureDetail: "initial sample appeared monochrome"
    });
    f.repo.transitionPublication(variant.id, "cancelled", { reason: "rejected source" });
    const reopened = f.repo.reopenRejectedVariant(variant.id, {
      reason: "Distributed color samples prove the source is mixed color, so the prior rejection was incorrect."
    });
    assert.equal(reopened.production_state, "evaluated");
    assert.equal(reopened.publication_state, "not_ready");
    assert.equal(reopened.failure_code, null);
    assert.match(reopened.failure_detail, /Distributed color samples/);
    assert.equal(f.repo.getEvents({ entityType: "variant", entityId: variant.id }).at(-1).event_type, "production_variant_reopened");
    assert.throws(() => f.repo.reopenRejectedVariant(variant.id, { reason: "again" }), /requires rejected state/);
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

test("production queue keeps a bound source visible until a variant is selected", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Selection Needed", year: 2025, priorityScore: 70 });
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Selection Needed",
      absolutePath: "X:\\queue\\Selection Needed", fingerprint: "selection-needed", sourceKind: "folder",
      qualityState: "acceptable"
    });
    const queued = f.repo.listProductionQueue({ limit: 5 });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].candidate_type, "source_selection");
    assert.equal(queued[0].source_id, source.id);
    assert.equal(queued[0].production_state, "needs_selection");

    f.repo.ensureVariant({ workId: work.id, sourceId: source.id, specKey: "high", displayTitle: "Selection Needed 高配" });
    assert.equal(f.repo.listProductionQueue({ limit: 5 })[0].candidate_type, "variant");

    const flat = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "@flat/Selection Needed",
      absolutePath: "E:\\video_made", fingerprint: "selection-flat", sourceKind: "folder", qualityState: "acceptable"
    });
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 5 }).some((row) => row.source_id === flat.id), true);
    const episodeFlat = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "@flat/episode 01",
      absolutePath: "E:\\video_made", fingerprint: "selection-episode-flat", sourceKind: "folder", qualityState: "acceptable"
    });
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 5 }).some((row) => row.source_id === episodeFlat.id), false);
    f.repo.setInputRootEnabled("X:\\queue", false);
    assert.deepEqual(f.repo.listProductionSourceCandidates({ limit: 5 }), []);
  } finally { f.close(); }
});

test("production source queue excludes an incomplete bound source", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Incomplete", year: 2025, workType: "movie" });
    f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      workId: work.id,
      relativePath: "Incomplete",
      absolutePath: "X:\\queue\\Incomplete",
      fingerprint: "incomplete-bound",
      sourceKind: "folder",
      qualityState: "incomplete"
    });
    assert.equal(f.repo.listProductionSourceCandidates().length, 0);
  } finally { f.close(); }
});

test("production source selection excludes a duplicate scan of the same physical path", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Duplicate Scan", year: 2025, priorityScore: 70 });
    const canonical = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Duplicate Scan",
      absolutePath: "X:\\queue\\Duplicate Scan", fingerprint: "duplicate-canonical", sourceKind: "series_folder",
      qualityState: "acceptable"
    });
    const duplicate = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "nested\\Duplicate Scan",
      absolutePath: "x:/queue/duplicate scan", fingerprint: "duplicate-rescan", sourceKind: "folder",
      qualityState: "acceptable"
    });

    const candidates = f.repo.listProductionSourceCandidates({ limit: 5 });
    assert.equal(candidates.some((row) => row.source_id === canonical.id), true);
    assert.equal(candidates.some((row) => row.source_id === duplicate.id), false);
  } finally { f.close(); }
});

test("production queue excludes a split collection parent when child sources exist", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Split Season", year: 2025, priorityScore: 70 });
    const parent = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Season 3",
      absolutePath: "X:\\queue\\Season 3", fingerprint: "split-season-parent", sourceKind: "season_member",
      qualityState: "acceptable"
    });
    const child = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Season 3\\Episode 01.mkv",
      absolutePath: "X:\\queue\\Season 3\\Episode 01.mkv", fingerprint: "split-season-child", sourceKind: "season_member",
      qualityState: "acceptable"
    });

    const candidates = f.repo.listProductionSourceCandidates({ limit: 5 });
    assert.equal(candidates.some((row) => row.source_id === parent.id), false);
    assert.equal(candidates.some((row) => row.source_id === child.id), true);
  } finally { f.close(); }
});

test("production queue excludes a collection_member container when child sources exist", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Collection Member Season", year: 2025, priorityScore: 70 });
    const parent = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Season 4",
      absolutePath: "X:\\queue\\Season 4", fingerprint: "collection-member-parent", sourceKind: "collection_member",
      qualityState: "acceptable"
    });
    const child = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Season 4\\Episode 01.mkv",
      absolutePath: "X:\\queue\\Season 4\\Episode 01.mkv", fingerprint: "collection-member-child", sourceKind: "episode_file",
      qualityState: "acceptable"
    });

    const candidates = f.repo.listProductionSourceCandidates({ limit: 5 });
    assert.equal(candidates.some((row) => row.source_id === parent.id), false);
    assert.equal(candidates.some((row) => row.source_id === child.id), true);
  } finally { f.close(); }
});

test("production queue prioritizes first-release coverage and keeps completed-work supplements queryable", () => {
  const f = fixture();
  try {
    const covered = seed(f.repo, "Covered");
    f.db.prepare("UPDATE works SET priority_score=100, workflow_status='已完成' WHERE id=?").run(covered.work.id);
    f.db.prepare("UPDATE variants SET production_state='qc_passed', publication_state='sync_ready' WHERE id=?").run(covered.variant.id);
    const supplement = f.repo.ensureVariant({
      workId: covered.work.id,
      sourceId: covered.source.id,
      specKey: "commentary",
      displayTitle: "ExampleCovered 导评版"
    });

    const uncovered = seed(f.repo, "Uncovered");
    f.db.prepare("UPDATE works SET priority_score=10 WHERE id=?").run(uncovered.work.id);

    const root = f.repo.upsertInputRoot("X:\\queueNeedsSelection");
    const needsSelectionWork = f.repo.ensureWork({ canonicalTitle: "Needs Selection", year: 2025, priorityScore: 5 });
    f.repo.upsertDiscoveredSource({
      inputRootId: root.id,
      workId: needsSelectionWork.id,
      relativePath: "Needs Selection",
      absolutePath: "X:\\queueNeedsSelection\\Needs Selection",
      fingerprint: "needs-selection",
      sourceKind: "folder",
      qualityState: "acceptable"
    });

    const queue = f.repo.listProductionQueue({ limit: 10 });
    assert.deepEqual(queue.map((row) => row.candidate_type), ["variant", "source_selection", "variant"]);
    assert.equal(queue[0].id, uncovered.variant.id);
    assert.equal(queue[0].release_covered, 0);
    assert.equal(queue.at(-1).id, supplement.id);
    assert.equal(queue.at(-1).release_covered, 1);
  } finally { f.close(); }
});

test("variant metadata correction can replace a stale planned target size", () => {
  const f = fixture();
  try {
    const seeded = seed(f.repo, "Measured tier correction");
    f.db.prepare("UPDATE variants SET target_size_bytes=?, output_size_bytes=? WHERE id=?")
      .run(4_700_000_000, 2_916_329_786, seeded.variant.id);
    const result = f.repo.correctVariantMetadata(seeded.variant.id, { targetSizeBytes: 2_916_329_786 });
    assert.equal(result.applied, true);
    assert.equal(result.row.target_size_bytes, 2_916_329_786);
    const [event] = f.repo.getEvents({ entityType: "variant", entityId: seeded.variant.id })
      .filter((item) => item.event_type === "variant_metadata_corrected");
    assert.equal(JSON.parse(event.payload_json).from.targetSizeBytes, 4_700_000_000);
  } finally { f.close(); }
});

test("split series folder parent is not offered after child sources are tracked", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queueSeries");
    const work = f.repo.ensureWork({ canonicalTitle: "Split Series Folder", year: 2025, priorityScore: 70 });
    const parent = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "TV-EP001-EP101",
      absolutePath: "X:\\queueSeries\\TV-EP001-EP101", fingerprint: "series-folder-parent", sourceKind: "series_folder",
      qualityState: "acceptable"
    });
    const child = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "TV-EP001-EP101\\Episode 101.mkv",
      absolutePath: "X:\\queueSeries\\TV-EP001-EP101\\Episode 101.mkv", fingerprint: "series-folder-child", sourceKind: "episode_file",
      qualityState: "acceptable"
    });

    const candidates = f.repo.listProductionSourceCandidates({ limit: 5 });
    assert.equal(candidates.some((row) => row.source_id === parent.id), false);
    assert.equal(candidates.some((row) => row.source_id === child.id), true);
  } finally { f.close(); }
});

test("completed work re-enters source selection only after its intake is explicitly requeued", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Completed but updated", year: 2025, priorityScore: 70 });
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Completed but updated",
      absolutePath: "X:\\queue\\Completed but updated", fingerprint: "completed-but-updated", sourceKind: "folder",
      qualityState: "acceptable"
    });
    f.db.prepare("UPDATE works SET workflow_status='已完成', workflow_status_observed_at=?, updated_at=? WHERE id=?")
      .run("2026-07-12T01:00:00.000Z", "2026-07-12T01:00:00.000Z", work.id);
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 5 }).some((row) => row.source_id === source.id), false);

    f.repo.requeueIntakeTask(source.id, { reason: "Source fingerprint changed" });
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 5 }).some((row) => row.source_id === source.id), true);
  } finally { f.close(); }
});

test("source selection excludes an explicitly subtitle-blocked foreign source", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Foreign subtitle gate", year: 2025, priorityScore: 70 });
    const blocked = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "blocked", absolutePath: "X:\\queue\\blocked",
      fingerprint: "blocked-subtitle", sourceKind: "folder", qualityState: "1080p_h264_blu-ray",
      subtitleEvidence: { hardGate: "no_chinese_subtitles_on_sample" },
      audioEvidence: { languages: ["English"] }
    });
    const unknown = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "unknown", absolutePath: "X:\\queue\\unknown",
      fingerprint: "unknown-subtitle", sourceKind: "folder", qualityState: "1080p_h264_blu-ray"
    });
    const candidates = f.repo.listProductionSourceCandidates({ limit: 5 });
    assert.equal(candidates.some((row) => row.source_id === blocked.id), false);
    assert.equal(candidates.some((row) => row.source_id === unknown.id), true);
  } finally { f.close(); }
});

test("source selection excludes current hasChineseSubtitle false evidence", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Current subtitle evidence", year: 2025, priorityScore: 70 });
    const blocked = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "blocked-current", absolutePath: "X:\\queue\\blocked-current",
      fingerprint: "blocked-current-subtitle", sourceKind: "folder", qualityState: "acceptable",
      subtitleEvidence: { internalProbeState: "complete", hasChineseSubtitle: false },
      audioEvidence: { languages: ["Spanish"] }
    });
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 5 }).some((row) => row.source_id === blocked.id), false);
  } finally { f.close(); }
});

test("legacy verifiedChinese false remains selectable until absence is explicitly confirmed", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Unlabelled subtitle", year: 2025, priorityScore: 70 });
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "unlabelled", absolutePath: "X:\\queue\\unlabelled",
      fingerprint: "unlabelled-subtitle", sourceKind: "folder", qualityState: "acceptable",
      subtitleEvidence: { internalProbeState: "completed", verifiedChinese: false, note: "unlabelled PGS; visual check not performed" },
      audioEvidence: { languages: ["English"] }
    });
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 5 }).some((row) => row.source_id === source.id), true);
    assert.equal(f.repo.listSubtitleAcquisitionCandidates({ limit: 5 }).some((row) => row.source_id === source.id), false);
  } finally { f.close(); }
});

test("confirmed subtitle absence creates and later resolves a durable acquisition task", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Needs subtitles", year: 2025, priorityScore: 80 });
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "needs-subtitles", absolutePath: "X:\\queue\\needs-subtitles",
      fingerprint: "needs-subtitles", sourceKind: "folder", qualityState: "subtitle_missing",
      subtitleEvidence: { internalProbeState: "completed", verifiedChinese: false },
      audioEvidence: { languages: ["English"] }
    });

    const first = f.repo.syncSubtitleAcquisitionTasks({ limit: 5 });
    assert.deepEqual(first.candidates.map((row) => row.source_id), [source.id]);
    assert.equal(first.created.length, 1);
    const task = f.repo.listWorkflowTasks({ taskType: "subtitle_acquisition", limit: 5 })[0];
    assert.equal(task.source_id, source.id);
    assert.equal(task.status, "pending");

    const second = f.repo.syncSubtitleAcquisitionTasks({ limit: 5 });
    assert.equal(second.created.length, 0);
    f.repo.updateSourceEvidence(source.id, {
      qualityState: "acceptable",
      subtitleEvidence: { internalProbeState: "completed", verifiedChinese: true }
    });
    const resolved = f.repo.syncSubtitleAcquisitionTasks({ limit: 5 });
    assert.deepEqual(resolved.resolved.map((row) => row.id), [task.id]);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE id=?").get(task.id).status, "done");

    f.repo.updateSourceEvidence(source.id, {
      qualityState: "subtitle_missing",
      subtitleEvidence: { internalProbeState: "completed", hasChineseSubtitle: false }
    });
    const reopened = f.repo.syncSubtitleAcquisitionTasks({ limit: 5 });
    assert.deepEqual(reopened.reopened.map((row) => row.id), [task.id]);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE id=?").get(task.id).status, "pending");
  } finally { f.close(); }
});

test("subtitle task sync does not starve untracked sources behind existing open tasks", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const sources = [];
    for (let index = 0; index < 4; index += 1) {
      const work = f.repo.ensureWork({ canonicalTitle: `Subtitle source ${index}`, year: 2025, priorityScore: 100 - index });
      sources.push(f.repo.upsertDiscoveredSource({
        inputRootId: root.id, workId: work.id, relativePath: `source-${index}`,
        absolutePath: `X:\\queue\\source-${index}`, fingerprint: `source-${index}`,
        sourceKind: "folder", qualityState: "subtitle_missing",
        subtitleEvidence: { hardGate: "missing_chinese_subtitle", verifiedChinese: false },
        audioEvidence: { languages: ["English"] }
      }));
    }

    const first = f.repo.syncSubtitleAcquisitionTasks({ limit: 3 });
    assert.equal(first.created.length, 3);
    const second = f.repo.syncSubtitleAcquisitionTasks({ limit: 3 });
    assert.deepEqual(second.created.map((task) => task.source_id), [sources[3].id]);
  } finally { f.close(); }
});

test("production source queue waits while the same work has a completed variant pending publication", () => {
  const f = fixture();
  try {
    const root = f.repo.upsertInputRoot("X:\\queue");
    const work = f.repo.ensureWork({ canonicalTitle: "Pending publication", year: 2025, priorityScore: 70 });
    const pendingSource = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Pending publication final",
      absolutePath: "X:\\queue\\Pending publication final", fingerprint: "pending-publication-final", sourceKind: "folder",
      qualityState: "acceptable"
    });
    const laterSource = f.repo.upsertDiscoveredSource({
      inputRootId: root.id, workId: work.id, relativePath: "Pending publication supplemental",
      absolutePath: "X:\\queue\\Pending publication supplemental", fingerprint: "pending-publication-supplemental", sourceKind: "folder",
      qualityState: "acceptable"
    });
    const variant = f.repo.ensureVariant({ workId: work.id, sourceId: pendingSource.id, specKey: "primary", displayTitle: "Pending publication primary" });
    for (const state of ["evaluated", "selected", "encoding"]) f.repo.transitionProduction(variant.id, state);
    f.repo.transitionProduction(variant.id, "qc_passed", { outputPath: "E:\\video_made\\pending.mp4", outputSizeBytes: 1_000_000 });
    f.repo.transitionPublication(variant.id, "structure_pending");

    assert.equal(f.repo.listProductionSourceCandidates({ limit: 5 }).some((row) => row.source_id === laterSource.id), false);
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

test("Notion target upsert preserves verification for the same target and invalidates it after a target replacement", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo);
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) f.repo.transitionProduction(variant.id, state);
    f.repo.registerNotionTarget(variant.id, { workPageId: "w", specPageId: "s", structureVerifiedAt: "2026-07-11T00:00:00.000Z", nextCheckAt: "2026-07-13T00:00:00.000Z" });
    f.repo.registerNotionTarget(variant.id, { workPageId: "w", specPageId: "s" });
    const target = f.db.prepare("SELECT * FROM notion_targets WHERE variant_id = ?").get(variant.id);
    assert.equal(target.work_page_id, "w");
    assert.equal(target.structure_verified_at, "2026-07-11T00:00:00.000Z");
    assert.deepEqual(f.repo.listPublicationCandidates({ limit: 3 }), []);
    f.repo.registerNotionTarget(variant.id, { workPageId: "w2", specPageId: "s2", mediaBlockId: "b2", mediaAssetPageId: "a2" });
    const replaced = f.db.prepare("SELECT * FROM notion_targets WHERE variant_id = ?").get(variant.id);
    assert.equal(replaced.structure_verified_at, null);
    assert.equal(replaced.media_block_id, "b2");
    assert.equal(replaced.media_asset_page_id, "a2");
    assert.equal(replaced.next_check_at, "2026-07-12T00:00:00.000Z");
    assert.equal(f.repo.listPublicationCandidates({ limit: 3 })[0].id, variant.id);
  } finally { f.close(); }
});

test("replacing only the Media Asset page invalidates inherited publication evidence", () => {
  const f = fixture();
  try {
    const { variant } = seed(f.repo);
    for (const state of ["evaluated", "selected", "encoding", "qc_passed"]) f.repo.transitionProduction(variant.id, state);
    f.repo.transitionPublication(variant.id, "structure_pending");
    f.repo.registerNotionTarget(variant.id, { workPageId: "w", specPageId: "s", mediaBlockId: "b" });
    f.repo.recordNotionInspection(variant.id, {
      structureVerified: true,
      mediaVerified: true,
      mediaBlockId: "b",
      assetsVerified: true,
      mediaAssetPageId: "old-asset"
    });
    for (const state of ["upload_pending", "upload_seen", "assets_pending", "verification_pending", "sync_ready"]) {
      f.repo.transitionPublication(variant.id, state);
    }
    assert.equal(f.db.prepare("SELECT publication_state FROM variants WHERE id=?").get(variant.id).publication_state, "sync_ready");

    const replaced = f.repo.registerNotionTarget(variant.id, {
      workPageId: "w",
      specPageId: "s",
      mediaBlockId: "b",
      mediaAssetPageId: "new-asset"
    });
    assert.equal(replaced.media_asset_page_id, "new-asset");
    assert.equal(replaced.structure_verified_at, null);
    assert.equal(replaced.media_verified_at, null);
    assert.equal(replaced.assets_verified_at, null);
    assert.equal(f.db.prepare("SELECT publication_state FROM variants WHERE id=?").get(variant.id).publication_state, "structure_pending");
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
