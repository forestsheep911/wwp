export const PRODUCTION_STATES = Object.freeze([
  "discovered",
  "evaluated",
  "selected",
  "encoding",
  "qc_failed",
  "deferred",
  "qc_passed",
  "rejected"
]);

export const PUBLICATION_STATES = Object.freeze([
  "not_ready",
  "structure_pending",
  "upload_pending",
  "upload_seen",
  "assets_pending",
  "verification_pending",
  "sync_ready",
  "cancelled"
]);

export const WORKFLOW_HANDOFF_STATES = Object.freeze([
  "待 AI 处理",
  "AI 处理中",
  "待人工上传",
  "人工上传中",
  "已上传待 AI 收尾",
  "待人工确认",
  "已确认待 AI 发布",
  "已完成",
  "暂缓"
]);

export const AI_ACTIONABLE_WORKFLOW_STATES = Object.freeze([
  "待 AI 处理",
  "已上传待 AI 收尾",
  "已确认待 AI 发布"
]);

const workflowHandoffTransitions = Object.freeze({
  "待 AI 处理": ["AI 处理中", "暂缓"],
  "AI 处理中": ["待人工上传", "待人工确认", "已完成", "暂缓"],
  "待人工上传": ["人工上传中", "已上传待 AI 收尾", "AI 处理中", "暂缓"],
  "人工上传中": ["已上传待 AI 收尾", "暂缓"],
  "已上传待 AI 收尾": ["AI 处理中", "待人工上传", "暂缓"],
  "待人工确认": ["已确认待 AI 发布", "待 AI 处理", "暂缓"],
  "已确认待 AI 发布": ["AI 处理中", "暂缓"],
  // A completed work can gain a distinct supplementary specification, such as
  // a newly prepared regional dub that now needs a human upload.
  "已完成": ["待 AI 处理", "待人工上传"],
  "暂缓": ["待 AI 处理"]
});

const productionTransitions = Object.freeze({
  discovered: ["evaluated", "deferred", "rejected"],
  evaluated: ["selected", "deferred", "rejected"],
  selected: ["encoding", "deferred", "rejected"],
  encoding: ["qc_failed", "qc_passed"],
  qc_failed: ["selected", "deferred", "rejected"],
  deferred: ["evaluated", "selected", "rejected"],
  // A QC-passed output may still be intentionally retired before upload.
  qc_passed: ["rejected"],
  rejected: []
});

const publicationTransitions = Object.freeze({
  not_ready: ["structure_pending", "cancelled"],
  structure_pending: ["upload_pending", "cancelled"],
  upload_pending: ["upload_seen", "cancelled"],
  upload_seen: ["assets_pending", "cancelled"],
  assets_pending: ["verification_pending", "cancelled"],
  verification_pending: ["sync_ready", "assets_pending", "structure_pending", "cancelled"],
  // A repaired/replaced Notion media block must repeat exact readback before it
  // can retain sync_ready, even when it belongs to an already released variant.
  sync_ready: ["structure_pending"],
  cancelled: []
});

function assertTransition(kind, transitions, from, to) {
  if (!transitions[from]?.includes(to)) {
    throw new Error(`illegal ${kind} transition: ${from} -> ${to}`);
  }
  return true;
}

export function assertProductionTransition(from, to) {
  return assertTransition("production", productionTransitions, from, to);
}

export function assertPublicationTransition(from, to) {
  return assertTransition("publication", publicationTransitions, from, to);
}

export function assertWorkflowHandoffState(value) {
  if (!WORKFLOW_HANDOFF_STATES.includes(value)) {
    throw new Error(`unsupported workflow handoff state: ${value}`);
  }
  return true;
}

export function assertWorkflowHandoffTransition(from, to) {
  assertWorkflowHandoffState(to);
  if (from == null || from === "") return true;
  if (from === to) return true;
  return assertTransition("workflow handoff", workflowHandoffTransitions, from, to);
}

export function isSyncReady(evidence = {}) {
  return evidence.qcPassed === true
    && evidence.structureVerified === true
    && evidence.mediaVerified === true
    && evidence.assetsVerified === true;
}

export function nextRetryAt({ now, attemptCount, rateLimited }) {
  const baseTime = new Date(now);
  if (Number.isNaN(baseTime.getTime())) {
    throw new TypeError(`invalid retry base time: ${now}`);
  }

  const retryMinutes = [5, 15, 30, 60];
  const normalizedAttempt = Math.max(1, Math.trunc(Number(attemptCount)) || 1);
  const delayMinutes = rateLimited === true
    ? 60
    : retryMinutes[Math.min(normalizedAttempt - 1, retryMinutes.length - 1)];

  return new Date(baseTime.getTime() + delayMinutes * 60_000).toISOString();
}

export function normalizeLimit(value, fallback, maximum) {
  const upperBound = Math.max(1, Math.trunc(Number(maximum)) || 1);
  const parsed = value === undefined ? Number(fallback) : Number(value);
  const candidate = Number.isFinite(parsed) ? Math.trunc(parsed) : Math.trunc(Number(fallback));
  return Math.min(upperBound, Math.max(1, Number.isFinite(candidate) ? candidate : 1));
}
