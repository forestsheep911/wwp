import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkflowContinuation } from "./film-workflow-continuation.mjs";

test("one locally blocked item does not hide another executable lane", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: { production: [{ source_id: 7 }] },
      sourceDisposition: { actionableNow: 1, cleanupMoveFailed: 1, residualSourceCount: 2 }
    },
    enrichmentCampaign: { summary: { actionableNow: 3, blocked: 2 } }
  });

  assert.equal(result.state, "actionable_now");
  assert.equal(result.executableNow, 4);
  assert.equal(result.localBlockers, 3);
  assert.equal(result.localBlockerStopsOtherWork, false);
  assert.equal(result.blockerScope, "item");
  assert.equal(result.goalDisposition, "continue");
  assert.equal(result.canMarkGoalBlocked, false);
  assert.equal(result.goalBlocker, null);
  assert.equal(result.canDeclareNoDueAction, false);
  assert.equal(result.recheckPolicy.mode, "continue_now");
  assert.equal(result.recheckPolicy.pollingAllowed, true);
});

test("waiting and scheduled work remain visible without pretending they are executable", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: { sourceFollowup: [{ source_id: 8 }] },
      sourceDisposition: {
        actionableNow: 0,
        needsHumanConfirmation: 2,
        scheduledReview: 4,
        residualSourceCount: 6
      }
    }
  });

  assert.equal(result.state, "waiting_for_human");
  assert.equal(result.goalDisposition, "stable_wait");
  assert.equal(result.blockerScope, "none");
  assert.match(result.decisionMessage, /不得标记目标受阻或完成/u);
  assert.equal(result.canMarkGoalBlocked, false);
  assert.equal(result.canDeclareNoDueAction, true);
  assert.equal(result.canDeclareWorkflowIdle, false);
  assert.equal(result.recheckPolicy.mode, "event_or_due_time");
  assert.equal(result.recheckPolicy.pollingAllowed, false);
  assert.deepEqual(result.recheckPolicy.triggers, [
    "human_confirmation_or_workflow_note_change",
    "scheduled_review_due",
    "input_root_change_or_registered_source_update"
  ]);
  assert.deepEqual(result.remainingConditions, [
    "human_confirmation",
    "scheduled_review_not_due",
    "managed_sources_remain_in_enabled_roots",
    "source_followup_classification_missing"
  ]);
});

test("idle requires no executable, waiting, blocked, scheduled, or residual work", () => {
  const result = buildWorkflowContinuation({ cycle: {} });

  assert.equal(result.state, "idle");
  assert.equal(result.goalDisposition, "idle");
  assert.equal(result.blockerScope, "none");
  assert.equal(result.canMarkGoalBlocked, false);
  assert.equal(result.canDeclareNoDueAction, true);
  assert.equal(result.canDeclareWorkflowIdle, true);
  assert.equal(result.recheckPolicy.mode, "no_recheck_needed");
  assert.deepEqual(result.recheckPolicy.triggers, []);
  assert.deepEqual(result.remainingConditions, []);
});

test("an external people campaign must be read before declaring the workflow idle", () => {
  const result = buildWorkflowContinuation({
    cycle: {},
    externalLaneRequired: "people_campaign"
  });

  assert.equal(result.state, "external_lane_check_required");
  assert.equal(result.goalDisposition, "continue");
  assert.match(result.decisionMessage, /继续推进其他队列/u);
  assert.equal(result.canMarkGoalBlocked, false);
  assert.equal(result.canDeclareNoDueAction, false);
  assert.equal(result.canDeclareWorkflowIdle, false);
  assert.equal(result.recheckPolicy.mode, "continue_now");
  assert.deepEqual(result.recheckPolicy.triggers, ["external_lane_state_readback"]);
  assert.deepEqual(result.remainingConditions, ["people_campaign_state_requires_read"]);
});

test("isolated blockers produce a stable wait rather than a globally blocked goal", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      sourceDisposition: { cleanupMoveFailed: 1, residualSourceCount: 1 }
    },
    enrichmentCampaign: { summary: { blocked: 2 } }
  });

  assert.equal(result.state, "locally_blocked");
  assert.equal(result.blockerScope, "item");
  assert.equal(result.goalDisposition, "stable_wait");
  assert.equal(result.canMarkGoalBlocked, false);
  assert.equal(result.goalBlocker, null);
  assert.equal(result.localBlockerStopsOtherWork, false);
  assert.match(result.decisionMessage, /不得标记目标受阻或完成/u);
});

test("residual sources without a complete disposition audit remain explicitly incomplete", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      sourceDisposition: { residualSourceCount: 3, byDisposition: { waiting_for_human: 1 } }
    }
  });

  assert.equal(result.canDeclareWorkflowIdle, false);
  assert.equal(result.sourceDispositionClassificationComplete, false);
  assert.deepEqual(result.sourceDispositionCategories, [{ name: "waiting_for_human", count: 1 }]);
  assert.ok(result.remainingConditions.includes("source_followup_classification_missing"));
  assert.match(result.decisionMessage, /waiting_for_human=1/u);
});

test("an active enrichment stage is visible but is not immediately re-run or treated as idle", () => {
  const result = buildWorkflowContinuation({
    enrichmentCampaign: { summary: { inProgress: 1 } }
  });

  assert.equal(result.state, "active_work");
  assert.equal(result.executableNow, 0);
  assert.equal(result.activeEnrichment, 1);
  assert.equal(result.canDeclareWorkflowIdle, false);
  assert.equal(result.goalDisposition, "stable_wait");
  assert.deepEqual(result.recheckPolicy.triggers, ["active_enrichment_progress_or_termination"]);
  assert.ok(result.remainingConditions.includes("active_enrichment_work"));
  assert.match(result.decisionMessage, /正在执行/u);
});
