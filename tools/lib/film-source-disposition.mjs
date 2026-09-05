import fs from "node:fs";
import path from "node:path";
import { collectSourceCleanupCandidates, latestExpansionDecision } from "../film-cleanup-candidates.mjs";

const HUMAN_WORKFLOW_STATES = new Set(["待人工上传", "人工上传中", "待人工确认"]);
const AI_WORKFLOW_STATES = new Set(["待 AI 处理", "AI 处理中", "已上传待 AI 收尾", "已确认待 AI 发布"]);
const CLOSED_PUBLICATION_STATES = new Set(["sync_ready", "cancelled"]);
const HUMAN_EVIDENCE_FAILURES = new Set(["missing_chinese_subtitle", "human_confirmation_required", "manual_upload_required"]);

function insideRoot(filePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function futureDate(value, now) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) && parsed > Date.parse(now);
}

function latestFailure(events) {
  return events.find((event) => event.event_type === "source_quarantine_failed") ?? null;
}

export function classifySourceDisposition({ source, variants = [], tasks = [], cleanupCandidate = null, events = [], now = new Date().toISOString(), pathExists = true, collectionMembersAlreadyTracked: explicitCollectionTracking = false, duplicateOfSourceId = null }) {
  const reasons = [];
  const evidence = [];
  const workflowStatus = source.workflow_status ?? null;
  const expansionDecision = latestExpansionDecision(source.workflow_note);
  const humanTask = tasks.find((task) => task.status === "waiting_user");
  const deferredTasks = tasks.filter((task) => task.status === "deferred");
  const pendingTasks = tasks.filter((task) => ["pending", "in_progress"].includes(task.status));
  const supersededPlaceholder = (variant) => variant.failure_code === "superseded_by_episode_targets";
  const openVariants = variants.filter((variant) =>
    !supersededPlaceholder(variant) && !CLOSED_PUBLICATION_STATES.has(variant.publication_state));
  const futureVariant = variants.find((variant) => !supersededPlaceholder(variant) && futureDate(variant.next_review_at, now));
  const dueVariant = variants.find((variant) =>
    !supersededPlaceholder(variant) && variant.production_state === "deferred" && !futureDate(variant.next_review_at, now));
  // Successful variants often retain QC notes in failure_detail for auditability.
  // Only an open failed/deferred variant should block source disposition.
  const failedVariant = variants.find((variant) =>
    (variant.production_state === "qc_failed" || variant.production_state === "deferred")
    && (variant.failure_code || variant.failure_detail)
    && !supersededPlaceholder(variant)
    && !CLOSED_PUBLICATION_STATES.has(variant.publication_state));
  const quarantineFailure = latestFailure(events);
  const collectionMembersAlreadyTracked = explicitCollectionTracking || (source.work_id == null && tasks.some((task) =>
    task.status === "done" && /(?:members?|成员源|各季成员|已绑定|拆分)/iu.test(String(task.reason ?? ""))
  ));
  const subtitleEvidence = String(source.subtitle_evidence ?? "").toLowerCase();
  const verifiedMissingChineseSubtitle = subtitleEvidence.includes("no_chinese_subtitles")
    || subtitleEvidence.includes('"verifiedchinese":false')
    || subtitleEvidence.includes('"verifiedchinesesubtitle":false');
  const hasVerifiedMandarinAudio = /(?:mandarin|cmn|国语|普通话)/iu.test(String(source.audio_evidence ?? ""));

  if (source.workflow_note) evidence.push({ type: "workflow_note", value: source.workflow_note });
  for (const task of tasks) {
    if (task.reason || task.last_error) evidence.push({ type: `task:${task.task_type}:${task.status}`, value: task.last_error || task.reason });
  }
  for (const variant of variants) {
    if (variant.failure_code || variant.failure_detail) evidence.push({ type: `variant:${variant.id}`, value: variant.failure_detail || variant.failure_code });
  }

  let disposition;
  let actionableNow = false;
  let needsHumanConfirmation = false;
  let nextTrigger = null;

  if (duplicateOfSourceId != null) {
    disposition = "duplicate_source";
    reasons.push("same_physical_source_registered_more_than_once");
    nextTrigger = `保留源 ${duplicateOfSourceId} 作为唯一账本记录；不要重复制作或移动此路径`;
    evidence.push({ type: "duplicate_source", value: { canonicalSourceId: duplicateOfSourceId } });
  } else if (source.source_kind === "duplicate_source") {
    disposition = "duplicate_source";
    reasons.push("source_marked_as_duplicate_container");
    nextTrigger = "保留规范源；不要重复制作或移动此路径";
    evidence.push({ type: "duplicate_source", value: "explicitly marked duplicate" });
  } else if (source.source_kind === "subtitle_bundle") {
    disposition = "companion_evidence";
    reasons.push("subtitle_bundle_is_not_a_media_source");
    nextTrigger = "将字幕作为对应视频源的伴随证据使用；不单独压制或上传";
  } else if (!pathExists) {
    disposition = "source_missing";
    reasons.push("source_path_missing");
    actionableNow = true;
  } else if (quarantineFailure && cleanupCandidate?.eligible) {
    disposition = "cleanup_move_failed";
    reasons.push(quarantineFailure.payload_json ? "previous_quarantine_move_failed" : "quarantine_move_failed");
    actionableNow = true;
    needsHumanConfirmation = true;
    nextTrigger = "解除文件占用或权限问题后重试移动";
    evidence.push({ type: "quarantine_failure", value: quarantineFailure.payload_json || quarantineFailure.event_type });
  } else if (cleanupCandidate?.eligible) {
    disposition = "cleanup_ready";
    reasons.push("source_value_exhausted_and_closed");
    actionableNow = true;
    nextTrigger = "移动到同盘待人工删除目录";
  } else if (HUMAN_WORKFLOW_STATES.has(workflowStatus) || humanTask) {
    disposition = "waiting_for_human";
    reasons.push(workflowStatus ? `workflow_status:${workflowStatus}` : "workflow_task_waiting_user");
    needsHumanConfirmation = true;
    nextTrigger = humanTask?.reason || "等待人工上传、确认或补充证据";
  } else if (deferredTasks.some((task) => futureDate(task.next_run_at, now)) || futureDate(source.next_review_at, now) || futureVariant) {
    const dates = [source.next_review_at, futureVariant?.next_review_at, ...deferredTasks.map((task) => task.next_run_at)]
      .filter((value) => futureDate(value, now)).sort();
    disposition = "scheduled_review";
    reasons.push("review_not_due");
    nextTrigger = dates[0] ?? null;
  } else if (deferredTasks.length > 0) {
    disposition = "waiting_for_human";
    reasons.push("deferred_without_machine_trigger");
    needsHumanConfirmation = true;
    nextTrigger = deferredTasks.find((task) => task.reason)?.reason || "等待人工补充证据或明确恢复条件";
  } else if (collectionMembersAlreadyTracked) {
    disposition = "collection_container_active";
    reasons.push("collection_members_tracked_separately");
    nextTrigger = "等待全部成员源各自闭环后再关闭并移动合集容器";
  } else if (verifiedMissingChineseSubtitle && !hasVerifiedMandarinAudio) {
    disposition = "waiting_for_human";
    reasons.push("missing_chinese_subtitle");
    needsHumanConfirmation = true;
    nextTrigger = "补充中文字幕或由用户明确覆盖中文字幕门槛；在此之前不制作";
  } else if (source.work_id == null) {
    disposition = "identity_review_required";
    reasons.push("source_not_bound_to_work");
    actionableNow = true;
    nextTrigger = "AI 识别条目并完成去重绑定";
  } else if (pendingTasks.length > 0 || AI_WORKFLOW_STATES.has(workflowStatus)) {
    disposition = "ai_action_pending";
    reasons.push(...pendingTasks.map((task) => `${task.task_type}:${task.status}`));
    if (reasons.length === 0) reasons.push(`workflow_status:${workflowStatus}`);
    actionableNow = true;
    nextTrigger = "继续当前 AI 工作项";
  } else if (failedVariant && HUMAN_EVIDENCE_FAILURES.has(failedVariant.failure_code)) {
    disposition = "waiting_for_human";
    reasons.push(failedVariant.failure_code);
    needsHumanConfirmation = true;
    nextTrigger = failedVariant.failure_detail || "等待人工补充证据或确认例外规则";
  } else if (failedVariant) {
    disposition = "technical_blocker";
    reasons.push(failedVariant.failure_code || "variant_failure");
    actionableNow = true;
    nextTrigger = "AI 诊断失败并记录可恢复条件；需要用户证据时转待人工确认";
  } else if (dueVariant) {
    disposition = "deferred_review_due";
    reasons.push("variant_review_due");
    actionableNow = true;
    nextTrigger = "AI 重新评估延期规格";
  } else if (openVariants.length > 0) {
    const publicationPending = openVariants.some((variant) => variant.production_state === "qc_passed" || !["not_ready", "cancelled"].includes(variant.publication_state));
    disposition = publicationPending ? "publication_pending" : "production_pending";
    reasons.push(publicationPending ? "linked_variant_publication_open" : "linked_variant_production_open");
    actionableNow = true;
    nextTrigger = publicationPending ? "完成上传、Media Assets 与读回闭环" : "继续已选择规格的制作或 QC";
  } else if (expansionDecision === "CLOSED" && variants.length === 0) {
    disposition = "source_expansion_closed";
    reasons.push("work_expansion_closed_without_source_variant");
    nextTrigger = "作品扩展已关闭；除非用户重新指定，不制作此源";
  } else if (variants.length === 0) {
    disposition = workflowStatus === "暂缓" ? "deferred_without_review_time" : "production_decision_missing";
    reasons.push(workflowStatus === "暂缓" ? "work_deferred_without_due_time" : "no_linked_variant_decision");
    actionableNow = workflowStatus !== "暂缓";
    needsHumanConfirmation = workflowStatus === "暂缓";
    nextTrigger = workflowStatus === "暂缓" ? "补充明确恢复条件或人工决定" : "AI 完成制作价值评估并建立具体规格或关闭扩展";
  } else if (cleanupCandidate?.reasons?.includes("source_media_not_fully_covered")) {
    disposition = "source_coverage_review";
    reasons.push(...cleanupCandidate.reasons);
    actionableNow = true;
    nextTrigger = "逐个核验未覆盖媒体、音轨、字幕与花絮价值";
  } else if (expansionDecision === "OPEN" || cleanupCandidate?.reasons?.includes("source_expansion_open")) {
    disposition = "retained_for_open_expansion";
    reasons.push(...(cleanupCandidate?.reasons ?? ["source_expansion_open"]));
    // OPEN means the source is retained for future evidence; it is not a
    // concrete task until a missing stream/spec or user instruction exists.
    actionableNow = false;
    nextTrigger = "等待新增音轨/字幕/剪辑证据或用户明确指定扩展规格";
  } else if (expansionDecision !== "CLOSED" || cleanupCandidate?.reasons?.includes("source_expansion_unresolved")) {
    disposition = "expansion_decision_missing";
    reasons.push(...(cleanupCandidate?.reasons ?? ["source_expansion_unresolved"]));
    actionableNow = true;
    nextTrigger = "AI 明确记录规格扩展 OPEN 或 CLOSED；不明确时不得移动";
  } else {
    disposition = "cleanup_blocked";
    reasons.push(...(cleanupCandidate?.reasons ?? ["cleanup_gate_not_satisfied"]));
    actionableNow = true;
    nextTrigger = "补齐清理门槛证据";
  }

  return {
    sourceId: source.id,
    workId: source.work_id ?? null,
    title: source.canonical_title ?? null,
    path: path.resolve(source.absolute_path),
    inputRoot: path.resolve(source.input_root_path),
    relativePath: source.relative_path,
    sourceKind: source.source_kind,
    workflowStatus,
    expansionDecision,
    linkedVariantCount: variants.length,
    disposition,
    actionableNow,
    needsHumanConfirmation,
    nextTrigger,
    reasons: [...new Set(reasons)],
    evidence
  };
}

export function summarizeSourceDispositions(items) {
  const byDisposition = {};
  for (const item of items) byDisposition[item.disposition] = (byDisposition[item.disposition] ?? 0) + 1;
  const byInputRoot = {};
  for (const item of items) {
    const root = item.inputRoot;
    if (!root) continue;
    byInputRoot[root] ??= { residualSourceCount: 0, actionableNow: 0, needsHumanConfirmation: 0, cleanupReady: 0, cleanupMoveFailed: 0, scheduledReview: 0, byDisposition: {} };
    const summary = byInputRoot[root];
    summary.residualSourceCount += 1;
    if (item.actionableNow) summary.actionableNow += 1;
    if (item.needsHumanConfirmation) summary.needsHumanConfirmation += 1;
    if (item.disposition === "cleanup_ready") summary.cleanupReady += 1;
    if (item.disposition === "cleanup_move_failed") summary.cleanupMoveFailed += 1;
    if (item.disposition === "scheduled_review") summary.scheduledReview += 1;
    summary.byDisposition[item.disposition] = (summary.byDisposition[item.disposition] ?? 0) + 1;
  }
  return {
    residualSourceCount: items.length,
    actionableNow: items.filter((item) => item.actionableNow).length,
    needsHumanConfirmation: items.filter((item) => item.needsHumanConfirmation).length,
    cleanupReady: items.filter((item) => item.disposition === "cleanup_ready").length,
    cleanupMoveFailed: items.filter((item) => item.disposition === "cleanup_move_failed").length,
    scheduledReview: items.filter((item) => item.disposition === "scheduled_review").length,
    byDisposition,
    byInputRoot
  };
}

export function collectSourceDispositions(db, { now = new Date().toISOString(), pathExists = fs.existsSync } = {}) {
  const sources = db.prepare(`
    SELECT sources.*, input_roots.path AS input_root_path,
           works.canonical_title, works.workflow_status, works.workflow_note, works.next_review_at
    FROM sources
    JOIN input_roots ON input_roots.id=sources.input_root_id AND input_roots.enabled=1
    LEFT JOIN works ON works.id=sources.work_id
    WHERE sources.missing=0 AND sources.relative_path NOT LIKE '@flat/%'
    ORDER BY input_roots.id, sources.relative_path, sources.id
  `).all().filter((source) => insideRoot(source.absolute_path, source.input_root_path) && pathExists(source.absolute_path));
  // Child sources may already be marked missing after their completed media
  // was quarantined. They still matter when deciding whether a parent folder
  // is a tracked collection container, so use the full ledger for hierarchy
  // detection rather than only the currently present input entries.
  const allSources = db.prepare(`
    SELECT sources.id, sources.input_root_id, sources.work_id, sources.absolute_path,
           sources.source_kind, sources.updated_at
    FROM sources
    JOIN input_roots ON input_roots.id=sources.input_root_id AND input_roots.enabled=1
  `).all();
  const duplicateCanonicalBySourceId = new Map();
  const samePhysicalSources = new Map();
  for (const candidate of allSources) {
    if (candidate.work_id == null) continue;
    const key = `${candidate.input_root_id}:${candidate.work_id}:${path.resolve(candidate.absolute_path).toLowerCase()}`;
    const group = samePhysicalSources.get(key) ?? [];
    group.push(candidate);
    samePhysicalSources.set(key, group);
  }
  for (const group of samePhysicalSources.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => {
      const leftPreferred = left.source_kind === "series_folder" ? 0 : 1;
      const rightPreferred = right.source_kind === "series_folder" ? 0 : 1;
      return leftPreferred - rightPreferred || String(left.updated_at).localeCompare(String(right.updated_at)) || left.id - right.id;
    });
    for (const duplicate of group.slice(1)) duplicateCanonicalBySourceId.set(duplicate.id, group[0].id);
  }
  const cleanupBySource = new Map(collectSourceCleanupCandidates(db).map((item) => [item.sourceId, item]));
  const variantsForSource = db.prepare("SELECT * FROM variants WHERE source_id=? ORDER BY id");
  const tasksForSource = db.prepare("SELECT * FROM workflow_tasks WHERE source_id=? ORDER BY id");
  const eventsForSource = db.prepare("SELECT * FROM events WHERE entity_type='source' AND entity_id=? ORDER BY id DESC");
  const items = sources.map((source) => classifySourceDisposition({
    source,
    variants: variantsForSource.all(source.id),
    tasks: tasksForSource.all(source.id),
    cleanupCandidate: cleanupBySource.get(source.id) ?? null,
    events: eventsForSource.all(source.id),
    now,
    pathExists: true,
    duplicateOfSourceId: duplicateCanonicalBySourceId.get(source.id) ?? null,
    collectionMembersAlreadyTracked: allSources.some((candidate) => candidate.id !== source.id
      && candidate.input_root_id === source.input_root_id
      && candidate.work_id != null
      && String(candidate.absolute_path).replaceAll("/", "\\").toLowerCase().startsWith(`${String(source.absolute_path).replaceAll("/", "\\").toLowerCase()}\\`))
  }));
  return { generatedAt: now, summary: summarizeSourceDispositions(items), items };
}
