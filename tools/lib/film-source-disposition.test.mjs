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

test("unbound source cannot disappear behind an empty production lane", () => {
  const item = classifySourceDisposition({ source: { ...source, work_id: null, canonical_title: null, workflow_status: null, workflow_note: null } });
  assert.equal(item.disposition, "identity_review_required");
  assert.equal(item.actionableNow, true);
});

test("a completed collection container waits on its tracked members instead of reopening identity", () => {
  const item = classifySourceDisposition({
    source: { ...source, work_id: null, canonical_title: null, workflow_status: null, workflow_note: null },
    tasks: [{ task_type: "intake", status: "done", reason: "All 65 collection member sources have verified work identities" }]
  });
  assert.equal(item.disposition, "collection_container_active");
  assert.equal(item.actionableNow, false);
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
