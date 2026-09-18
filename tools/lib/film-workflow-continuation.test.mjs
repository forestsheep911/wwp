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
  assert.equal(result.nextAction.lane, "production");
  assert.equal(result.nextAction.sourceId, 7);
});

test("next action prefers publication and exposes the exact target", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: {
        production: [{ id: 12, source_id: 4, work_id: 9, canonical_title: "片名" }],
        publication: [{ id: 99, variant_id: 88, work_id: 9, canonical_title: "片名" }]
      }
    }
  });

  assert.deepEqual(result.nextAction, {
    lane: "publication",
    reason: "完成上传、Media Assets 与网站发布闭环",
    taskId: 99,
    sourceId: null,
    workId: 9,
    variantId: 88,
    title: "片名",
    pageId: null,
    stage: null,
    trigger: null
  });
});

test("metadata without a Notion page routes to page creation before backfill", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: {
        catalogMaintenance: [{
          id: 1144,
          work_id: 364,
          canonical_title: "夜访吸血鬼 Interview with the Vampire (1994)"
        }]
      }
    }
  });

  assert.equal(result.nextAction.lane, "catalogMaintenance");
  assert.equal(result.nextAction.stage, "metadata_page_creation");
  assert.equal(result.nextAction.pageId, null);
  assert.match(result.nextAction.reason, /创建或复用 Notion 作品页/u);
  assert.match(result.nextAction.trigger, /notion-create-work-page\.mjs --work-id <id> --apply/u);
});

test("metadata task is suppressed when the same work is waiting for human confirmation", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: {
        catalogMaintenance: [{
          id: 772,
          work_id: 250,
          notion_work_page_id: "page-250",
          canonical_title: "阿凡达"
        }],
        production: [{ id: 88, work_id: 251, canonical_title: "另一个条目" }]
      }
    },
    enrichmentCampaign: {
      waitingForHuman: [{
        ledgerWorkId: 250,
        pageId: "page-250",
        title: "阿凡达",
        currentStage: "base-metadata",
        currentStatus: "waiting_user",
        reason: "外部类型冲突"
      }],
      summary: { waitingForHuman: 1 }
    }
  });

  assert.equal(result.nextAction.lane, "production");
  assert.equal(result.nextAction.workId, 251);
  assert.equal(result.laneCounts.catalogMaintenance, 0);
  assert.equal(result.laneCounts.production, 1);
});

test("source followup remains routable when no explicit ledger lane is populated", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      sourceDisposition: { actionableNow: 1 },
      lanes: {
        sourceFollowup: [{
          actionableNow: true,
          source_id: 33,
          work_id: 44,
          title: "待绑定输入源",
          next_trigger: "完成身份去重绑定"
        }]
      }
    }
  });

  assert.equal(result.nextAction.lane, "sourceFollowup");
  assert.equal(result.nextAction.sourceId, 33);
  assert.equal(result.nextAction.trigger, "完成身份去重绑定");
});

test("enrichment is selected when all film lanes are empty", () => {
  const result = buildWorkflowContinuation({
    enrichmentCampaign: {
      due: [{ ledgerWorkId: 21, pageId: "page-21", title: "资料条目", currentStage: "people", nextAction: "run_wwp_people_curator" }],
      summary: { actionableNow: 1 }
    }
  });

  assert.equal(result.nextAction.lane, "enrichment");
  assert.equal(result.nextAction.workId, 21);
  assert.equal(result.nextAction.stage, "people");
});

test("eligible people work is not hidden by ordinary metadata backfill", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: {
        catalogMaintenance: [{ id: 17, work_id: 4, canonical_title: "资料仍待复核" }],
        production: [{ id: 18, work_id: 5, canonical_title: "另一个制作项" }]
      }
    },
    enrichmentCampaign: {
      due: [{
        ledgerWorkId: 9,
        pageId: "page-9",
        title: "人物待补全",
        currentStage: "people",
        actionableNow: true,
        nextAction: "run_wwp_people_curator"
      }],
      summary: { actionableNow: 1 }
    }
  });

  assert.equal(result.nextAction.lane, "enrichment");
  assert.equal(result.nextAction.stage, "people");
  assert.equal(result.nextAction.workId, 9);
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
  assert.equal(result.recheckPolicy.unchangedReportPolicy, "suppress_until_trigger");
  assert.equal(result.reportPolicy.suppressDuplicate, true);
  assert.deepEqual(result.remainingConditions, []);
});

test("stable waits expose a repeatable key and explicit resume triggers", () => {
  const input = {
    cycle: {
      sourceDisposition: {
        residualSourceCount: 1,
        scheduledReview: 1,
        byDisposition: { scheduled_review: 1 }
      }
    }
  };
  const first = buildWorkflowContinuation(input);
  const second = buildWorkflowContinuation(input);

  assert.equal(first.state, "scheduled_review");
  assert.equal(first.reportPolicy.suppressDuplicate, true);
  assert.equal(first.reportPolicy.unchangedStateKey, second.reportPolicy.unchangedStateKey);
  assert.deepEqual(first.reportPolicy.resumeOn, [
    "scheduled_review_due",
    "input_root_change_or_registered_source_update"
  ]);
});

test("condition rows preserve source reasons and review triggers", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: {
        sourceFollowup: [{
          sourceId: 42,
          title: "Example",
          disposition: "waiting_for_human",
          reasons: ["missing_chinese_subtitle"],
          nextTrigger: "用户提供中文字幕"
        }]
      },
      sourceDisposition: {
        residualSourceCount: 1,
        needsHumanConfirmation: 1,
        byDisposition: { waiting_for_human: 1 }
      }
    }
  });

  assert.deepEqual(result.conditionRows, [{
    scope: "source",
    status: "waiting_for_human",
    id: 42,
    title: "Example",
    reason: "missing_chinese_subtitle",
    nextTrigger: "用户提供中文字幕",
    actionableNow: false
  }]);
});

test("enrichment waits expose the saved review time when no custom trigger exists", () => {
  const result = buildWorkflowContinuation({
    enrichmentCampaign: {
      waitingForHuman: [{
        itemKey: "work-1",
        title: "Example",
        status: "waiting_user",
        nextReviewAt: "2026-10-01T00:00:00.000Z"
      }],
      summary: { waitingForHuman: 1 }
    }
  });

  assert.equal(result.conditionRows[0].nextTrigger, "2026-10-01T00:00:00.000Z");
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
  assert.equal(result.nextAction.lane, "external");
  assert.equal(result.nextAction.trigger, "people_campaign");
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

test("blocker report keeps item recovery details separate from Goal state", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      lanes: {
        sourceFollowup: [{
          source_id: 51,
          title: "待补字幕片源",
          disposition: "waiting_for_human",
          reason: "缺少中文字幕",
          next_trigger: "用户补入中文字幕"
        }]
      },
      sourceDisposition: { needsHumanConfirmation: 1, residualSourceCount: 1 }
    },
    enrichmentCampaign: {
      blocked: [{
        itemKey: "ww:film-1",
        title: "资料条目",
        status: "blocked",
        blockerReason: "Notion 暂时不可读",
        nextTrigger: "Notion API 恢复后重试"
      }],
      summary: { blocked: 1 }
    }
  });

  assert.equal(result.goalDisposition, "stable_wait");
  assert.equal(result.blockerReport.goalMayStop, false);
  assert.equal(result.blockerReport.items.length, 2);
  assert.deepEqual(result.blockerReport.items.map((row) => row.nextTrigger), [
    "用户补入中文字幕",
    "Notion API 恢复后重试"
  ]);
  assert.equal(result.goalBlocker, null);
});

test("actionable counts without a routable next action are a routing error, not idle", () => {
  const result = buildWorkflowContinuation({
    cycle: {
      sourceDisposition: { actionableNow: 2, residualSourceCount: 2 },
      lanes: {}
    }
  });

  assert.equal(result.state, "routing_incomplete");
  assert.equal(result.goalDisposition, "continue");
  assert.equal(result.canDeclareNoDueAction, false);
  assert.equal(result.canDeclareWorkflowIdle, false);
  assert.equal(result.routingGap.code, "actionable_work_without_route");
  assert.ok(result.remainingConditions.includes("actionable_work_without_route"));
  assert.match(result.decisionMessage, /没有提供可执行的 nextAction/u);
});
