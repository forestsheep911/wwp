import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildEnrichmentCampaignReport,
  assertAuthoritativePeopleCoverage,
  deferPeopleStageForCoverageFailure,
  emptyEnrichmentCampaign,
  enqueueEnrichmentWorks,
  isTransientEnrichmentFailure,
  readEnrichmentCampaign,
  recoverStaleInProgress,
  resumeAuthorizedPeopleStage,
  settlePeopleStageFromCoverage,
  reclassifyTransientBlockedStages,
  updateEnrichmentStage,
  writeEnrichmentCampaign
} from "./work-enrichment-campaign.mjs";

test("production People settlement rejects coverage that is not explicitly Azure", () => {
  assert.throws(
    () => assertAuthoritativePeopleCoverage({ searchStore: "local:movieindex" }),
    /requires an Azure coverage audit/
  );
  assert.equal(assertAuthoritativePeopleCoverage({ searchStore: "local:movieindex" }, { allowLocal: true }), "local:movieindex");
  assert.equal(assertAuthoritativePeopleCoverage({ searchStore: "azure:stwwcache/movieindex" }), "azure:stwwcache/movieindex");
});

test("authoritative coverage failure is recorded as a scheduled retry", () => {
  const now = "2026-09-16T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_provider_gap",
    metadataStatus: "verified"
  }], { now });
  const result = deferPeopleStageForCoverageFailure(
    state,
    { externalWorkId: "wwm_provider_gap" },
    new Error("production People settlement requires an Azure coverage audit (searchStore=azure:*)"),
    { now }
  );
  const people = result.work.stages.people;
  assert.equal(people.status, "deferred");
  assert.equal(people.nextReviewAt, "2026-09-16T06:00:00.000Z");
  assert.match(people.reason, /权威人物覆盖读回失败/u);
  assert.match(people.reason, /Azure coverage audit/u);
  assert.match(people.nextTrigger, /重新生成 Azure/u);
});

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
  assert.equal(result.work.stages.people.coverageAttempts, 1);
  const report = buildEnrichmentCampaignReport(result.state, { now });
  assert.equal(report.due[0].nextAction, "run_wwp_people_targeted_supplement");
});

test("coverage settlement prefers an exact target over a stale candidate snapshot", () => {
  const now = "2026-09-17T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_target_precedence",
    pageId: "page-target-precedence",
    metadataStatus: "verified"
  }], { now });
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_target_precedence" }, {
    candidates: [{
      workId: "wwm_target_precedence",
      sourcePageId: "page-target-precedence",
      status: "partially_linked",
      creditCount: 34,
      linkedCreditCount: 14,
      unlinkedCreditCount: 20,
      unlinkedCredits: [{ name: "Stale residual", department: "acting" }]
    }],
    targets: [{
      workId: "wwm_target_precedence",
      sourcePageId: "page-target-precedence",
      status: "partially_linked",
      creditCount: 15,
      linkedCreditCount: 14,
      unlinkedCreditCount: 1,
      unlinkedCredits: [{ name: "Exact residual", department: "acting" }]
    }]
  }, { now });
  const people = result.work.stages.people;
  assert.equal(people.status, "pending");
  assert.equal(people.missingFields[0], "1 unlinked canonical credits");
  assert.equal(people.coverageResiduals[0].name, "Exact residual");
});

test("repeated identical people residuals become a work-local blocker", () => {
  const now = "2026-09-13T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_repeated_identity_gap",
    metadataStatus: "verified"
  }], { now });
  const coverage = {
    works: [{
      workId: "wwm_repeated_identity_gap",
      status: "partially_linked",
      creditCount: 4,
      linkedCreditCount: 3,
      unlinkedCreditCount: 1,
      unlinkedCredits: [{
        name: "Unresolved Credit",
        department: "acting",
        externalIds: {}
      }]
    }]
  };
  let result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_repeated_identity_gap" }, coverage, { now });
  assert.equal(result.work.stages.people.status, "pending");
  assert.equal(result.work.stages.people.coverageAttempts, 1);
  ({ state } = result);
  result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_repeated_identity_gap" }, coverage, {
    now: "2026-09-13T01:00:00.000Z"
  });
  const people = result.work.stages.people;
  assert.equal(people.status, "blocked");
  assert.equal(people.coverageAttempts, 2);
  assert.equal(people.coverageResiduals[0].name, "Unresolved Credit");
  assert.equal(people.nextTrigger, "new provider evidence or manual identity confirmation");
  assert.match(people.reason, /连续 2 次/);
});

test("known non-person residuals remain deferred instead of escalating to a blocker", () => {
  const now = "2026-09-13T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_animal_credit",
    metadataStatus: "verified"
  }], { now });
  const coverage = {
    works: [{
      workId: "wwm_animal_credit",
      status: "partially_linked",
      creditCount: 2,
      linkedCreditCount: 1,
      unlinkedCreditCount: 1,
      unlinkedCredits: [{ name: "Terry", department: "acting", job: "Animal Actor", externalIds: {} }]
    }]
  };
  let result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_animal_credit" }, coverage, { now });
  ({ state } = result);
  result = updateEnrichmentStage(state, { externalWorkId: "wwm_animal_credit" }, {
    stage: "people",
    status: "deferred",
    reason: "已确认 Terry 是动物演员，不是可写入 People 的人物。",
    nextReviewAt: "2026-12-16T00:00:00.000Z"
  }, { now });
  result = settlePeopleStageFromCoverage(result.state, { externalWorkId: "wwm_animal_credit" }, coverage, {
    now: "2026-09-13T01:00:00.000Z"
  });
  assert.equal(result.work.stages.people.status, "deferred");
  assert.equal(result.work.stages.people.coverageAttempts, 2);
  assert.equal(result.work.stages.people.coverageResiduals[0].name, "Terry");
});

test("composite legacy credits route to normalization instead of person search", () => {
  const now = "2026-09-13T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_composite_credit",
    metadataStatus: "verified"
  }], { now });
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_composite_credit" }, {
    works: [{
      workId: "wwm_composite_credit",
      status: "partially_linked",
      creditCount: 3,
      linkedCreditCount: 1,
      unlinkedCreditCount: 2,
      unlinkedCredits: [
        { name: "导演：甲 / 乙 / 丙", department: "directing", externalIds: {} },
        { name: "Single Actor", department: "acting", externalIds: {} }
      ]
    }]
  }, { now });
  assert.equal(result.work.stages.people.status, "pending");
  assert.match(result.work.stages.people.reason, /复合人物字段/u);
  assert.match(result.work.stages.people.nextTrigger, /normalize composite credit rows/u);
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

test("exact people coverage completes when the producer omits its derived status", () => {
  const now = "2026-09-13T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_exact_counts_only",
    metadataStatus: "verified"
  }], { now });
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_exact_counts_only" }, {
    targets: [{
      workId: "wwm_exact_counts_only",
      creditCount: 9,
      linkedCreditCount: 9,
      unlinkedCreditCount: 0
    }]
  }, { now });
  assert.equal(result.work.stages.people.status, "completed");
});

test("coverage settlement preserves an explicit stable blocker instead of reopening it as pending", () => {
  const now = "2026-09-13T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_identity_gap",
    metadataStatus: "verified"
  }], { now });
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_identity_gap" }, {
    works: [{
      workId: "wwm_identity_gap",
      status: "blocked",
      reason: "remaining credits have no reliable stable identity",
      nextTrigger: "new provider evidence or manual identity confirmation",
      creditCount: 8,
      linkedCreditCount: 6,
      unlinkedCreditCount: 2,
      unlinkedCredits: [
        { name: "Unknown Credit", department: "acting" }
      ]
    }]
  }, { now: "2026-09-13T01:00:00.000Z" });
  assert.equal(result.work.stages.people.status, "blocked");
  assert.equal(result.work.stages.people.reason, "remaining credits have no reliable stable identity");
  assert.equal(result.work.stages.people.nextTrigger, "new provider evidence or manual identity confirmation");
  assert.equal(result.work.stages.people.coverageResiduals[0].name, "Unknown Credit");
});

test("legacy stable blockers expose a deterministic next trigger", () => {
  const now = "2026-09-13T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_legacy_blocker",
    metadataStatus: "verified"
  }], { now });
  const result = updateEnrichmentStage(state, { externalWorkId: "wwm_legacy_blocker" }, {
    stage: "people",
    status: "blocked",
    reason: "stable identity evidence is missing"
  }, { now });
  assert.equal(result.work.stages.people.nextTrigger, "resolve the recorded people blocker, then rerun the exact stage");
  const report = buildEnrichmentCampaignReport(result.state, { now });
  assert.equal(report.blocked[0].nextTrigger, "resolve the recorded people blocker, then rerun the exact stage");
});

test("coverage settlement schedules transient provider failures instead of leaving a permanent blocker", () => {
  const now = "2026-09-15T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_transient_provider",
    metadataStatus: "verified"
  }], { now });
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_transient_provider" }, {
    works: [{
      workId: "wwm_transient_provider",
      status: "blocked",
      reason: "Azure catalog read timeout",
      creditCount: 2,
      linkedCreditCount: 1,
      unlinkedCreditCount: 1,
      unlinkedCredits: [{ name: "待核验人物", externalIds: {} }]
    }]
  }, { now });
  const people = result.work.stages.people;
  assert.equal(people.status, "deferred");
  assert.equal(people.nextReviewAt, "2026-09-15T06:00:00.000Z");
  assert.match(people.reason, /临时供应商\/API故障/u);
  assert.match(people.reason, /Azure catalog read timeout/u);
  assert.deepEqual(people.coverageResiduals.map((item) => item.name), ["待核验人物"]);
});

test("empty canonical coverage is deferred instead of spinning as actionable work", () => {
  const now = "2026-09-16T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_empty_canonical",
    metadataStatus: "verified"
  }], { now });
  const result = settlePeopleStageFromCoverage(state, { externalWorkId: "wwm_empty_canonical" }, {
    works: [{
      workId: "wwm_empty_canonical",
      status: "partially_linked",
      creditCount: 0,
      linkedCreditCount: 0,
      unlinkedCreditCount: 0
    }]
  }, { now });
  const people = result.work.stages.people;
  assert.equal(people.status, "deferred");
  assert.equal(people.nextReviewAt, "2026-09-16T06:00:00.000Z");
  assert.deepEqual(people.missingFields, ["canonical people credits"]);
  assert.match(people.reason, /canonical credits/u);
});

test("repairs legacy transient blockers into scheduled retries without touching stable blockers", () => {
  const state = enqueueEnrichmentWorks(emptyEnrichmentCampaign(), [
    { pageId: "legacy-transient", title: "Transient" },
    { pageId: "stable-blocker", title: "Stable" }
  ]).state;
  let changed = updateEnrichmentStage(state, { pageId: "legacy-transient" }, {
    stage: "people",
    status: "blocked",
    reason: "Notion API timeout while reading the canonical index"
  }).state;
  changed = updateEnrichmentStage(changed, { pageId: "stable-blocker" }, {
    stage: "people",
    status: "blocked",
    reason: "identity ambiguity: two stable IDs conflict"
  }).state;
  const repaired = reclassifyTransientBlockedStages(changed, {
    now: "2026-09-15T00:00:00.000Z"
  });
  const transient = repaired.state.works.find((work) => work.pageId === "legacy-transient").stages.people;
  const stable = repaired.state.works.find((work) => work.pageId === "stable-blocker").stages.people;
  assert.equal(repaired.repaired.length, 1);
  assert.equal(transient.status, "deferred");
  assert.equal(transient.nextReviewAt, "2026-09-15T06:00:00.000Z");
  assert.equal(stable.status, "blocked");
  assert.equal(stable.nextReviewAt, null);
});

test("treats missing exact readback and temporary canonical-index loss as retryable", () => {
  assert.equal(isTransientEnrichmentFailure("Metadata fields were updated, but exact Notion readback omitted Metadata Status"), true);
  assert.equal(isTransientEnrichmentFailure("canonical search index not found; retry after refresh"), true);
  assert.equal(isTransientEnrichmentFailure("identity ambiguity: two stable IDs conflict"), false);
  assert.equal(isTransientEnrichmentFailure("permission missing; page is not shared with the integration"), false);
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

test("optional partial metadata does not block the People stage", () => {
  const now = "2026-09-18T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_optional_metadata_gap",
    metadataStatus: "partial",
    metadataMissingFields: []
  }], { now });
  const report = buildEnrichmentCampaignReport(state, { now });
  assert.equal(report.due[0].currentStage, "people");
  assert.equal(report.due[0].nextAction, "run_wwp_people_curator");
});

test("explicit metadata gaps still keep the base-metadata stage first", () => {
  const now = "2026-09-18T00:00:00.000Z";
  const { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_required_metadata_gap",
    metadataStatus: "partial",
    metadataMissingFields: ["可靠作品身份来源"]
  }], { now });
  const report = buildEnrichmentCampaignReport(state, { now });
  assert.equal(report.due[0].currentStage, "base-metadata");
  assert.equal(report.due[0].nextAction, "run_wwp_metadata_backfiller");
});

test("current film campaign can prioritize due People items inside a bounded report window", () => {
  const report = buildEnrichmentCampaignReport({
    works: [
      { key: "honors", title: "荣誉", stages: {
        "base-metadata": { status: "completed" },
        people: { status: "completed" },
        honors: { status: "pending" },
        highlights: { status: "pending" }
      } },
      { key: "people", title: "人物", stages: {
        "base-metadata": { status: "completed" },
        people: { status: "pending" },
        honors: { status: "pending" },
        highlights: { status: "pending" }
      } }
    ]
  }, { limit: 1, prioritizeStage: "people", now: "2026-09-17T00:00:00.000Z" });

  assert.equal(report.due[0].currentStage, "people");
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

test("blocked enrichment reports preserve the exact recovery contract", () => {
  const now = "2026-09-06T00:00:00.000Z";
  let { state } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    workId: "wwm_blocked_report",
    metadataStatus: "verified"
  }], { now });
  ({ state } = updateEnrichmentStage(state, { externalWorkId: "wwm_blocked_report" }, {
    stage: "people",
    status: "blocked",
    reason: "同一批人物残项无法建立稳定身份",
    missingFields: ["2 unlinked canonical credits"],
    coverageResiduals: [
      { name: "待核验人物", department: "acting" },
      { name: "另一待核验人物", department: "writing" }
    ],
    coverageAttempts: 2,
    nextTrigger: "new provider evidence or manual identity confirmation"
  }, { now }));
  const report = buildEnrichmentCampaignReport(state, { now });
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.blocked[0].nextTrigger, "new provider evidence or manual identity confirmation");
  assert.equal(report.blocked[0].coverageAttempts, 2);
  assert.deepEqual(report.blocked[0].coverageResiduals.map((row) => row.name), [
    "待核验人物",
    "另一待核验人物"
  ]);
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

test("a deferred stage can be bypassed for independent People work whether due or not", () => {
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
  assert.doesNotThrow(() => updateEnrichmentStage(future, { ledgerWorkId: 13 }, {
    stage: "people",
    status: "in_progress"
  }, { now: "2026-09-08T00:00:00.000Z" }));
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

test("a clean preflight can recover a previously blocked people stage", () => {
  const now = "2026-09-15T00:00:00.000Z";
  const reportPath = "C:\\batch\\recovered-report.json";
  const { state: initial } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    externalWorkId: "work-recovered-people",
    metadataStatus: "verified"
  }], { now });
  const { state } = updateEnrichmentStage(initial, { externalWorkId: "work-recovered-people" }, {
    stage: "people",
    status: "blocked",
    reason: "canonical index was temporarily unavailable",
    nextTrigger: "retry after index recovery"
  }, { now });
  const result = resumeAuthorizedPeopleStage(state, { externalWorkId: "work-recovered-people" }, {
    preflight: { status: "ready_for_authorized_apply", reportPath },
    reportPath,
    now
  });
  assert.equal(result.work.stages.people.status, "in_progress");
});

test("people authorization is independent of a stable deferred metadata stage", () => {
  const now = "2026-09-15T00:00:00.000Z";
  const reportPath = "C:\\batch\\independent-report.json";
  const { state: initial } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    externalWorkId: "work-independent-people",
    metadataStatus: "verified"
  }], { now });
  const withDeferredMetadata = updateEnrichmentStage(initial, { externalWorkId: "work-independent-people" }, {
    stage: "base-metadata",
    status: "deferred",
    reason: "exact metadata readback is temporarily unavailable",
    nextReviewAt: "2026-09-20T00:00:00.000Z"
  }, { now }).state;
  const result = resumeAuthorizedPeopleStage(withDeferredMetadata, { externalWorkId: "work-independent-people" }, {
    preflight: { status: "ready_for_authorized_apply", reportPath },
    reportPath,
    now
  });
  assert.equal(result.work.stages.people.status, "in_progress");
});

test("people authorization remains independent when deferred metadata is due", () => {
  const now = "2026-09-15T00:00:00.000Z";
  const reportPath = "C:\\batch\\due-independent-report.json";
  const { state: initial } = enqueueEnrichmentWorks(emptyEnrichmentCampaign(now), [{
    externalWorkId: "work-due-independent-people",
    metadataStatus: "verified"
  }], { now });
  const withDueMetadata = updateEnrichmentStage(initial, { externalWorkId: "work-due-independent-people" }, {
    stage: "base-metadata",
    status: "deferred",
    reason: "metadata retry is due",
    nextReviewAt: "2026-09-14T00:00:00.000Z"
  }, { now }).state;
  const result = resumeAuthorizedPeopleStage(withDueMetadata, { externalWorkId: "work-due-independent-people" }, {
    preflight: { status: "ready_for_authorized_apply", reportPath },
    reportPath,
    now
  });
  assert.equal(result.work.stages.people.status, "in_progress");
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
