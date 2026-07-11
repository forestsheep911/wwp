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
  "sync_ready"
]);

const productionTransitions = Object.freeze({
  discovered: ["evaluated", "deferred", "rejected"],
  evaluated: ["selected", "deferred", "rejected"],
  selected: ["encoding", "deferred", "rejected"],
  encoding: ["qc_failed", "qc_passed"],
  qc_failed: ["selected", "deferred", "rejected"],
  deferred: ["evaluated", "selected", "rejected"],
  qc_passed: [],
  rejected: []
});

const publicationTransitions = Object.freeze({
  not_ready: ["structure_pending"],
  structure_pending: ["upload_pending"],
  upload_pending: ["upload_seen"],
  upload_seen: ["assets_pending"],
  assets_pending: ["verification_pending"],
  verification_pending: ["sync_ready", "assets_pending", "structure_pending"],
  sync_ready: []
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
