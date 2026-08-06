import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_STATES,
  PUBLICATION_STATES,
  WORKFLOW_HANDOFF_STATES,
  AI_ACTIONABLE_WORKFLOW_STATES,
  assertProductionTransition,
  assertPublicationTransition,
  assertWorkflowHandoffState,
  assertWorkflowHandoffTransition,
  isSyncReady,
  nextRetryAt,
  normalizeLimit
} from "./film-ledger-domain.mjs";

test("qc_passed does not imply final sync readiness", () => {
  assert.equal(isSyncReady({ qcPassed: true, structureVerified: false, mediaVerified: false, assetsVerified: false }), false);
  assert.equal(isSyncReady({ qcPassed: true, structureVerified: true, mediaVerified: true, assetsVerified: true }), true);
});

test("production transitions enforce legal adjacency", () => {
  assert.deepEqual(PRODUCTION_STATES, ["discovered", "evaluated", "selected", "encoding", "qc_failed", "deferred", "qc_passed", "rejected"]);
  assert.equal(assertProductionTransition("discovered", "evaluated"), true);
  assert.equal(assertProductionTransition("qc_failed", "selected"), true);
  assert.equal(assertProductionTransition("deferred", "evaluated"), true);
  assert.equal(assertProductionTransition("qc_passed", "rejected"), true);
  assert.throws(() => assertProductionTransition("discovered", "qc_passed"), /illegal production transition/);
  assert.throws(() => assertProductionTransition("unknown", "evaluated"), /illegal production transition/);
});

test("publication transitions enforce legal adjacency", () => {
  assert.deepEqual(PUBLICATION_STATES, ["not_ready", "structure_pending", "upload_pending", "upload_seen", "assets_pending", "verification_pending", "sync_ready", "cancelled"]);
  assert.equal(assertPublicationTransition("not_ready", "structure_pending"), true);
  assert.equal(assertPublicationTransition("verification_pending", "assets_pending"), true);
  assert.equal(assertPublicationTransition("verification_pending", "structure_pending"), true);
  assert.equal(assertPublicationTransition("assets_pending", "cancelled"), true);
  assert.throws(() => assertPublicationTransition("upload_pending", "sync_ready"), /illegal publication transition/);
});

test("workflow handoff states provide an explicit human and AI exchange", () => {
  assert.deepEqual(WORKFLOW_HANDOFF_STATES, [
    "待 AI 处理", "AI 处理中", "待人工上传", "人工上传中", "已上传待 AI 收尾",
    "待人工确认", "已确认待 AI 发布", "已完成", "暂缓"
  ]);
  assert.deepEqual(AI_ACTIONABLE_WORKFLOW_STATES, ["待 AI 处理", "已上传待 AI 收尾", "已确认待 AI 发布"]);
  assert.equal(assertWorkflowHandoffState("人工上传中"), true);
  assert.equal(assertWorkflowHandoffTransition("已上传待 AI 收尾", "AI 处理中"), true);
  assert.equal(assertWorkflowHandoffTransition("已完成", "待 AI 处理"), true);
  assert.equal(assertWorkflowHandoffTransition("已完成", "待人工上传"), true);
  assert.equal(assertWorkflowHandoffTransition(null, "待人工上传"), true);
  assert.equal(assertWorkflowHandoffTransition("待人工上传", "待人工上传"), true);
  assert.throws(() => assertWorkflowHandoffState("unknown"), /unsupported workflow handoff state/);
  assert.throws(() => assertWorkflowHandoffTransition("人工上传中", "已完成"), /illegal workflow handoff transition/);
});

test("Notion 429 opens a sixty minute retry window", () => {
  assert.equal(nextRetryAt({ now: "2026-07-12T00:00:00.000Z", attemptCount: 1, rateLimited: true }), "2026-07-12T01:00:00.000Z");
});

test("ordinary failures use bounded 5, 15, 30, and 60 minute retry delays", () => {
  const now = "2026-07-12T00:00:00.000Z";
  assert.equal(nextRetryAt({ now, attemptCount: 1, rateLimited: false }), "2026-07-12T00:05:00.000Z");
  assert.equal(nextRetryAt({ now, attemptCount: 2, rateLimited: false }), "2026-07-12T00:15:00.000Z");
  assert.equal(nextRetryAt({ now, attemptCount: 3, rateLimited: false }), "2026-07-12T00:30:00.000Z");
  assert.equal(nextRetryAt({ now, attemptCount: 4, rateLimited: false }), "2026-07-12T01:00:00.000Z");
  assert.equal(nextRetryAt({ now, attemptCount: 9, rateLimited: false }), "2026-07-12T01:00:00.000Z");
});

test("queue limits stay bounded", () => {
  assert.equal(normalizeLimit(undefined, 5, 5), 5);
  assert.equal(normalizeLimit(99, 5, 5), 5);
  assert.equal(normalizeLimit(2, 5, 5), 2);
  assert.equal(normalizeLimit(0, 5, 5), 1);
  assert.equal(normalizeLimit("3", 5, 5), 3);
  assert.equal(normalizeLimit("invalid", 5, 5), 5);
});
