const FILM_ACTION_LANES = [
  "intake",
  "catalogMaintenance",
  "subtitleAcquisition",
  "production",
  "productionCoverage",
  "publication",
  "cleanup"
];

function countRows(value) {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeSourceDispositions(sourceDisposition) {
  const entries = Object.entries(sourceDisposition.byDisposition ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([name, count]) => ({ name, count: Number(count) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const residualSources = Number(sourceDisposition.residualSourceCount ?? 0);
  return {
    entries,
    complete: residualSources === 0
      || entries.reduce((sum, item) => sum + item.count, 0) >= residualSources
  };
}

export function buildWorkflowContinuation({
  cycle = {},
  enrichmentCampaign = null,
  externalLaneRequired = null
} = {}) {
  const lanes = cycle.lanes ?? {};
  const sourceDisposition = cycle.sourceDisposition ?? {};
  const sourceDispositionSummary = summarizeSourceDispositions(sourceDisposition);
  const enrichment = enrichmentCampaign?.summary ?? {};
  const laneCounts = Object.fromEntries(
    FILM_ACTION_LANES.map((lane) => [lane, countRows(lanes[lane])])
  );
  const filmLaneActions = Object.values(laneCounts).reduce((total, count) => total + count, 0);
  const sourceActions = Number(sourceDisposition.actionableNow ?? 0);
  const enrichmentActions = Number(enrichment.actionableNow ?? 0);
  const waitingForHuman = Number(sourceDisposition.needsHumanConfirmation ?? 0)
    + Number(enrichment.waitingForHuman ?? 0);
  const localBlockers = Number(sourceDisposition.cleanupMoveFailed ?? 0)
    + Number(enrichment.blocked ?? 0);
  const scheduledReviews = Number(sourceDisposition.scheduledReview ?? 0)
    + Number(enrichment.scheduledReview ?? 0);
  const activeEnrichment = Number(enrichment.inProgress ?? 0);
  const residualSources = Number(sourceDisposition.residualSourceCount ?? 0);
  const executableNow = Math.max(filmLaneActions, sourceActions) + enrichmentActions;

  let state = "idle";
  if (externalLaneRequired) state = "external_lane_check_required";
  else if (executableNow > 0) state = "actionable_now";
  else if (waitingForHuman > 0) state = "waiting_for_human";
  else if (localBlockers > 0) state = "locally_blocked";
  else if (activeEnrichment > 0) state = "active_work";
  else if (scheduledReviews > 0 || residualSources > 0) state = "scheduled_review";

  const remainingConditions = [];
  if (externalLaneRequired) remainingConditions.push(`${externalLaneRequired}_state_requires_read`);
  if (waitingForHuman > 0) remainingConditions.push("human_confirmation");
  if (localBlockers > 0) remainingConditions.push("local_blockers_with_recovery");
  if (activeEnrichment > 0) remainingConditions.push("active_enrichment_work");
  if (scheduledReviews > 0) remainingConditions.push("scheduled_review_not_due");
  if (residualSources > 0) remainingConditions.push("managed_sources_remain_in_enabled_roots");
  if (residualSources > 0 && !sourceDispositionSummary.complete) {
    remainingConditions.push("source_followup_classification_missing");
  }

  const sourceFollowupLabel = sourceDispositionSummary.entries.length > 0
    ? sourceDispositionSummary.entries.slice(0, 4)
      .map(({ name, count }) => `${name}=${count}`)
      .join(", ")
    : "none";

  const recheckPolicy = {
    mode: executableNow > 0 || externalLaneRequired
      ? "continue_now"
      : state === "idle"
        ? "no_recheck_needed"
        : "event_or_due_time",
    triggers: [
      ...(executableNow > 0 ? ["after_each_bounded_action"] : []),
      ...(externalLaneRequired ? ["external_lane_state_readback"] : []),
      ...(waitingForHuman > 0 ? ["human_confirmation_or_workflow_note_change"] : []),
      ...(localBlockers > 0 ? ["item_recovery_or_retry_evidence"] : []),
      ...(activeEnrichment > 0 ? ["active_enrichment_progress_or_termination"] : []),
      ...(scheduledReviews > 0 ? ["scheduled_review_due"] : []),
      ...(residualSources > 0 ? ["input_root_change_or_registered_source_update"] : [])
    ],
    pollingAllowed: executableNow > 0 || Boolean(externalLaneRequired),
    reason: executableNow > 0 || externalLaneRequired
      ? "仍有可执行队列，继续一个有界动作后再读取状态。"
      : state === "idle"
        ? "所有动作和残留条件均已清零。"
        : state === "active_work"
          ? "已有阶段正在执行；等待进程进展或结束，不重复认领，也不进行短间隔轮询。"
          : "没有新的触发事件前，不重复进行无界扫描；保留条目级恢复条件。"
  };

  const goalDisposition = executableNow > 0 || externalLaneRequired
    ? "continue"
    : state === "idle"
      ? "idle"
      : "stable_wait";
  const blockerScope = localBlockers > 0 ? "item" : "none";
  const decisionMessage = goalDisposition === "continue"
    ? `当前仍有 ${executableNow} 个可执行动作；${localBlockers} 个局部阻塞只冻结对应条目，继续推进其他队列。输入源分类：${sourceFollowupLabel}。`
    : goalDisposition === "stable_wait"
      ? state === "active_work"
        ? `当前有 ${activeEnrichment} 个资料阶段正在执行，等待进程进展或结束；其他阻塞和残留条件仍按条目保存。`
        : `当前没有到期执行动作，但仍有 ${waitingForHuman} 个待人工项、${localBlockers} 个局部阻塞、${scheduledReviews} 个定时复核和 ${residualSources} 个受管源；输入源分类：${sourceFollowupLabel}。记录触发条件后稳定等待，不得标记目标受阻或完成。`
      : "所有执行、人工、局部阻塞、定时复核和输入源残留条件均已清零，可判定工作流空闲。";

  return {
    state,
    goalDisposition,
    blockerScope,
    decisionMessage,
    executableNow,
    filmLaneActions,
    sourceActions,
    enrichmentActions,
    waitingForHuman,
    localBlockers,
    scheduledReviews,
    activeEnrichment,
    residualSources,
    sourceDispositionCategories: sourceDispositionSummary.entries,
    sourceDispositionClassificationComplete: sourceDispositionSummary.complete,
    laneCounts,
    canDeclareNoDueAction: executableNow === 0 && !externalLaneRequired,
    canDeclareWorkflowIdle: state === "idle",
    canMarkGoalBlocked: false,
    goalBlocker: null,
    localBlockerStopsOtherWork: false,
    externalLaneRequired,
    remainingConditions,
    recheckPolicy,
    reportContract: [
      "summary.residualMessage",
      "cycle.sourceDisposition",
      "cycle.lanes.sourceFollowup",
      "continuation.decisionMessage",
      "continuation"
    ]
  };
}
