import assert from "node:assert/strict";
import test from "node:test";
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

test("a failed quarantine move becomes an explicit human-visible blocker", () => {
  const item = classifySourceDisposition({
    source,
    cleanupCandidate: { eligible: true, reasons: [] },
    events: [{ event_type: "source_quarantine_failed", payload_json: '{"errorCode":"EPERM"}' }]
  });
  assert.equal(item.disposition, "cleanup_move_failed");
  assert.equal(item.needsHumanConfirmation, true);
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

test("a verified subtitle absence waits for subtitles instead of becoming a production decision", () => {
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
  assert.equal(item.disposition, "waiting_for_human");
  assert.equal(item.actionableNow, false);
  assert.equal(item.needsHumanConfirmation, true);
  assert.deepEqual(item.reasons, ["missing_chinese_subtitle"]);
});

test("a completed collection container waits on its tracked members instead of reopening identity", () => {
  const item = classifySourceDisposition({
    source: { ...source, work_id: null, canonical_title: null, workflow_status: null, workflow_note: null },
    tasks: [{ task_type: "intake", status: "done", reason: "All 65 collection member sources have verified work identities" }]
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
});

test("a parent directory with bound descendant sources is recognized as a collection container", () => {
  const item = classifySourceDisposition({
    source: { ...source, canonical_title: null, workflow_status: null, workflow_note: null },
    collectionMembersAlreadyTracked: true
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
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
    { disposition: "cleanup_move_failed", actionableNow: true, needsHumanConfirmation: true },
    { disposition: "scheduled_review", actionableNow: false, needsHumanConfirmation: false }
  ]);
  assert.deepEqual(summary, {
    residualSourceCount: 3,
    actionableNow: 2,
    needsHumanConfirmation: 1,
    cleanupReady: 1,
    cleanupMoveFailed: 1,
    scheduledReview: 1,
    byDisposition: { cleanup_ready: 1, cleanup_move_failed: 1, scheduled_review: 1 },
    byInputRoot: {}
  });
});
