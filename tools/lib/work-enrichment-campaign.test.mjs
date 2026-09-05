import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildEnrichmentCampaignReport,
  emptyEnrichmentCampaign,
  enqueueEnrichmentWorks,
  readEnrichmentCampaign,
  updateEnrichmentStage,
  writeEnrichmentCampaign
} from "./work-enrichment-campaign.mjs";

test("enrichment campaign preserves a serial next stage for each work", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_example",
    metadataStatus: "verified",
    peopleStatus: "partial",
    keyCreatorsVerified: false,
    peopleMissingFields: ["principal_cast"],
    honorsStatus: "verified",
    highlightStatus: "not_started"
  }], { source: "historical_backfill", now });
  const report = buildEnrichmentCampaignReport(state, { now });
  assert.equal(report.due.length, 1);
  assert.equal(report.due[0].currentStage, "people");
  assert.equal(report.due[0].nextAction, "run_wwp_people_curator");
  assert.deepEqual(report.due[0].missingFields, ["principal_cast"]);
});

test("human confirmation and scheduled review remain visible instead of becoming idle", () => {
  const now = "2026-09-06T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_human",
    metadataStatus: "verified",
    peopleStatus: "partial",
    keyCreatorsVerified: false,
    peopleMissingFields: ["relation_path"],
    honorsStatus: "verified",
    humanConfirmationReasons: ["choose canonical relation path"]
  }, {
    workId: "wwm_later",
    metadataStatus: "verified",
    peopleStatus: "verified",
    keyCreatorsVerified: true,
    honorsStatus: "verified"
  }], { now });
  ({ state } = updateEnrichmentStage(state, { externalWorkId: "wwm_later" }, {
    stage: "highlights",
    status: "deferred",
    reason: "source review scheduled",
    nextReviewAt: "2026-09-10T00:00:00.000Z"
  }, { now }));
  const report = buildEnrichmentCampaignReport(state, { now });
  assert.equal(report.summary.waitingForHuman, 1);
  assert.equal(report.summary.scheduledReview, 1);
  assert.equal(report.summary.actionableNow, 0);
});

test("completed stage advances to the next serial stage and state round-trips", () => {
  const now = "2026-09-06T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{ ledgerWorkId: 42 }], { now });
  assert.equal(buildEnrichmentCampaignReport(state, { now }).due[0].currentStage, "base-metadata");
  ({ state } = updateEnrichmentStage(state, { ledgerWorkId: 42 }, {
    stage: "base-metadata",
    status: "completed"
  }, { now }));
  assert.equal(buildEnrichmentCampaignReport(state, { now }).due[0].currentStage, "people");

  const dir = mkdtempSync(path.join(tmpdir(), "wwp-enrichment-campaign-"));
  try {
    const file = path.join(dir, "state.json");
    writeEnrichmentCampaign(file, state);
    assert.deepEqual(readEnrichmentCampaign(file), state);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enqueue is idempotent and merges stronger identity", () => {
  const now = "2026-09-06T00:00:00.000Z";
  let result = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{ ledgerWorkId: 9, title: "Example" }], { now });
  result = enqueueEnrichmentWorks(result.state, [{ ledgerWorkId: 9, workId: "wwm_9", pageId: "page-9" }], { now });
  assert.equal(result.state.works.length, 1);
  assert.equal(result.state.works[0].externalWorkId, "wwm_9");
  assert.equal(result.state.works[0].pageId, "page-9");
  assert.deepEqual(result.existing, ["ledger:9"]);
});

test("saved highlight drafts remain actionable without pretending a worker is active", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_draft",
    metadataStatus: "verified",
    peopleStatus: "verified",
    keyCreatorsVerified: true,
    honorsStatus: "verified",
    highlightStatus: "draft"
  }], { now });
  const report = buildEnrichmentCampaignReport(state, { now });
  assert.equal(report.due[0].currentStatus, "draft");
  assert.equal(report.due[0].actionableNow, true);
});

test("only the current serial stage can become in progress", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{ ledgerWorkId: 10 }], { now });
  assert.throws(() => updateEnrichmentStage(state, { ledgerWorkId: 10 }, {
    stage: "people",
    status: "in_progress"
  }, { now }), /before current stage base-metadata/);
});

test("non-actionable outcomes require a concrete recovery condition", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{ ledgerWorkId: 11 }], { now });
  assert.throws(() => updateEnrichmentStage(state, { ledgerWorkId: 11 }, {
    stage: "base-metadata",
    status: "deferred"
  }, { now }), /requires a valid nextReviewAt/);
  assert.throws(() => updateEnrichmentStage(state, { ledgerWorkId: 11 }, {
    stage: "base-metadata",
    status: "blocked"
  }, { now }), /requires a reason or missing field/);
  assert.throws(() => updateEnrichmentStage(state, { ledgerWorkId: 11 }, {
    stage: "base-metadata",
    status: "waiting_user"
  }, { now }), /requires a reason or human confirmation/);
});
