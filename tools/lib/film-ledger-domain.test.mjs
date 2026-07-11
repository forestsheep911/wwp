import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_STATES,
  PUBLICATION_STATES,
  assertProductionTransition,
  assertPublicationTransition,
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
  assert.throws(() => assertProductionTransition("discovered", "qc_passed"), /illegal production transition/);
  assert.throws(() => assertProductionTransition("unknown", "evaluated"), /illegal production transition/);
});

test("publication transitions enforce legal adjacency", () => {
  assert.deepEqual(PUBLICATION_STATES, ["not_ready", "structure_pending", "upload_pending", "upload_seen", "assets_pending", "verification_pending", "sync_ready"]);
  assert.equal(assertPublicationTransition("not_ready", "structure_pending"), true);
  assert.equal(assertPublicationTransition("verification_pending", "assets_pending"), true);
  assert.equal(assertPublicationTransition("verification_pending", "structure_pending"), true);
  assert.throws(() => assertPublicationTransition("upload_pending", "sync_ready"), /illegal publication transition/);
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
