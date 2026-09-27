import fs from "node:fs";
import path from "node:path";
import { collectSourceCleanupCandidates, latestExpansionDecision } from "../film-cleanup-candidates.mjs";
import {
  CHINESE_SUBTITLE_STATES,
  classifyChineseSubtitleState,
  hasVerifiedMandarinAudio
} from "./film-subtitle-state.mjs";

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

function workflowRecoveryTrigger(note) {
  const lines = String(note ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? null;
}

function isIncompleteDownloadName(name) {
  return /(?:\.\!qB|\.part|\.crdownload|\.tmp)$/i.test(String(name ?? ""));
}

function hasIncompleteDownloadArtifacts(filePath) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (stats.isFile()) return isIncompleteDownloadName(path.basename(filePath));
  if (!stats.isDirectory()) return false;
  let entries;
  try {
    entries = fs.readdirSync(filePath, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const childPath = path.join(filePath, entry.name);
    if (isIncompleteDownloadName(entry.name)) return true;
    if (entry.isDirectory() && hasIncompleteDownloadArtifacts(childPath)) return true;
  }
  return false;
}

export function classifySourceDisposition({ source, variants = [], tasks = [], cleanupCandidate = null, events = [], now = new Date().toISOString(), pathExists = true, collectionMembersAlreadyTracked: explicitCollectionTracking = false, duplicateOfSourceId = null }) {
  const reasons = [];
  const evidence = [];
  const workflowStatus = source.workflow_status ?? null;
  const expansionDecision = latestExpansionDecision(source.workflow_note);
  const humanTask = tasks.find((task) => task.status === "waiting_user");
  const deferredTasks = tasks.filter((task) => task.status === "deferred");
  const pendingTasks = tasks.filter((task) => ["pending", "in_progress"].includes(task.status));
  const pendingIntakeTask = tasks.find((task) => task.task_type === "intake" && ["pending", "in_progress"].includes(task.status));
  const subtitleHumanTask = tasks.find((task) => task.task_type === "subtitle_acquisition" && task.status === "waiting_user");
  const subtitlePendingTask = tasks.find((task) => task.task_type === "subtitle_acquisition" && ["pending", "in_progress"].includes(task.status));
  const supersededPlaceholder = (variant) => variant.failure_code === "superseded_by_episode_targets";
  const openVariants = variants.filter((variant) =>
    !supersededPlaceholder(variant) && !CLOSED_PUBLICATION_STATES.has(variant.publication_state));
  const variantNextReviewAt = (variant) => variant.next_review_at ?? variant.publication_next_check_at;
  const futureVariant = variants.find((variant) => !supersededPlaceholder(variant) && futureDate(variantNextReviewAt(variant), now));
  const sourceDiscoveredAt = Date.parse(source.discovered_at ?? "");
  const nowAt = Date.parse(now);
  const recentlyDiscoveredWithoutVariant = variants.length === 0
    && Number.isFinite(sourceDiscoveredAt)
    && Number.isFinite(nowAt)
    && nowAt - sourceDiscoveredAt <= 7 * 24 * 60 * 60 * 1000;
  const dueVariant = variants.find((variant) =>
    !supersededPlaceholder(variant) && variant.production_state === "deferred" && !futureDate(variantNextReviewAt(variant), now));
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
  const chineseSubtitleState = classifyChineseSubtitleState({
    subtitleEvidence: source.subtitle_evidence,
    qualityState: source.quality_state
  });
  const verifiedMissingChineseSubtitle = chineseSubtitleState === CHINESE_SUBTITLE_STATES.CONFIRMED_MISSING;
  const verifiedMandarinAudio = hasVerifiedMandarinAudio(source.audio_evidence);

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
  } else if (["subtitle_bundle", "companion_evidence", "archive_bundle"].includes(source.source_kind)) {
    disposition = source.source_kind === "archive_bundle" ? "archive_bundle" : "companion_evidence";
    reasons.push(source.source_kind === "subtitle_bundle"
      ? "subtitle_bundle_is_not_a_media_source"
      : source.source_kind === "archive_bundle"
        ? "archive_contains_no_recognized_media_file"
        : "artwork_or_metadata_bundle_is_not_a_media_source");
    nextTrigger = source.source_kind === "subtitle_bundle"
      ? "将字幕作为对应视频源的伴随证据使用；不单独压制或上传"
      : source.source_kind === "archive_bundle"
        ? "先确认归档内容；如确有视频，解包后重新扫描，否则标记为非影视输入"
        : "将海报、扫描图或 NFO 作为对应作品的伴随证据使用；不单独识别、压制或上传";
  } else if (source.source_kind === "non_film_source") {
    disposition = "non_film_source";
    reasons.push("source_explicitly_marked_non_film");
    nextTrigger = "不进入作品识别、豆瓣建档、压制或上传队列；如无需保留可由人工清理";
  } else if (!pathExists) {
    disposition = "source_missing";
    reasons.push("source_path_missing");
    actionableNow = true;
  } else if (hasIncompleteDownloadArtifacts(source.absolute_path)) {
    disposition = "source_download_incomplete";
    reasons.push("source_download_incomplete");
    nextTrigger = "等待下载完成并出现可读取的完整媒体文件后重新扫描";
  } else if (source.scope_state === "closed" && variants.length === 0) {
    disposition = "source_expansion_closed";
    reasons.push("work_scope_closed_without_source_variant");
    nextTrigger = "作品扩展已关闭；除非用户重新指定，不制作此源";
  } else if (quarantineFailure) {
    disposition = "cleanup_move_failed";
    reasons.push(quarantineFailure.payload_json ? "previous_quarantine_move_failed" : "quarantine_move_failed");
    actionableNow = false;
    needsHumanConfirmation = false;
    nextTrigger = "解除文件占用或权限问题后重试移动";
    evidence.push({ type: "quarantine_failure", value: quarantineFailure.payload_json || quarantineFailure.event_type });
  } else if (cleanupCandidate?.eligible) {
    disposition = "cleanup_ready";
    reasons.push("source_value_exhausted_and_closed");
    actionableNow = true;
    nextTrigger = "移动到同盘待人工删除目录";
  } else if (subtitleHumanTask) {
    disposition = "waiting_for_human";
    reasons.push("subtitle_acquisition:waiting_user");
    needsHumanConfirmation = true;
    nextTrigger = subtitleHumanTask.reason || "等待人工完成字幕站点登录、验证或候选确认";
  } else if (HUMAN_WORKFLOW_STATES.has(workflowStatus) || humanTask) {
    disposition = "waiting_for_human";
    reasons.push(workflowStatus ? `workflow_status:${workflowStatus}` : "workflow_task_waiting_user");
    needsHumanConfirmation = true;
    nextTrigger = humanTask?.reason || "等待人工上传、确认或补充证据";
  } else if (verifiedMissingChineseSubtitle && !verifiedMandarinAudio && subtitlePendingTask) {
    // A concrete subtitle task is more specific than a newly discovered or
    // requeued intake marker and must remain visible as the next action.
    disposition = "subtitle_acquisition_pending";
    reasons.push(`subtitle_acquisition:${subtitlePendingTask.status}`);
    actionableNow = true;
    nextTrigger = "继续可恢复的字幕获取任务；候选站点需要登录或验证时再转人工确认";
  } else if (verifiedMissingChineseSubtitle && !verifiedMandarinAudio) {
    disposition = "subtitle_acquisition_required";
    reasons.push("missing_chinese_subtitle");
    actionableNow = true;
    nextTrigger = "建立可恢复的字幕获取任务并采集候选；在取得可用中文字幕前不制作";
  } else if (collectionMembersAlreadyTracked && variants.length === 0) {
    // A split collection parent can still look newly discovered because the
    // parent directory remains visible in the enabled input root. Once its
    // leaf sources have been tracked/bound, the parent is a container record,
    // not a fresh identity candidate. Keep it visible without reopening an
    // old intake task; the child sources are the actual work items.
    disposition = "collection_container_active";
    reasons.push("collection_members_tracked_separately");
    nextTrigger = "等待全部成员源各自闭环后再关闭并移动合集容器";
  } else if (pendingIntakeTask || (recentlyDiscoveredWithoutVariant && workflowStatus !== "暂缓")) {
    // A newly requeued source must not disappear behind the completed work's
    // long-term review date. The intake task or recent discovery is the
    // explicit trigger, even when the cycle has just consumed the task.
    disposition = "ai_action_pending";
    reasons.push(pendingIntakeTask ? `intake:${pendingIntakeTask.status}` : "source:newly_discovered");
    actionableNow = true;
    nextTrigger = "继续当前 AI intake，并评估该源的规格扩展或缺集制作";
  } else if (deferredTasks.some((task) => futureDate(task.next_run_at, now)) || futureDate(source.next_review_at, now) || futureVariant) {
    const dates = [source.next_review_at, futureVariant && variantNextReviewAt(futureVariant), ...deferredTasks.map((task) => task.next_run_at)]
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
    nextTrigger = workflowStatus === "暂缓"
      ? workflowRecoveryTrigger(source.workflow_note) || "补充明确恢复条件或人工决定"
      : "AI 完成制作价值评估并建立具体规格或关闭扩展";
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
           works.canonical_title, works.workflow_status, works.workflow_note, works.next_review_at,
           works.scope_state
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
  const variantsForSource = db.prepare(`SELECT variants.*, notion_targets.next_check_at AS publication_next_check_at
    FROM variants
    LEFT JOIN notion_targets ON notion_targets.variant_id=variants.id
    WHERE variants.source_id=? ORDER BY variants.id`);
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
