import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { classifySourceDisposition, summarizeSourceDispositions } from "./film-source-disposition.mjs";

const source = {
  id: 7,
  work_id: 3,
  canonical_title: "Example",
  absolute_path: "I:\\MAKE\\queue\\Example",
  input_root_path: "I:\\MAKE\\queue",
  relative_path: "Example",
  source_kind: "directory",
  workflow_status: "已完成",
  workflow_note: "[规格扩展:CLOSED] 已覆盖全部有价值版本"
};

test("closed and eligible source is actionable cleanup work", () => {
  const item = classifySourceDisposition({ source, cleanupCandidate: { eligible: true, reasons: [] } });
  assert.equal(item.disposition, "cleanup_ready");
  assert.equal(item.actionableNow, true);
  assert.equal(item.nextTrigger, "移动到同盘待人工删除目录");
});

test("a failed quarantine move is a visible local blocker, not actionable or human work", () => {
  const item = classifySourceDisposition({
    source,
    cleanupCandidate: { eligible: true, reasons: [] },
    events: [{ event_type: "source_quarantine_failed", payload_json: '{"errorCode":"EPERM"}' }]
  });
  assert.equal(item.disposition, "cleanup_move_failed");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.match(item.nextTrigger, /文件占用/u);
});

test("waiting-user task is reported before generic production blockers", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_status: "待人工确认", workflow_note: "请确认是否制作国配版" },
    tasks: [{ task_type: "intake", status: "waiting_user", reason: "确认版本范围" }],
    variants: [{ id: 9, production_state: "deferred", publication_state: "not_ready" }],
    cleanupCandidate: { eligible: false, reasons: ["linked_variants_not_closed", "source_expansion_open"] }
  });
  assert.equal(item.disposition, "waiting_for_human");
  assert.equal(item.needsHumanConfirmation, true);
  assert.equal(item.nextTrigger, "确认版本范围");
});

test("archive-only input is visible but does not become phantom production work", () => {
  const item = classifySourceDisposition({
    source: { ...source, source_kind: "archive_bundle", work_id: null, workflow_status: null },
    tasks: [{ task_type: "intake", status: "pending", reason: "archive discovered" }]
  });
  assert.equal(item.disposition, "archive_bundle");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.match(item.nextTrigger, /解包后重新扫描/u);
});

test("future deferred variant reports its review time instead of pretending the queue is empty", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_note: "[规格扩展:OPEN] 高码率版延期" },
    variants: [{ id: 10, production_state: "deferred", publication_state: "not_ready", next_review_at: "2026-09-10T00:00:00.000Z" }],
    cleanupCandidate: { eligible: false, reasons: ["linked_variants_not_closed", "source_expansion_open"] },
    now: "2026-08-29T00:00:00.000Z"
  });
  assert.equal(item.disposition, "scheduled_review");
  assert.equal(item.actionableNow, false);
  assert.equal(item.nextTrigger, "2026-09-10T00:00:00.000Z");
});

test("future Notion publication retry is scheduled instead of actionable source work", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_note: "[规格扩展:CLOSED] 已完成现有规格" },
    variants: [{
      id: 16,
      production_state: "qc_passed",
      publication_state: "assets_pending",
      publication_next_check_at: "2026-09-10T00:00:00.000Z"
    }],
    cleanupCandidate: { eligible: false, reasons: ["linked_variants_not_closed"] },
    now: "2026-08-29T00:00:00.000Z"
  });
  assert.equal(item.disposition, "scheduled_review");
  assert.equal(item.actionableNow, false);
  assert.equal(item.nextTrigger, "2026-09-10T00:00:00.000Z");
});

test("a requeued intake source is actionable before the completed work review date", () => {
  const item = classifySourceDisposition({
    source: { ...source, next_review_at: "2026-11-12T00:00:00.000Z" },
    variants: [],
    tasks: [{ task_type: "intake", status: "pending", reason: "new source needs expansion review" }],
    now: "2026-09-11T00:00:00.000Z"
  });
  assert.equal(item.disposition, "ai_action_pending");
  assert.equal(item.actionableNow, true);
  assert.equal(item.needsHumanConfirmation, false);
  assert.deepEqual(item.reasons, ["intake:pending"]);
});

test("a recently discovered bound source remains actionable after intake is consumed", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      discovered_at: "2026-09-10T00:00:00.000Z",
      next_review_at: "2026-11-12T00:00:00.000Z"
    },
    variants: [],
    now: "2026-09-11T00:00:00.000Z"
  });
  assert.equal(item.disposition, "ai_action_pending");
  assert.equal(item.actionableNow, true);
  assert.deepEqual(item.reasons, ["source:newly_discovered"]);
});

test("a recently discovered split collection parent does not reopen intake after its leaves are bound", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      work_id: null,
      canonical_title: null,
      source_kind: "folder",
      discovered_at: "2026-09-10T00:00:00.000Z",
      next_review_at: "2026-11-12T00:00:00.000Z"
    },
    tasks: [{
      task_type: "intake",
      status: "done",
      reason: "父合集已拆分；全部成员源已绑定"
    }],
    variants: [],
    now: "2026-09-11T00:00:00.000Z"
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.deepEqual(item.reasons, ["collection_members_tracked_separately"]);
});

test("an explicitly deferred recent source does not reopen as new intake work", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      discovered_at: "2026-09-10T00:00:00.000Z",
      workflow_status: "暂缓",
      workflow_note: "[规格扩展:CLOSED] 已确认无中文字幕，等待未来补字幕"
    },
    variants: [],
    now: "2026-09-11T00:00:00.000Z"
  });
  assert.equal(item.disposition, "source_expansion_closed");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.match(item.nextTrigger, /扩展已关闭/u);
});

test("a deferred source exposes the latest Workflow Note as its recovery trigger", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      workflow_status: "暂缓",
      workflow_note: "【AI(^_^) 2026-09-16】已建立条目\n【AI(^_^) 2026-09-17】待补中文字幕证据后再评估"
    },
    variants: []
  });
  assert.equal(item.disposition, "deferred_without_review_time");
  assert.equal(item.nextTrigger, "【AI(^_^) 2026-09-17】待补中文字幕证据后再评估");
});

test("a paused completed episode source waits for its explicit new-episode trigger", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      workflow_status: "暂缓",
      workflow_note: "已有E05并完成发布。\n触发条件：新集片源进入启用输入目录时继续制作"
    },
    variants: [{ id: 41, production_state: "qc_passed", publication_state: "sync_ready" }],
    cleanupCandidate: { eligible: false, reasons: ["source_expansion_open", "source_media_not_fully_covered"] }
  });
  assert.equal(item.disposition, "deferred_without_review_time");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.equal(item.nextTrigger, "新集片源进入启用输入目录时继续制作");
});

test("a paused source without an explicit recovery trigger remains reviewable", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_status: "暂缓", workflow_note: "目前已有一集，剩余覆盖待评估" },
    variants: [{ id: 42, production_state: "qc_passed", publication_state: "sync_ready" }],
    cleanupCandidate: { eligible: false, reasons: ["source_media_not_fully_covered"] }
  });
  assert.equal(item.disposition, "source_coverage_review");
  assert.equal(item.actionableNow, true);
});

test("an open expansion marker retains a source without creating a phantom task", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_note: "[规格扩展:OPEN] 未来有新音轨时再评估" },
    variants: [{ id: 11, production_state: "qc_passed", publication_state: "sync_ready" }],
    cleanupCandidate: { eligible: false, reasons: ["source_expansion_open"] }
  });
  assert.equal(item.disposition, "retained_for_open_expansion");
  assert.equal(item.actionableNow, false);
  assert.match(item.nextTrigger, /新增音轨/u);
});

test("unbound source cannot disappear behind an empty production lane", () => {
  const item = classifySourceDisposition({ source: { ...source, work_id: null, canonical_title: null, workflow_status: null, workflow_note: null } });
  assert.equal(item.disposition, "identity_review_required");
  assert.equal(item.actionableNow, true);
});

test("an input containing only qBittorrent partial files waits for completion", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wwp-source-partial-"));
  const stream = path.join(root, "BDMV", "STREAM");
  mkdirSync(stream, { recursive: true });
  writeFileSync(path.join(stream, "00800.m2ts.!qB"), "partial");
  const item = classifySourceDisposition({
    source: { ...source, absolute_path: root, workflow_status: null, workflow_note: null, variants: [] },
    variants: []
  });
  assert.equal(item.disposition, "source_download_incomplete");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.match(item.nextTrigger, /下载完成/u);
});

test("a verified subtitle absence becomes actionable subtitle acquisition instead of disappearing", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      subtitle_evidence: '{"internalProbeState":"completed","no_chinese_subtitles":true,"verifiedChinese":false}',
      audio_evidence: '{"originalAudio":"eng"}',
      workflow_status: null,
      workflow_note: null
    },
    variants: []
  });
  assert.equal(item.disposition, "subtitle_acquisition_required");
  assert.equal(item.actionableNow, true);
  assert.equal(item.needsHumanConfirmation, false);
  assert.deepEqual(item.reasons, ["missing_chinese_subtitle"]);
});

test("an open subtitle acquisition task is reported as AI-actionable work", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      quality_state: "subtitle_missing",
      subtitle_evidence: '{"verifiedChinese":false}',
      audio_evidence: '{"originalAudio":"eng"}',
      workflow_status: null,
      workflow_note: null
    },
    variants: [],
    tasks: [{ task_type: "subtitle_acquisition", status: "pending", reason: "collect candidates" }]
  });
  assert.equal(item.disposition, "subtitle_acquisition_pending");
  assert.equal(item.actionableNow, true);
  assert.equal(item.needsHumanConfirmation, false);
});

test("a recent source with a concrete subtitle task does not fall back to generic intake", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      discovered_at: "2026-09-10T00:00:00.000Z",
      quality_state: "subtitle_missing",
      subtitle_evidence: '{"hardGate":"missing_chinese_subtitle","verifiedChinese":false}',
      audio_evidence: '{"originalAudio":"eng"}',
      workflow_status: null,
      workflow_note: null
    },
    variants: [],
    tasks: [{ task_type: "subtitle_acquisition", status: "pending", reason: "collect candidates" }],
    now: "2026-09-11T00:00:00.000Z"
  });
  assert.equal(item.disposition, "subtitle_acquisition_pending");
  assert.equal(item.actionableNow, true);
  assert.equal(item.needsHumanConfirmation, false);
  assert.deepEqual(item.reasons, ["subtitle_acquisition:pending"]);
  assert.match(item.nextTrigger, /字幕获取任务/u);
});

test("legacy verifiedChinese false without an absence marker returns to production review", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      subtitle_evidence: '{"internalProbeState":"completed","verifiedChinese":false,"note":"unlabelled PGS"}',
      audio_evidence: '{"originalAudio":"eng"}',
      workflow_status: null,
      workflow_note: null
    },
    variants: []
  });
  assert.equal(item.disposition, "production_decision_missing");
  assert.equal(item.actionableNow, true);
  assert.equal(item.needsHumanConfirmation, false);
});

test("a completed collection container waits on its tracked members instead of reopening identity", () => {
  const item = classifySourceDisposition({
    source: { ...source, work_id: null, canonical_title: null, workflow_status: null, workflow_note: null },
    tasks: [{ task_type: "intake", status: "done", reason: "All 65 collection member sources have verified work identities" }]
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
});

test("missing Chinese subtitles on a tracked collection parent do not create a parent subtitle task", () => {
  const item = classifySourceDisposition({
    source: {
      ...source,
      work_id: null,
      canonical_title: null,
      source_kind: "folder",
      workflow_status: null,
      workflow_note: null,
      subtitle_evidence: JSON.stringify({
        internalProbeState: "completed",
        verifiedChinese: false,
        streams: [{ hasChineseSubtitle: false }]
      })
    },
    tasks: [{
      task_type: "intake",
      status: "done",
      reason: "All 2 collection member sources have verified work identities"
    }],
    variants: []
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.match(item.nextTrigger, /成员源各自闭环/u);
});

test("a parent directory with bound descendant sources is recognized as a collection container", () => {
  const item = classifySourceDisposition({
    source: { ...source, canonical_title: null, workflow_status: null, workflow_note: null },
    collectionMembersAlreadyTracked: true
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
});

test("a tracked collection parent is not reopened by a stale pending intake task", () => {
  const item = classifySourceDisposition({
    source: { ...source, work_id: 42, source_kind: "series_folder", canonical_title: "Tracked series", workflow_status: null, workflow_note: null },
    tasks: [{ task_type: "intake", status: "pending", reason: "Source contents changed" }],
    variants: [],
    collectionMembersAlreadyTracked: true
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
});

test("a tracked collection parent stays a container when it has placeholder variants", () => {
  const item = classifySourceDisposition({
    source: { ...source, work_id: null, source_kind: "folder", canonical_title: null, workflow_status: null, workflow_note: null },
    tasks: [{ task_type: "intake", status: "done", reason: "All collection member sources have verified work identities" }],
    variants: [{ id: 91, production_state: "deferred", publication_state: "cancelled" }],
    collectionMembersAlreadyTracked: true
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
});

test("a source registered twice at the same physical path is not a new production candidate", () => {
  const item = classifySourceDisposition({
    source,
    duplicateOfSourceId: 3,
    variants: []
  });
  assert.equal(item.disposition, "duplicate_source");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.match(item.nextTrigger, /源 3/u);
});

test("a subtitle bundle is companion evidence, not an independent production source", () => {
  const item = classifySourceDisposition({
    source: { ...source, source_kind: "subtitle_bundle", workflow_status: null },
    variants: []
  });
  assert.equal(item.disposition, "companion_evidence");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
});

test("missing Chinese subtitle is surfaced as human evidence instead of generic technical work", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_status: "暂缓", workflow_note: "等待中文字幕" },
    variants: [{ id: 12, production_state: "deferred", publication_state: "not_ready", failure_code: "missing_chinese_subtitle", failure_detail: "请提供或授权中文字幕" }]
  });
  assert.equal(item.disposition, "waiting_for_human");
  assert.equal(item.needsHumanConfirmation, true);
  assert.equal(item.nextTrigger, "请提供或授权中文字幕");
});

test("successful QC notes do not turn a released variant into a technical blocker", () => {
  const item = classifySourceDisposition({
    source,
    variants: [{
      id: 13,
      production_state: "qc_passed",
      publication_state: "sync_ready",
      failure_detail: "Full-duration QC passed"
    }],
    cleanupCandidate: { eligible: false, reasons: ["source_expansion_unresolved"] }
  });
  assert.equal(item.disposition, "expansion_decision_missing");
  assert.equal(item.reasons.includes("variant_failure"), false);
});

test("a prior quarantine move failure stays blocked even when its candidate is no longer eligible", () => {
  const item = classifySourceDisposition({
    source,
    variants: [{ id: 16, production_state: "qc_passed", publication_state: "sync_ready" }],
    cleanupCandidate: { eligible: false, reasons: ["previous_quarantine_move_failed"] },
    events: [{ entity_type: "source", event_type: "source_quarantine_failed", payload_json: "{\"errorCode\":\"EBUSY\"}" }]
  });
  assert.equal(item.disposition, "cleanup_move_failed");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
  assert.match(item.nextTrigger, /解除文件占用/u);
});

test("a pending source reinspection supersedes the stale quarantine-lock trigger", () => {
  const item = classifySourceDisposition({
    source,
    tasks: [{ task_type: "intake", status: "pending", reason: "Inspect newly discovered long BDMV streams" }],
    cleanupCandidate: { eligible: false, reasons: ["source_intake_task_open", "previous_quarantine_move_failed"] },
    events: [{ entity_type: "source", event_type: "source_quarantine_failed", payload_json: "{\"errorCode\":\"EBUSY\"}" }]
  });
  assert.equal(item.disposition, "ai_action_pending");
  assert.equal(item.actionableNow, true);
  assert.equal(item.nextTrigger, "Inspect newly discovered long BDMV streams");
  assert.ok(item.reasons.includes("previous_quarantine_move_failed"));
  assert.ok(item.evidence.some((entry) => entry.type === "quarantine_failure"));
});

test("a season placeholder superseded by episode targets does not block the closed episode set", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_note: "[规格扩展:CLOSED] 本季按 episode 独立交付" },
    variants: [
      { id: 14, production_state: "deferred", publication_state: "not_ready", failure_code: "superseded_by_episode_targets" },
      { id: 15, production_state: "qc_passed", publication_state: "sync_ready" }
    ],
    cleanupCandidate: { eligible: false, reasons: ["source_expansion_unresolved"] }
  });
  assert.equal(item.disposition, "expansion_decision_missing");
  assert.equal(item.reasons.includes("variant_failure"), false);
});

test("a source without its own variant stays closed when the work explicitly closed expansion", () => {
  const item = classifySourceDisposition({
    source: { ...source, workflow_note: "[规格扩展:CLOSED] 已完成现有规格" },
    variants: []
  });
  assert.equal(item.disposition, "source_expansion_closed");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, false);
});

test("summary retains residue, human, cleanup, and scheduled counts", () => {
  const summary = summarizeSourceDispositions([
    { disposition: "cleanup_ready", actionableNow: true, needsHumanConfirmation: false },
    { disposition: "cleanup_move_failed", actionableNow: false, needsHumanConfirmation: false },
    { disposition: "scheduled_review", actionableNow: false, needsHumanConfirmation: false }
  ]);
  assert.deepEqual(summary, {
    residualSourceCount: 3,
    actionableNow: 1,
    needsHumanConfirmation: 0,
    cleanupReady: 1,
    cleanupMoveFailed: 1,
    scheduledReview: 1,
    byDisposition: { cleanup_ready: 1, cleanup_move_failed: 1, scheduled_review: 1 },
    byInputRoot: {}
  });
});
