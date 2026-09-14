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
  recoverStaleInProgress,
  resumeAuthorizedPeopleStage,
  settlePeopleStageFromCoverage,
  updateEnrichmentStage,
  writeEnrichmentCampaign
} from "./work-enrichment-campaign.mjs";

test("post-publish people coverage returns a partial work to pending", () => {
  const now = "2026-09-13T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_house_s6",
    pageId: "page-house-s6",
    metadataStatus: "verified"
  }], { now });
  ({ state } = updateEnrichmentStage(state, { externalWorkId: "wwm_house_s6" }, {
    stage: "people",
    status: "in_progress",
    reason: "publishing reviewed sub-batch"
  }, { now }));
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_house_s6" }, {
    candidates: [{
      workId: "wwm_house_s6",
      sourcePageId: "page-house-s6",
      status: "partially_linked",
      creditCount: 30,
      linkedCreditCount: 9,
      unlinkedCreditCount: 21,
      unlinkedCredits: [
        { name: "Example Actor", department: "acting", character: "Guest", externalIds: { imdb: "nm1234567" } },
        { name: "Example Writer", department: "writing", job: "Screenwriter" }
      ]
    }]
  }, { now: "2026-09-13T01:00:00.000Z" });
  assert.equal(result.work.stages.people.status, "pending");
  assert.match(result.work.stages.people.reason, /9\/30 linked with 21 canonical credits remaining/);
  assert.match(result.work.stages.people.reason, /Residual credits are saved in coverageResiduals/);
  assert.deepEqual(result.work.stages.people.missingFields, ["21 unlinked canonical credits"]);
  assert.equal(result.work.stages.people.coverageResiduals[0].name, "Example Actor");
  assert.equal(result.work.stages.people.coverageResiduals[0].externalIds.imdb, "nm1234567");
  assert.match(result.work.stages.people.nextTrigger, /exact work-credit evidence/);
});

test("post-publish people coverage completes a fully linked work from the all-works collection", () => {
  const now = "2026-09-13T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_complete",
    metadataStatus: "verified"
  }], { now });
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_complete" }, {
    candidates: [],
    works: [{ workId: "wwm_complete", status: "fully_linked", creditCount: 3, linkedCreditCount: 3, unlinkedCreditCount: 0 }]
  }, { now });
  assert.equal(result.work.stages.people.status, "completed");
});

test("authoritative coverage clears a stale people waiting-user reason", () => {
  const now = "2026-09-13T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_metadata_only",
    pageId: "page-metadata-only",
    metadataStatus: "verified"
  }], { now });
  ({ state } = updateEnrichmentStage(state, { externalWorkId: "wwm_metadata_only" }, {
    stage: "people",
    status: "waiting_user",
    reason: "metadata-only publication path was unavailable",
    humanConfirmationReasons: ["choose a publication path"]
  }, { now }));

  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_metadata_only" }, {
    works: [{
      workId: "wwm_metadata_only",
      sourcePageId: "page-metadata-only",
      status: "fully_linked",
      creditCount: 12,
      linkedCreditCount: 12,
      unlinkedCreditCount: 0
    }]
  }, { now: "2026-09-13T02:00:00.000Z" });

  assert.equal(result.work.stages.people.status, "completed");
  assert.equal(result.work.stages.people.reason, null);
  assert.deepEqual(result.work.stages.people.humanConfirmationReasons, []);
});

test("post-publish people coverage rejects inconsistent counts", () => {
  const now = "2026-09-13T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_invalid",
    metadataStatus: "verified"
  }], { now });
  assert.throws(() => settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_invalid" }, {
    candidates: [{ workId: "wwm_invalid", status: "partially_linked", creditCount: 5, linkedCreditCount: 2, unlinkedCreditCount: 2 }]
  }, { now }), /counts are inconsistent/);
});

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

test("stage updates reject an external work id shared by multiple campaign items", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [
    { ledgerWorkId: 20, workId: "wwm_first", title: "Legacy carrier" },
    { ledgerWorkId: 21, workId: "wwm_second", title: "Canonical work" }
  ], { now });
  state.works[1].externalWorkId = "wwm_first";
  assert.throws(() => updateEnrichmentStage(state, { externalWorkId: "wwm_first" }, {
    stage: "base-metadata",
    status: "completed"
  }, { now }), /selector is ambiguous.*--item-key/);
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

test("a stable blocked stage does not hide independent work already in progress", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{ ledgerWorkId: 12 }], { now });
  const blocked = updateEnrichmentStage(state, { ledgerWorkId: 12 }, {
    stage: "base-metadata",
    status: "blocked",
    reason: "exact metadata readback is unavailable"
  }, { now }).state;
  const running = updateEnrichmentStage(blocked, { ledgerWorkId: 12 }, {
    stage: "people",
    status: "in_progress",
    reason: "reviewed people supplement is publishing"
  }, { now }).state;
  const report = buildEnrichmentCampaignReport(running, { now });
  assert.equal(report.due.length, 0);
  assert.equal(report.inProgress[0].currentStage, "people");
  assert.equal(report.inProgress[0].currentStatus, "in_progress");
  assert.equal(report.inProgress[0].actionableNow, false);
});

test("a future deferred stage can be bypassed but a due deferred stage cannot", () => {
  const now = "2026-09-06T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{ ledgerWorkId: 13 }], { now });
  const future = updateEnrichmentStage(state, { ledgerWorkId: 13 }, {
    stage: "base-metadata",
    status: "deferred",
    reason: "scheduled verification",
    nextReviewAt: "2026-09-07T00:00:00.000Z"
  }, { now }).state;
  assert.doesNotThrow(() => updateEnrichmentStage(future, { ledgerWorkId: 13 }, {
    stage: "people",
    status: "in_progress"
  }, { now }));
  assert.throws(() => updateEnrichmentStage(future, { ledgerWorkId: 13 }, {
    stage: "people",
    status: "in_progress"
  }, { now: "2026-09-08T00:00:00.000Z" }), /before current stage base-metadata/);
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

test("stale in-progress claims are recovered to deferred with an explicit trigger", () => {
  const started = "2026-09-06T00:00:00.000Z";
  const now = "2026-09-06T07:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(started), [{ ledgerWorkId: 77 }], { now: started });
  ({ state } = updateEnrichmentStage(state, { ledgerWorkId: 77 }, {
    stage: "base-metadata",
    status: "in_progress",
    reason: "Notion readback timed out"
  }, { now: started }));

  const result = recoverStaleInProgress(state, { now });
  assert.deepEqual(result.recovered.map((item) => item.key), ["ledger:77"]);
  const recovered = result.state.works[0].stages["base-metadata"];
  assert.equal(recovered.status, "deferred");
  assert.match(recovered.reason, /Notion readback timed out/u);
  assert.match(recovered.nextTrigger, /重新认领并记录结果/u);
  assert.equal(recovered.nextReviewAt, "2026-09-06T08:00:00.000Z");
  assert.equal(buildEnrichmentCampaignReport(result.state, { now }).summary.actionableNow, 0);
});

test("fresh in-progress claims remain active but are not actionable", () => {
  const now = "2026-09-06T01:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{ ledgerWorkId: 78 }], { now });
  ({ state } = updateEnrichmentStage(state, { ledgerWorkId: 78 }, {
    stage: "base-metadata",
    status: "in_progress",
    reason: "metadata query is running"
  }, { now }));
  const result = recoverStaleInProgress(state, { now: "2026-09-06T05:00:00.000Z" });
  assert.deepEqual(result.recovered, []);
  const report = buildEnrichmentCampaignReport(result.state, { now: "2026-09-06T05:00:00.000Z" });
  assert.equal(report.due.length, 0);
  assert.equal(report.inProgress[0].currentStatus, "in_progress");
  assert.equal(report.summary.inProgress, 1);
});

test("an explicit people objective can resume a clean preflight without another blanket review", () => {
  const now = "2026-09-13T00:00:00.000Z";
  const reportPath = "C:\\batch\\reviewed-report.json";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    externalWorkId: "work-people",
    metadataStatus: "verified",
    peopleStatus: "missing",
    humanConfirmationReasons: ["legacy blanket review"]
  }], { now });
  const result = resumeAuthorizedPeopleStage(state, { externalWorkId: "work-people" }, {
    preflight: { status: "ready_for_authorized_apply", reportPath },
    reportPath,
    now
  });
  assert.equal(result.work.stages.people.status, "in_progress");
  assert.deepEqual(result.work.stages.people.humanConfirmationReasons, []);
});

test("authorize-people preserves genuine identity gates", () => {
  const now = "2026-09-13T00:00:00.000Z";
  const reportPath = "C:\\batch\\reviewed-report.json";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    externalWorkId: "work-people",
    metadataStatus: "verified",
    peopleStatus: "missing",
    humanConfirmationReasons: ["ambiguous identity"]
  }], { now });
  assert.throws(() => resumeAuthorizedPeopleStage(state, { externalWorkId: "work-people" }, {
    preflight: { status: "waiting_user", reportPath },
    reportPath,
    now
  }), /not ready/);
});
