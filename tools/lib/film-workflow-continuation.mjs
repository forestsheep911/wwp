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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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

function collectConditionRows(cycle, enrichmentCampaign) {
  const sourceRows = cycle.lanes?.sourceFollowup ?? [];
  const enrichmentRows = [
    ...(enrichmentCampaign?.waitingForHuman ?? []),
    ...(enrichmentCampaign?.blocked ?? []),
    ...(enrichmentCampaign?.scheduledReviews ?? [])
  ];
  return [
    ...sourceRows.map((row) => ({
      scope: "source",
      status: row.disposition ?? row.status ?? "unclassified",
      id: row.sourceId ?? row.source_id ?? null,
      title: row.title ?? row.canonical_title ?? null,
      // Source disposition keeps the machine-readable explanation in an
      // array. Preserve it in the continuation handoff; otherwise a report
      // can show a category and a trigger but silently lose the actual cause.
      reason: row.reason
        ?? row.blocker
        ?? row.note
        ?? (Array.isArray(row.reasons) ? row.reasons.join("、") : null),
      nextTrigger: row.nextTrigger ?? row.next_trigger ?? row.next_review_at ?? null,
      actionableNow: Boolean(row.actionableNow)
    })),
    ...enrichmentRows.map((row) => ({
      scope: "enrichment",
      status: row.status ?? row.currentStatus ?? "pending",
      stage: row.currentStage ?? null,
      id: row.itemKey ?? row.externalWorkId ?? row.pageId ?? row.ledgerWorkId ?? null,
      title: row.title ?? null,
      reason: row.blockerReason
        ?? row.reason
        ?? row.humanReason
        ?? (Array.isArray(row.humanConfirmationReasons) ? row.humanConfirmationReasons.join("、") : null),
      nextTrigger: row.nextTrigger ?? row.next_trigger ?? row.nextReviewAt ?? row.next_review_at ?? null,
      actionableNow: false
    }))
  ].filter((row) => row.reason || row.nextTrigger || row.status !== "unclassified");
}

function rowMatchesEnrichment(row, enrichmentRow) {
  const rowWorkId = row.work_id ?? row.workId ?? row.ww_work_id ?? row.wwWorkId ?? null;
  const rowPageId = row.notion_work_page_id ?? row.notionWorkPageId ?? row.pageId ?? row.work_page_id ?? null;
  return (rowWorkId != null && [enrichmentRow.ledgerWorkId, enrichmentRow.externalWorkId].includes(rowWorkId))
    || (rowPageId != null && rowPageId === enrichmentRow.pageId);
}

function effectiveFilmLanes(cycle, enrichmentCampaign) {
  const lanes = cycle.lanes ?? {};
  const sourceRows = lanes.sourceFollowup ?? [];
  const failedSourceIds = new Set(sourceRows
    .filter((row) => row.disposition === "cleanup_move_failed")
    .map((row) => row.sourceId ?? row.source_id)
    .filter((value) => value != null)
    .map(String));
  const enrichmentRows = [
    ...(enrichmentCampaign?.waitingForHuman ?? []),
    ...(enrichmentCampaign?.blocked ?? []),
    ...(enrichmentCampaign?.scheduledReviews ?? [])
  ];
  const metadataSuppressed = new Set(
    enrichmentRows
      .filter((row) => row.currentStage === "base-metadata")
      .filter((row) => ["waiting_user", "blocked", "deferred"].includes(row.currentStatus ?? row.status))
      .flatMap((row) => [row.ledgerWorkId, row.externalWorkId, row.pageId].filter((value) => value != null).map(String))
  );
  return {
    ...lanes,
    cleanup: (lanes.cleanup ?? []).filter((row) => {
      if (row.candidate_type !== "source_input") return true;
      const sourceId = row.sourceId ?? row.source_id;
      return sourceId == null || !failedSourceIds.has(String(sourceId));
    }),
    production: (lanes.production ?? []).filter((row) => {
      const state = String(row.production_state ?? row.productionState ?? "").toLowerCase();
      return !["deferred", "completed", "failed", "rejected", "retired", "cancelled"].includes(state);
    }),
    catalogMaintenance: (lanes.catalogMaintenance ?? []).filter((row) => {
      const identifiers = [
        row.work_id ?? row.workId,
        row.ww_work_id ?? row.wwWorkId,
        row.notion_work_page_id ?? row.notionWorkPageId ?? row.pageId ?? row.work_page_id
      ].filter((value) => value != null).map(String);
      return !identifiers.some((value) => metadataSuppressed.has(value));
    })
  };
}

function firstAction(cycle, enrichmentCampaign, externalLaneRequired = null) {
  const lanes = effectiveFilmLanes(cycle, enrichmentCampaign);
  const peopleDue = (enrichmentCampaign?.due ?? []).find((row) =>
    row.currentStage === "people"
      && row.actionableNow !== false
  );
  const urgentLaneOrder = [
    ["publication", "完成上传、Media Assets 与网站发布闭环"],
    ["cleanup", "执行 guarded cleanup 并移入同盘待人工删除"],
    ["intake", "完成新源识别、身份去重和目录登记"]
  ];
  const regularLaneOrder = [
    ["subtitleAcquisition", "继续可恢复的中文字幕获取任务"],
    ["productionCoverage", "补齐剧集规格覆盖缺口"],
    ["production", "推进已选规格或完成源选择"]
  ];
  for (const [lane, reason] of urgentLaneOrder) {
    const row = (lanes[lane] ?? [])[0];
    if (row) {
      const missingMetadataPage = lane === "catalogMaintenance"
        && (row.work_id ?? row.workId) != null
        && !(row.notion_work_page_id ?? row.notionWorkPageId ?? row.pageId ?? row.work_page_id);
      return {
        lane,
        reason: missingMetadataPage
          ? "先完成身份去重并创建或复用 Notion 作品页，再执行作品级 metadata 回填"
          : reason,
        taskId: row.id ?? row.task_id ?? null,
        sourceId: row.source_id ?? row.sourceId ?? null,
        workId: row.work_id ?? row.workId ?? null,
        variantId: row.variant_id ?? row.variantId ?? null,
        title: row.canonical_title ?? row.title ?? row.display_title ?? null,
        pageId: row.notion_work_page_id ?? row.notionWorkPageId ?? row.pageId ?? row.work_page_id ?? null,
        stage: missingMetadataPage ? "metadata_page_creation" : null,
        trigger: missingMetadataPage
          ? "完成多别名身份预检后运行 notion-create-work-page.mjs --work-id <id> --apply，并读回影别与隐藏状态"
          : row.nextTrigger ?? row.next_trigger ?? null
      };
    }
  }
  // People coverage is independently resumable once its campaign says the
  // stage is eligible. Do not let ordinary metadata backfill hide that work;
  // identity and authorization gates remain enforced by the campaign itself.
  if (peopleDue) {
    return {
      lane: "enrichment",
      reason: peopleDue.nextAction ?? "执行当前人物补全阶段",
      taskId: null,
      sourceId: null,
      workId: peopleDue.ledgerWorkId ?? null,
      variantId: null,
      pageId: peopleDue.pageId ?? null,
      title: peopleDue.title ?? null,
      stage: "people",
      trigger: peopleDue.nextTrigger ?? peopleDue.next_trigger ?? null
    };
  }
  for (const [lane, reason] of regularLaneOrder) {
    const row = (lanes[lane] ?? [])[0];
    if (row) {
      return {
        lane,
        reason,
        taskId: row.id ?? row.task_id ?? null,
        sourceId: row.source_id ?? row.sourceId ?? null,
        workId: row.work_id ?? row.workId ?? null,
        variantId: row.variant_id ?? row.variantId ?? null,
        title: row.canonical_title ?? row.title ?? row.display_title ?? null,
        pageId: row.notion_work_page_id ?? row.notionWorkPageId ?? row.pageId ?? row.work_page_id ?? null,
        stage: null,
        trigger: row.nextTrigger ?? row.next_trigger ?? null
      };
    }
  }
  const catalogRow = (lanes.catalogMaintenance ?? [])[0];
  if (catalogRow) {
    const missingMetadataPage =
      (catalogRow.work_id ?? catalogRow.workId) != null
      && !(catalogRow.notion_work_page_id ?? catalogRow.notionWorkPageId ?? catalogRow.pageId ?? catalogRow.work_page_id);
    return {
      lane: "catalogMaintenance",
      reason: missingMetadataPage
        ? "先完成身份去重并创建或复用 Notion 作品页，再执行作品级 metadata 回填"
        : "补齐或核验作品级 metadata",
      taskId: catalogRow.id ?? catalogRow.task_id ?? null,
      sourceId: catalogRow.source_id ?? catalogRow.sourceId ?? null,
      workId: catalogRow.work_id ?? catalogRow.workId ?? null,
      variantId: catalogRow.variant_id ?? catalogRow.variantId ?? null,
      title: catalogRow.canonical_title ?? catalogRow.title ?? catalogRow.display_title ?? null,
      pageId: catalogRow.notion_work_page_id ?? catalogRow.notionWorkPageId ?? catalogRow.pageId ?? catalogRow.work_page_id ?? null,
      stage: missingMetadataPage ? "metadata_page_creation" : null,
      trigger: missingMetadataPage
        ? "完成多别名身份预检后运行 notion-create-work-page.mjs --work-id <id> --apply，并读回影别与隐藏状态"
        : catalogRow.nextTrigger ?? catalogRow.next_trigger ?? null
    };
  }
  // Source disposition can remain actionable even when the corresponding
  // ledger lane is intentionally empty (for example, an unbound source or a
  // cleanup evidence repair). Keep the continuation contract routable.
  const sourceRow = (lanes.sourceFollowup ?? []).find((row) =>
    row.actionableNow && row.disposition !== "cleanup_move_failed"
  );
  if (sourceRow) {
    return {
      lane: "sourceFollowup",
      reason: sourceRow.nextTrigger ?? "处理输入源分类中的可执行事项",
      taskId: sourceRow.taskId ?? sourceRow.task_id ?? null,
      sourceId: sourceRow.sourceId ?? sourceRow.source_id ?? null,
      workId: sourceRow.workId ?? sourceRow.work_id ?? null,
      variantId: sourceRow.variantId ?? sourceRow.variant_id ?? null,
      title: sourceRow.title ?? sourceRow.canonical_title ?? null,
      trigger: sourceRow.nextTrigger ?? sourceRow.next_trigger ?? null
    };
  }
  const enrichmentRow = (enrichmentCampaign?.due ?? [])[0];
  if (enrichmentRow) {
    return {
      lane: "enrichment",
      reason: enrichmentRow.nextAction ?? "执行当前资料补全阶段",
      taskId: null,
      sourceId: null,
      workId: enrichmentRow.ledgerWorkId ?? null,
      variantId: null,
      pageId: enrichmentRow.pageId ?? null,
      title: enrichmentRow.title ?? null,
      stage: enrichmentRow.currentStage ?? null,
      trigger: enrichmentRow.nextTrigger ?? enrichmentRow.next_trigger ?? null
    };
  }
  if (externalLaneRequired) {
    return {
      lane: "external",
      reason: externalLaneRequired === "film_lanes_not_scanned"
        ? "本轮只恢复资料队列，必须回到完整影视轮次读取电影、制作、发布和清理队列"
        : "读取未纳入本轮的工作队列状态",
      taskId: null,
      sourceId: null,
      workId: null,
      variantId: null,
      title: null,
      trigger: externalLaneRequired
    };
  }
  return null;
}

export function buildWorkflowContinuation({
  cycle = {},
  enrichmentCampaign = null,
  externalLaneRequired = null
} = {}) {
  const lanes = effectiveFilmLanes(cycle, enrichmentCampaign);
  const sourceDisposition = cycle.sourceDisposition ?? {};
  const sourceDispositionSummary = summarizeSourceDispositions(sourceDisposition);
  const enrichment = enrichmentCampaign?.summary ?? {};
  const laneCounts = Object.fromEntries(
    FILM_ACTION_LANES.map((lane) => [lane, countRows(lanes[lane])])
  );
  const filmLaneActions = Object.values(laneCounts).reduce((total, count) => total + count, 0);
  const sourceRows = cycle.lanes?.sourceFollowup;
  const sourceActions = Array.isArray(sourceRows)
    ? sourceRows.filter((row) => row.actionableNow && row.disposition !== "cleanup_move_failed").length
    : Number(sourceDisposition.actionableNow ?? 0);
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
  const nextAction = firstAction(cycle, enrichmentCampaign, externalLaneRequired);
  const conditionRows = collectConditionRows(cycle, enrichmentCampaign);
  const routingGap = executableNow > 0 && !nextAction
    ? {
        code: "actionable_work_without_route",
        message: "账本报告存在可执行工作，但没有提供可执行的 nextAction；必须先修复本轮路由，不能把它报告为闲置或目标受阻。"
      }
    : null;

  let state = "idle";
  if (routingGap) state = "routing_incomplete";
  else if (externalLaneRequired) state = "external_lane_check_required";
  else if (executableNow > 0) state = "actionable_now";
  else if (waitingForHuman > 0) state = "waiting_for_human";
  else if (localBlockers > 0) state = "locally_blocked";
  else if (activeEnrichment > 0) state = "active_work";
  else if (scheduledReviews > 0 || residualSources > 0) state = "scheduled_review";

  const remainingConditions = [];
  if (routingGap) remainingConditions.push(routingGap.code);
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
    mode: executableNow > 0 || externalLaneRequired || routingGap
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
    pollingAllowed: executableNow > 0 || Boolean(externalLaneRequired) || Boolean(routingGap),
    reason: routingGap
      ? routingGap.message
      : executableNow > 0 || externalLaneRequired
        ? "仍有可执行队列，继续一个有界动作后再读取状态。"
      : state === "idle"
        ? "所有动作和残留条件均已清零。"
        : state === "active_work"
          ? "已有阶段正在执行；等待进程进展或结束，不重复认领，也不进行短间隔轮询。"
          : "没有新的触发事件前，不重复进行无界扫描；保留条目级恢复条件。"
  };

  const goalDisposition = executableNow > 0 || externalLaneRequired || routingGap
    ? "continue"
    : state === "idle"
      ? "idle"
      : "stable_wait";
  const blockerScope = localBlockers > 0 ? "item" : "none";
  const decisionMessage = routingGap
    ? routingGap.message
    : goalDisposition === "continue"
      ? `当前仍有 ${executableNow} 个可执行动作；${localBlockers} 个局部阻塞只冻结对应条目，继续推进其他队列。输入源分类：${sourceFollowupLabel}。`
    : goalDisposition === "stable_wait"
      ? state === "active_work"
        ? `当前有 ${activeEnrichment} 个资料阶段正在执行，等待进程进展或结束；其他阻塞和残留条件仍按条目保存。`
        : `当前没有到期执行动作，但仍有 ${waitingForHuman} 个待人工项、${localBlockers} 个局部阻塞、${scheduledReviews} 个定时复核和 ${residualSources} 个受管源；输入源分类：${sourceFollowupLabel}。记录触发条件后稳定等待，不得标记目标受阻或完成。`
      : "所有执行、人工、局部阻塞、定时复核和输入源残留条件均已清零，可判定工作流空闲。";

  // A caller can persist this key and suppress identical wait reports until
  // one of the explicit recheck triggers changes the workflow state.
  const stateKey = stableJson({
    state,
    goalDisposition,
    laneCounts,
    sourceDisposition: sourceDisposition.byDisposition ?? {},
    waitingForHuman,
    localBlockers,
    scheduledReviews,
    activeEnrichment,
    residualSources,
    remainingConditions,
    nextAction,
    triggers: recheckPolicy.triggers
  });
  recheckPolicy.unchangedReportPolicy = "suppress_until_trigger";
  recheckPolicy.stateKey = stateKey;

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
    conditionRows,
    blockerReport: {
      scope: blockerScope,
      itemCount: localBlockers,
      items: conditionRows.filter((row) => ["blocked", "locally_blocked", "cleanup_move_failed", "waiting_for_human", "scheduled_review"].includes(row.status)),
      goalMayStop: false,
      rule: "单个条目的阻塞、人工等待或移动失败只能冻结该条目；只要仍有其他可执行队列，就必须继续。"
    },
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
    ],
    reportPolicy: {
      unchangedStateKey: stateKey,
      suppressDuplicate: state !== "actionable_now" && state !== "routing_incomplete",
      resumeOn: recheckPolicy.triggers
    },
    nextAction,
    routingGap
  };
}
