import { withTransaction } from "./film-ledger-schema.mjs";
import {
  AI_ACTIONABLE_WORKFLOW_STATES,
  assertProductionTransition,
  assertPublicationTransition,
  assertWorkflowHandoffState,
  assertWorkflowHandoffTransition,
  normalizeLimit
} from "./film-ledger-domain.mjs";
import path from "node:path";

export function normalizeLedgerPath(value) {
  const input = String(value);
  if (!/^[a-z]:[\\/]/i.test(input)) return input;
  const normalized = path.win32.normalize(input.replaceAll("/", "\\"));
  return normalized.replace(/(?<!^[a-z]:)\\+$/i, "").toLowerCase();
}

function preserveProbeEvidence(existingJson, incomingJson) {
  if (!incomingJson) return existingJson ?? null;
  if (!existingJson) return incomingJson;
  try {
    const existing = JSON.parse(existingJson);
    const incoming = JSON.parse(incomingJson);
    const incomingIsScanPlaceholder = incoming?.internalProbeState === "not_run";
    const existingHasProbeResult = existing?.internalProbeState && existing.internalProbeState !== "not_run";
    const existingHasManualEvidence = [
      "verifiedChinese",
      "verifiedChineseText",
      "verifiedVisibleSubtitle",
      "visibleWatermark",
      "productionGate",
      "sampleTimes",
      "observedLanguages",
      "verifiedVisibleSamples"
    ].some((key) => Object.hasOwn(existing ?? {}, key));
    if (incomingIsScanPlaceholder && (existingHasProbeResult || existingHasManualEvidence)) {
      return existingJson;
    }
  } catch {
    // Keep the incoming value when either side is not structured JSON.
  }
  return incomingJson;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value = {}) {
  return JSON.stringify(stableValue(value));
}

function nullableJson(value) {
  return value == null ? null : stableJson(value);
}

export function createLedgerRepository(db, { now = () => new Date().toISOString() } = {}) {
  const timestamp = () => typeof now === "function" ? now() : now;
  const getVariant = db.prepare("SELECT * FROM variants WHERE id = ?");
  const insertEvent = db.prepare("INSERT INTO events (entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)");

  function ensureWorkflowTask(input) {
    if (!input?.taskKey || !input.taskType) throw new TypeError("workflow task requires taskKey and taskType");
    if (!["intake", "metadata_backfill"].includes(input.taskType)) throw new Error(`unsupported workflow task type: ${input.taskType}`);
    const at = timestamp();
    db.prepare(`INSERT INTO workflow_tasks
      (task_key, task_type, status, source_id, work_id, variant_id, priority_score, reason, payload_json, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_key) DO UPDATE SET
        source_id=COALESCE(excluded.source_id, workflow_tasks.source_id),
        work_id=COALESCE(excluded.work_id, workflow_tasks.work_id),
        variant_id=COALESCE(excluded.variant_id, workflow_tasks.variant_id),
        priority_score=excluded.priority_score,
        reason=COALESCE(excluded.reason, workflow_tasks.reason),
        payload_json=COALESCE(excluded.payload_json, workflow_tasks.payload_json),
        updated_at=excluded.updated_at`)
      .run(input.taskKey, input.taskType, input.status ?? "pending", input.sourceId ?? null, input.workId ?? null,
        input.variantId ?? null, input.priorityScore ?? 0, input.reason ?? null, nullableJson(input.payload),
        input.nextRunAt ?? null, at, at);
    return db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(input.taskKey);
  }

  function completeWorkflowTaskByKey(taskKey, details = {}) {
    const at = timestamp();
    db.prepare(`UPDATE workflow_tasks SET status='done', source_id=COALESCE(?, source_id), work_id=COALESCE(?, work_id),
      variant_id=COALESCE(?, variant_id), last_error=NULL, reason=COALESCE(?, reason), updated_at=? WHERE task_key=?`)
      .run(details.sourceId ?? null, details.workId ?? null, details.variantId ?? null, details.reason ?? null, at, taskKey);
    return db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(taskKey) ?? null;
  }

  function requeueMetadataTask(workId, details = {}) {
    const work = db.prepare("SELECT * FROM works WHERE id=?").get(workId);
    if (!work) throw new Error(`work not found: ${workId}`);
    const at = timestamp();
    if (details.nextRunAt !== undefined) {
      db.prepare("UPDATE works SET next_review_at=?, updated_at=? WHERE id=?")
        .run(details.nextRunAt ?? null, at, workId);
    }
    ensureWorkflowTask({
      taskKey: `metadata:work:${workId}`,
      taskType: "metadata_backfill",
      workId,
      priorityScore: details.priorityScore ?? work.priority_score,
      reason: details.reason ?? "Work-level metadata maintenance is due",
      nextRunAt: details.nextRunAt ?? null
    });
    db.prepare(`UPDATE workflow_tasks SET status='pending', last_error=NULL,
      reason=COALESCE(?, reason), next_run_at=?, updated_at=? WHERE task_key=?`)
      .run(details.reason ?? null, details.nextRunAt ?? null, at, `metadata:work:${workId}`);
    insertEvent.run("work", workId, "metadata_task_requeued", stableJson({
      reason: details.reason,
      nextRunAt: details.nextRunAt
    }), at);
    return db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`metadata:work:${workId}`);
  }

  function requeueIntakeTask(sourceId, details = {}) {
    const source = db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
    if (!source) throw new Error(`source not found: ${sourceId}`);
    const at = timestamp();
    const taskKey = `intake:source:${sourceId}`;
    ensureWorkflowTask({
      taskKey,
      taskType: "intake",
      sourceId,
      workId: source.work_id,
      priorityScore: details.priorityScore ?? 0,
      reason: details.reason ?? "Source contents changed and need intake review"
    });
    db.prepare(`UPDATE workflow_tasks SET status='pending', last_error=NULL,
      reason=COALESCE(?, reason), next_run_at=NULL, updated_at=? WHERE task_key=?`)
      .run(details.reason ?? null, at, taskKey);
    insertEvent.run("source", sourceId, "intake_task_requeued", stableJson({
      workId: source.work_id,
      reason: details.reason
    }), at);
    return db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(taskKey);
  }

  function refreshDueIntakeTasks({ now = timestamp(), limit = 20 } = {}) {
    const dueTasks = db.prepare(`SELECT id, source_id, work_id, priority_score
      FROM workflow_tasks
      WHERE task_type='intake' AND status='deferred'
        AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY priority_score DESC, next_run_at ASC, id ASC
      LIMIT ?`).all(now, normalizeLimit(limit, 1, 20));
    const at = timestamp();
    const update = db.prepare(`UPDATE workflow_tasks SET status='pending', last_error=NULL,
      reason='Deferred intake review is due', next_run_at=NULL, updated_at=? WHERE id=?`);
    for (const task of dueTasks) {
      update.run(at, task.id);
      insertEvent.run("workflow_task", task.id, "intake_task_requeued", stableJson({
        sourceId: task.source_id,
        workId: task.work_id,
        reason: "Deferred intake review is due"
      }), at);
    }
    return dueTasks.map(task => db.prepare("SELECT * FROM workflow_tasks WHERE id=?").get(task.id));
  }

  function upsertInputRoot(rootPath, options = {}) {
    rootPath = normalizeLedgerPath(rootPath);
    const at = timestamp();
    db.prepare(`INSERT INTO input_roots (path, enabled, last_scan_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET enabled=excluded.enabled,
        last_scan_at=COALESCE(excluded.last_scan_at, input_roots.last_scan_at), updated_at=excluded.updated_at`)
      .run(rootPath, options.enabled === false ? 0 : 1, options.lastScanAt ?? null, at, at);
    return db.prepare("SELECT * FROM input_roots WHERE path = ?").get(rootPath);
  }

  function setInputRootEnabled(rootPath, enabled) {
    const normalized = normalizeLedgerPath(rootPath);
    const at = timestamp();
    const result = db.prepare("UPDATE input_roots SET enabled=?, updated_at=? WHERE path=?")
      .run(enabled ? 1 : 0, at, normalized);
    if (result.changes === 0) throw new Error(`input root not found: ${normalized}`);
    return db.prepare("SELECT * FROM input_roots WHERE path=?").get(normalized);
  }

  function ensureWork(input) {
    const at = timestamp();
    const key = [input.canonicalTitle, input.year ?? null, input.workType ?? "movie"];
    const existingByPage = input.notionWorkPageId
      ? db.prepare("SELECT * FROM works WHERE notion_work_page_id = ?").get(input.notionWorkPageId)
      : null;
    const existing = existingByPage ?? db.prepare("SELECT * FROM works WHERE canonical_title = ? AND year IS ? AND work_type = ?").get(...key);
    if (existing) {
      db.prepare(`UPDATE works SET notion_work_page_id=COALESCE(?, notion_work_page_id), priority_score=COALESCE(?, priority_score),
        scope_state=COALESCE(?, scope_state), next_review_at=COALESCE(?, next_review_at), updated_at=? WHERE id=?`)
        .run(input.notionWorkPageId ?? null, input.priorityScore ?? null, input.scopeState ?? null,
          input.nextReviewAt ?? null, at, existing.id);
    } else {
      db.prepare(`INSERT INTO works (canonical_title, year, work_type, notion_work_page_id, priority_score, scope_state, next_review_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(...key, input.notionWorkPageId ?? null, input.priorityScore ?? 0, input.scopeState ?? "candidate", input.nextReviewAt ?? null, at, at);
    }
    const work = db.prepare("SELECT * FROM works WHERE id=?").get(existing?.id ?? db.prepare("SELECT last_insert_rowid() AS id").get().id);
    ensureWorkflowTask({
      taskKey: `metadata:work:${work.id}`,
      taskType: "metadata_backfill",
      workId: work.id,
      priorityScore: work.priority_score,
      reason: "Work-level metadata should be checked independently of playable media readiness"
    });
    const metadataTask = db.prepare("SELECT status, next_run_at FROM workflow_tasks WHERE task_key=?")
      .get(`metadata:work:${work.id}`);
    const metadataDeferredUntil = metadataTask?.status === "deferred" && metadataTask.next_run_at
      ? metadataTask.next_run_at
      : null;
    if (work.next_review_at && work.next_review_at <= timestamp()
      && (!metadataDeferredUntil || metadataDeferredUntil <= timestamp())) {
      requeueMetadataTask(work.id, { reason: "Scheduled work-level metadata maintenance is due" });
    }
    return work;
  }

  function fillMissingWorkYear(workId, year) {
    if (!Number.isInteger(year) || year < 1800 || year > 3000) throw new Error("work year must be an integer from 1800 through 3000");
    const work = db.prepare("SELECT * FROM works WHERE id=?").get(workId);
    if (!work) throw new Error(`work not found: ${workId}`);
    if (work.year != null && work.year !== year) throw new Error(`work year conflict: existing ${work.year}, requested ${year}`);
    if (work.year == null) db.prepare("UPDATE works SET year=?, updated_at=? WHERE id=?").run(year, timestamp(), workId);
    return db.prepare("SELECT * FROM works WHERE id=?").get(workId);
  }

  function renameWork(workId, canonicalTitle, { expectedCurrent } = {}) {
    const work = db.prepare("SELECT * FROM works WHERE id=?").get(workId);
    if (!work) throw new Error(`work not found: ${workId}`);
    const nextTitle = String(canonicalTitle ?? "").trim();
    if (!nextTitle) throw new Error("canonical title is required");
    if (expectedCurrent != null && work.canonical_title !== expectedCurrent) {
      throw new Error(`work title mismatch: expected ${expectedCurrent}, got ${work.canonical_title}`);
    }
    if (work.canonical_title === nextTitle) return work;
    const conflict = db.prepare(`SELECT id FROM works
      WHERE canonical_title=? AND year IS ? AND work_type=? AND id<>?`)
      .get(nextTitle, work.year, work.work_type, workId);
    if (conflict) throw new Error(`work title conflicts with existing work ${conflict.id}`);
    const at = timestamp();
    db.prepare("UPDATE works SET canonical_title=?, updated_at=? WHERE id=?")
      .run(nextTitle, at, workId);
    insertEvent.run("work", workId, "work_title_changed", stableJson({
      from: work.canonical_title,
      to: nextTitle
    }), at);
    return db.prepare("SELECT * FROM works WHERE id=?").get(workId);
  }

  function upsertDiscoveredSource(input) {
    const at = timestamp();
    const fingerprintMatch = db.prepare("SELECT id FROM sources WHERE input_root_id = ? AND fingerprint = ?")
      .get(input.inputRootId, input.fingerprint);
    if (fingerprintMatch) {
      const current = db.prepare("SELECT * FROM sources WHERE id=?").get(fingerprintMatch.id);
      db.prepare(`UPDATE sources SET work_id=COALESCE(?, work_id), relative_path=?, absolute_path=?, source_kind=?,
        probe_path=COALESCE(?, probe_path), quality_state=CASE WHEN ? = 'unknown' THEN quality_state ELSE ? END,
        subtitle_evidence=?, audio_evidence=COALESCE(?, audio_evidence),
        color_risk=CASE WHEN ? = 'unknown' THEN color_risk ELSE ? END, missing=?, updated_at=? WHERE id=?`)
        .run(input.workId ?? null, input.relativePath, input.absolutePath, input.sourceKind, input.probePath ?? null,
          input.qualityState ?? "unknown", input.qualityState ?? "unknown",
          preserveProbeEvidence(current.subtitle_evidence, nullableJson(input.subtitleEvidence)),
          nullableJson(input.audioEvidence), input.colorRisk ?? "unknown", input.colorRisk ?? "unknown",
          input.missing ? 1 : 0, at, fingerprintMatch.id);
      const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(fingerprintMatch.id);
      if (source.work_id) {
        completeWorkflowTaskByKey(`intake:source:${source.id}`, { sourceId: source.id, workId: source.work_id, reason: "Source is bound to a verified work identity" });
        ensureWorkflowTask({ taskKey: `metadata:work:${source.work_id}`, taskType: "metadata_backfill", workId: source.work_id,
          priorityScore: db.prepare("SELECT priority_score FROM works WHERE id=?").get(source.work_id)?.priority_score ?? 0 });
      } else {
        ensureWorkflowTask({ taskKey: `intake:source:${source.id}`, taskType: "intake", sourceId: source.id,
          reason: "Discovered source needs identity, duplicate, and Notion-state analysis" });
      }
      return source;
    }
    db.prepare(`INSERT INTO sources (work_id, input_root_id, relative_path, absolute_path, fingerprint, source_kind, probe_path,
        quality_state, subtitle_evidence, audio_evidence, color_risk, missing, discovered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(input_root_id, relative_path) DO UPDATE SET
        work_id=COALESCE(excluded.work_id, sources.work_id), absolute_path=excluded.absolute_path,
        fingerprint=excluded.fingerprint, source_kind=excluded.source_kind,
        probe_path=COALESCE(excluded.probe_path, sources.probe_path),
        quality_state=CASE WHEN excluded.quality_state='unknown' THEN sources.quality_state ELSE excluded.quality_state END,
        subtitle_evidence=CASE WHEN json_extract(excluded.subtitle_evidence, '$.internalProbeState')='not_run'
          AND json_extract(sources.subtitle_evidence, '$.internalProbeState') IS NOT NULL
          AND json_extract(sources.subtitle_evidence, '$.internalProbeState') <> 'not_run'
          THEN sources.subtitle_evidence ELSE COALESCE(excluded.subtitle_evidence, sources.subtitle_evidence) END,
        audio_evidence=COALESCE(excluded.audio_evidence, sources.audio_evidence),
        color_risk=CASE WHEN excluded.color_risk='unknown' THEN sources.color_risk ELSE excluded.color_risk END,
        missing=excluded.missing, updated_at=excluded.updated_at`)
      .run(input.workId ?? null, input.inputRootId, input.relativePath, input.absolutePath, input.fingerprint,
        input.sourceKind, input.probePath ?? null, input.qualityState ?? "unknown", nullableJson(input.subtitleEvidence),
        nullableJson(input.audioEvidence), input.colorRisk ?? "unknown", input.missing ? 1 : 0, input.discoveredAt ?? at, at);
    const source = db.prepare("SELECT * FROM sources WHERE input_root_id = ? AND relative_path = ?").get(input.inputRootId, input.relativePath);
    if (source.work_id) {
      completeWorkflowTaskByKey(`intake:source:${source.id}`, { sourceId: source.id, workId: source.work_id, reason: "Source is bound to a verified work identity" });
      ensureWorkflowTask({ taskKey: `metadata:work:${source.work_id}`, taskType: "metadata_backfill", workId: source.work_id,
        priorityScore: db.prepare("SELECT priority_score FROM works WHERE id=?").get(source.work_id)?.priority_score ?? 0 });
    } else {
      ensureWorkflowTask({ taskKey: `intake:source:${source.id}`, taskType: "intake", sourceId: source.id,
        reason: "Discovered source needs identity, duplicate, and Notion-state analysis" });
    }
    return source;
  }

  function bindSourceToWork(sourceId, workId, details = {}) {
    const source = db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
    if (!source) throw new Error(`source not found: ${sourceId}`);
    const work = db.prepare("SELECT * FROM works WHERE id=?").get(workId);
    if (!work) throw new Error(`work not found: ${workId}`);
    if (source.work_id != null && source.work_id !== workId) {
      throw new Error(`source ${sourceId} is already bound to work ${source.work_id}`);
    }
    const at = timestamp();
    db.prepare(`UPDATE sources SET work_id=?, probe_path=COALESCE(?, probe_path), quality_state=COALESCE(?, quality_state),
      subtitle_evidence=COALESCE(?, subtitle_evidence), audio_evidence=COALESCE(?, audio_evidence), color_risk=COALESCE(?, color_risk), updated_at=? WHERE id=?`)
      .run(workId, details.probePath ?? null, details.qualityState ?? null,
        nullableJson(details.subtitleEvidence), nullableJson(details.audioEvidence), details.colorRisk ?? null, at, sourceId);
    completeWorkflowTaskByKey(`intake:source:${sourceId}`, {
      sourceId, workId,
      reason: details.reason ?? "Source is bound to a verified work identity"
    });
    ensureWorkflowTask({ taskKey: `metadata:work:${workId}`, taskType: "metadata_backfill", workId,
      priorityScore: work.priority_score, reason: "Work-level metadata should be checked independently of playable media readiness" });
    reconcileDeferredCollectionParents(source.input_root_id);
    return db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
  }

  function reconcileDeferredCollectionParents(inputRootId) {
    const allSources = db.prepare("SELECT id, relative_path, work_id FROM sources WHERE input_root_id=?").all(inputRootId);
    const parents = db.prepare(`SELECT workflow_tasks.id, workflow_tasks.task_key, sources.id AS source_id, sources.relative_path
      FROM workflow_tasks JOIN sources ON sources.id=workflow_tasks.source_id
      WHERE workflow_tasks.task_type='intake' AND workflow_tasks.status='deferred' AND sources.input_root_id=?`).all(inputRootId);
    for (const parent of parents) {
      const prefix = `${parent.relative_path}\\`.toLowerCase();
      const descendants = allSources.filter((source) => source.id !== parent.source_id && source.relative_path.toLowerCase().startsWith(prefix));
      const leaves = descendants.filter((source) => !descendants.some((other) => other.id !== source.id
        && other.relative_path.toLowerCase().startsWith(`${source.relative_path}\\`.toLowerCase())));
      if (leaves.length > 0 && leaves.every((source) => source.work_id != null)) {
        completeWorkflowTaskByKey(parent.task_key, {
          sourceId: parent.source_id,
          reason: `All ${leaves.length} collection member source(s) have verified work identities`
        });
      }
    }
  }

  function updateSourceEvidence(sourceId, details = {}) {
    const source = db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
    if (!source) throw new Error(`source not found: ${sourceId}`);
    const at = timestamp();
    db.prepare(`UPDATE sources SET probe_path=COALESCE(?, probe_path), quality_state=COALESCE(?, quality_state),
      subtitle_evidence=COALESCE(?, subtitle_evidence), audio_evidence=COALESCE(?, audio_evidence),
      color_risk=COALESCE(?, color_risk), updated_at=? WHERE id=?`)
      .run(details.probePath ?? null, details.qualityState ?? null,
        nullableJson(details.subtitleEvidence), nullableJson(details.audioEvidence), details.colorRisk ?? null, at, sourceId);
    insertEvent.run("source", sourceId, "source_evidence_updated", stableJson({
      probePath: details.probePath,
      qualityState: details.qualityState,
      subtitleEvidence: details.subtitleEvidence,
      audioEvidence: details.audioEvidence,
      colorRisk: details.colorRisk,
      reason: details.reason
    }), at);
    return db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
  }

  function splitSourceCollection(sourceId, members = [], details = {}) {
    const parent = db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
    if (!parent) throw new Error(`source not found: ${sourceId}`);
    if (!Array.isArray(members) || members.length === 0) throw new Error("collection split requires at least one member");
    const childSources = members.map((member) => upsertDiscoveredSource({
      ...member,
      inputRootId: parent.input_root_id,
      sourceKind: member.sourceKind ?? "collection_member",
      relativePath: member.relativePath ?? `${parent.relative_path}\\${path.win32.basename(member.absolutePath ?? "member")}`,
      qualityState: member.qualityState ?? "unknown",
      colorRisk: member.colorRisk ?? "unknown"
    }));
    const unbound = childSources.filter((source) => source.work_id == null);
    const parentTask = !unbound.length
      ? completeWorkflowTaskByKey(`intake:source:${sourceId}`, { sourceId, reason: details.reason ?? "Collection split into identified member sources" })
      : transitionWorkflowTask(
        db.prepare("SELECT id FROM workflow_tasks WHERE task_key=?").get(`intake:source:${sourceId}`)?.id,
        "deferred",
        { reason: `Collection split into ${childSources.length} member source(s); waiting for ${unbound.length} member identity decision(s)` }
      );
    insertEvent.run("source", sourceId, "source_collection_split", stableJson({
      memberSourceIds: childSources.map((source) => source.id),
      unboundMemberSourceIds: unbound.map((source) => source.id),
      reason: details.reason
    }), timestamp());
    reconcileDeferredCollectionParents(parent.input_root_id);
    return { parent: db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId), members: childSources, parentTask };
  }

  function ensureVariant(input) {
    const at = timestamp();
    const outputPath = input.outputPath == null ? null : normalizeLedgerPath(input.outputPath);
    db.prepare(`INSERT INTO variants (work_id, source_id, spec_key, display_title, audio_variant, subtitle_variant, cut_variant,
        target_size_bytes, output_path, probe_path, next_review_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(work_id, spec_key) DO UPDATE SET source_id=COALESCE(excluded.source_id, variants.source_id),
        display_title=excluded.display_title, audio_variant=excluded.audio_variant, subtitle_variant=excluded.subtitle_variant,
        cut_variant=excluded.cut_variant, target_size_bytes=COALESCE(excluded.target_size_bytes, variants.target_size_bytes),
        output_path=COALESCE(excluded.output_path, variants.output_path),
        probe_path=COALESCE(excluded.probe_path, variants.probe_path),
        next_review_at=COALESCE(excluded.next_review_at, variants.next_review_at), updated_at=excluded.updated_at`)
      .run(input.workId, input.sourceId ?? null, input.specKey, input.displayTitle, input.audioVariant ?? "unknown",
        input.subtitleVariant ?? "unknown", input.cutVariant ?? "theatrical", input.targetSizeBytes ?? null,
        outputPath, input.probePath ?? null, input.nextReviewAt ?? null, at, at);
    return db.prepare("SELECT * FROM variants WHERE work_id = ? AND spec_key = ?").get(input.workId, input.specKey);
  }

  function attachVariantSource(variantId, sourceId, details = {}) {
    return withTransaction(db, () => {
      const variant = getVariant.get(variantId);
      if (!variant) throw new Error(`variant not found: ${variantId}`);
      const source = db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
      if (!source) throw new Error(`source not found: ${sourceId}`);
      if (source.work_id == null) throw new Error(`source ${sourceId} is not bound to a work`);
      if (source.work_id !== variant.work_id) {
        throw new Error(`source ${sourceId} belongs to work ${source.work_id}, not variant work ${variant.work_id}`);
      }
      if (variant.source_id != null && variant.source_id !== sourceId) {
        throw new Error(`variant ${variantId} is already attached to source ${variant.source_id}`);
      }
      if (variant.source_id === sourceId) return variant;

      const at = timestamp();
      db.prepare("UPDATE variants SET source_id=?, updated_at=? WHERE id=?").run(sourceId, at, variantId);
      insertEvent.run("variant", variantId, "variant_source_attached", stableJson({
        sourceId,
        reason: details.reason ?? "Linked legacy production evidence to its verified source"
      }), at);
      return getVariant.get(variantId);
    });
  }

  function correctVariantSource(variantId, sourceId, details = {}) {
    return withTransaction(db, () => {
      const variant = getVariant.get(variantId);
      if (!variant) throw new Error(`variant not found: ${variantId}`);
      const source = db.prepare("SELECT * FROM sources WHERE id=?").get(sourceId);
      if (!source) throw new Error(`source not found: ${sourceId}`);
      if (source.work_id !== variant.work_id) {
        throw new Error(`source ${sourceId} belongs to work ${source.work_id}, not variant work ${variant.work_id}`);
      }
      if (variant.source_id === sourceId) return variant;

      const at = timestamp();
      db.prepare("UPDATE variants SET source_id=?, updated_at=? WHERE id=?").run(sourceId, at, variantId);
      insertEvent.run("variant", variantId, "variant_source_corrected", stableJson({
        previousSourceId: variant.source_id,
        sourceId,
        reason: details.reason ?? "Corrected the recorded source to the actual encode input"
      }), at);
      return getVariant.get(variantId);
    });
  }

  function transitionProduction(variantId, to, details = {}) {
    return withTransaction(db, () => {
      const current = getVariant.get(variantId);
      if (!current) throw new Error(`variant not found: ${variantId}`);
      assertProductionTransition(current.production_state, to);
      const at = timestamp();
      db.prepare(`UPDATE variants SET production_state=?, output_path=COALESCE(?, output_path),
        output_size_bytes=COALESCE(?, output_size_bytes), probe_path=COALESCE(?, probe_path),
        qc_artifact_path=COALESCE(?, qc_artifact_path), failure_code=?, failure_detail=?,
        next_review_at=?, publication_state=CASE
          WHEN ?='qc_passed' AND EXISTS (SELECT 1 FROM notion_targets WHERE variant_id=?) THEN 'structure_pending'
          WHEN ?='qc_passed' THEN 'not_ready'
          ELSE publication_state
        END,
        updated_at=? WHERE id=?`)
        .run(to, details.outputPath == null ? null : normalizeLedgerPath(details.outputPath),
          details.outputSizeBytes ?? null, details.probePath ?? null,
          details.qcArtifactPath ?? null, details.failureCode ?? null, details.failureDetail ?? null,
          details.nextReviewAt ?? null, to, variantId, to, at, variantId);
      insertEvent.run("variant", variantId, "production_state_changed",
        stableJson({ from: current.production_state, to, ...details }), at);
      return getVariant.get(variantId);
    });
  }

  function refreshProductionEvidence(variantId, details = {}) {
    return withTransaction(db, () => {
      const current = getVariant.get(variantId);
      if (!current) throw new Error(`variant not found: ${variantId}`);
      const at = timestamp();
      db.prepare(`UPDATE variants SET output_path=COALESCE(?, output_path),
        output_size_bytes=COALESCE(?, output_size_bytes), probe_path=COALESCE(?, probe_path),
        qc_artifact_path=COALESCE(?, qc_artifact_path), updated_at=? WHERE id=?`)
        .run(details.outputPath == null ? null : normalizeLedgerPath(details.outputPath),
          details.outputSizeBytes ?? null, details.probePath ?? null,
          details.qcArtifactPath ?? null, at, variantId);
      insertEvent.run("variant", variantId, "production_evidence_refreshed", stableJson(details), at);
      return getVariant.get(variantId);
    });
  }

  function transitionPublication(variantId, to, details = {}) {
    return withTransaction(db, () => {
      const current = getVariant.get(variantId);
      if (!current) throw new Error(`variant not found: ${variantId}`);
      assertPublicationTransition(current.publication_state, to);
      const at = timestamp();
      db.prepare("UPDATE variants SET publication_state=?, updated_at=? WHERE id=?").run(to, at, variantId);
      insertEvent.run("variant", variantId, "publication_state_changed",
        stableJson({ from: current.publication_state, to, ...details }), at);
      return getVariant.get(variantId);
    });
  }

  function registerNotionTarget(variantId, input) {
    const at = timestamp();
    return withTransaction(db, () => {
      const variant = getVariant.get(variantId);
      if (!variant) throw new Error(`variant not found: ${variantId}`);
      const existingTarget = db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(variantId);
      const finalExpectedFilename = input.replaceExpectedFilename === true
        ? input.expectedFilename ?? null
        : input.expectedFilename ?? existingTarget?.expected_filename ?? null;
      const finalMediaBlockId = input.clearMediaBlock === true
        ? null
        : input.mediaBlockId ?? existingTarget?.media_block_id ?? null;
      const targetChanged = Boolean(existingTarget) && (
        existingTarget.work_page_id !== input.workPageId
        || (input.seasonPageId != null && existingTarget.season_page_id !== input.seasonPageId)
        || existingTarget.spec_page_id !== input.specPageId
        || (input.episodePageId != null && existingTarget.episode_page_id !== input.episodePageId)
        || existingTarget.expected_filename !== finalExpectedFilename
        || existingTarget.media_block_id !== finalMediaBlockId
      );
      db.prepare(`INSERT INTO notion_targets (variant_id, work_page_id, season_page_id, spec_page_id, episode_page_id, expected_filename,
          media_block_id, media_asset_page_id, structure_verified_at, media_verified_at, assets_verified_at,
          next_check_at, attempt_count, last_error_code, last_error_detail, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(variant_id) DO UPDATE SET work_page_id=excluded.work_page_id,
          season_page_id=COALESCE(excluded.season_page_id, notion_targets.season_page_id), spec_page_id=excluded.spec_page_id,
          episode_page_id=COALESCE(excluded.episode_page_id, notion_targets.episode_page_id),
          expected_filename=CASE WHEN ? THEN excluded.expected_filename ELSE COALESCE(excluded.expected_filename, notion_targets.expected_filename) END,
          media_block_id=CASE WHEN ? THEN NULL ELSE COALESCE(excluded.media_block_id, notion_targets.media_block_id) END,
          media_asset_page_id=COALESCE(excluded.media_asset_page_id, notion_targets.media_asset_page_id),
          structure_verified_at=COALESCE(excluded.structure_verified_at, notion_targets.structure_verified_at),
          media_verified_at=COALESCE(excluded.media_verified_at, notion_targets.media_verified_at),
          assets_verified_at=COALESCE(excluded.assets_verified_at, notion_targets.assets_verified_at),
          next_check_at=COALESCE(excluded.next_check_at, notion_targets.next_check_at),
          attempt_count=excluded.attempt_count, last_error_code=excluded.last_error_code,
          last_error_detail=excluded.last_error_detail, updated_at=excluded.updated_at`)
        .run(variantId, input.workPageId, input.seasonPageId ?? null, input.specPageId, input.episodePageId ?? null, input.expectedFilename ?? null,
          input.mediaBlockId ?? null, input.mediaAssetPageId ?? null, input.structureVerifiedAt ?? null,
          input.mediaVerifiedAt ?? null, input.assetsVerifiedAt ?? null, input.nextCheckAt ?? null,
          input.attemptCount ?? 0, input.lastErrorCode ?? null, input.lastErrorDetail ?? null, at,
        input.replaceExpectedFilename === true ? 1 : 0, input.clearMediaBlock === true ? 1 : 0);
      if (targetChanged) resetNotionTargetEvidence(variantId, {
        reason: "Recorded Notion target identity changed; previous structure, media, and asset verification is stale.",
        at
      });
      insertEvent.run("variant", variantId, "notion_target_registered", stableJson(input), at);
      return db.prepare("SELECT * FROM notion_targets WHERE variant_id = ?").get(variantId);
    });
  }

  function resetNotionTargetEvidence(variantId, { reason = "Recorded Notion target was replaced and requires exact revalidation.", at = timestamp() } = {}) {
    const variant = getVariant.get(variantId);
    if (!variant) throw new Error(`variant not found: ${variantId}`);
    const target = db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(variantId);
    if (!target) throw new Error(`Notion target not found for variant ${variantId}`);
    db.prepare(`UPDATE notion_targets SET media_asset_page_id=NULL, structure_verified_at=NULL, media_verified_at=NULL,
      assets_verified_at=NULL, next_check_at=?, attempt_count=0, last_error_code=NULL, last_error_detail=NULL, updated_at=?
      WHERE variant_id=?`).run(at, at, variantId);
    if (variant.publication_state === "sync_ready") {
      db.prepare("UPDATE variants SET publication_state='structure_pending', updated_at=? WHERE id=?").run(at, variantId);
      insertEvent.run("variant", variantId, "publication_state_changed", stableJson({
        from: "sync_ready", to: "structure_pending", source: "notion_target_replacement"
      }), at);
    }
    insertEvent.run("variant", variantId, "notion_target_evidence_invalidated", stableJson({ reason }), at);
    return db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(variantId);
  }

  function listProductionCandidates({ limit } = {}) {
    return db.prepare(`SELECT 'variant' AS candidate_type, variants.*, works.priority_score, works.canonical_title,
        EXISTS (SELECT 1 FROM variants AS released
          WHERE released.work_id=variants.work_id AND released.publication_state='sync_ready') AS release_covered
      FROM variants JOIN works ON works.id=variants.work_id
      WHERE (
        (variants.production_state NOT IN ('qc_passed','rejected','deferred')
          AND (variants.next_review_at IS NULL OR variants.next_review_at <= ?)
          AND (works.next_review_at IS NULL OR works.next_review_at <= ?))
        OR (variants.production_state = 'deferred'
          AND variants.next_review_at IS NOT NULL AND variants.next_review_at <= ?
          AND (works.next_review_at IS NULL OR works.next_review_at <= ?))
      )
      ORDER BY works.priority_score DESC, variants.created_at ASC LIMIT ?`)
      .all(timestamp(), timestamp(), timestamp(), timestamp(), normalizeLimit(limit, 5, 50));
  }

  function listProductionSourceCandidates({ limit } = {}) {
    return db.prepare(`SELECT 'source_selection' AS candidate_type, sources.id AS source_id,
        sources.work_id, sources.relative_path, sources.absolute_path, sources.source_kind,
        sources.probe_path, sources.quality_state, sources.subtitle_evidence, sources.audio_evidence,
        sources.color_risk, sources.discovered_at, sources.updated_at,
        works.priority_score, works.canonical_title, works.year, works.work_type,
        'needs_selection' AS production_state,
        EXISTS (SELECT 1 FROM variants AS released
          WHERE released.work_id=sources.work_id AND released.publication_state='sync_ready') AS release_covered,
        'Bound source has no selected production variant yet' AS selection_reason
      FROM sources
      JOIN works ON works.id=sources.work_id
      JOIN input_roots ON input_roots.id=sources.input_root_id
      WHERE sources.missing=0
        AND sources.work_id IS NOT NULL
        AND input_roots.enabled=1
        -- Root-level flat-file groups can be real movie sources (for example
        -- "Z (1969)"). Only the synthetic per-episode groups are excluded;
        -- otherwise a newly scanned movie can disappear after intake binding.
        AND sources.relative_path NOT LIKE '@flat/episode %'
        AND sources.quality_state NOT IN ('unacceptable', 'rejected')
        AND (works.next_review_at IS NULL OR works.next_review_at <= ?)
        AND (
          COALESCE(works.workflow_status, '') NOT IN ('暂缓', '已完成')
          OR (
            works.workflow_status='已完成'
            AND EXISTS (
              SELECT 1 FROM workflow_tasks AS pending_intake
              WHERE pending_intake.source_id=sources.id
                AND pending_intake.task_type='intake'
                AND pending_intake.status='pending'
            )
          )
        )
        AND NOT EXISTS (SELECT 1 FROM variants WHERE variants.source_id=sources.id)
        -- A collection source is only an intake container after it has been
        -- split into independently tracked child sources. Do not offer the
        -- parent directory for production again; its child files are the
        -- real production candidates.
        AND NOT (
          sources.source_kind IN ('collection', 'collection_member', 'season_member', 'series_folder')
          AND EXISTS (
            SELECT 1
            FROM sources AS child_sources
            WHERE child_sources.id <> sources.id
              AND child_sources.input_root_id=sources.input_root_id
              AND child_sources.work_id=sources.work_id
              AND (
                child_sources.relative_path LIKE sources.relative_path || char(92) || '%'
                OR child_sources.absolute_path LIKE sources.absolute_path || char(92) || '%'
              )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM variants AS pending_variants
          WHERE pending_variants.work_id=sources.work_id
            AND pending_variants.production_state='qc_passed'
            AND pending_variants.publication_state IN ('structure_pending','upload_pending','upload_seen','assets_pending','verification_pending')
        )
      ORDER BY works.priority_score DESC, sources.discovered_at ASC LIMIT ?`)
      .all(timestamp(), normalizeLimit(limit, 5, 50));
  }

  function listProductionQueue({ limit } = {}) {
    const capped = normalizeLimit(limit, 5, 50);
    return [...listProductionSourceCandidates({ limit: capped }), ...listProductionCandidates({ limit: capped })]
      .sort((left, right) => Number(left.release_covered ?? 0) - Number(right.release_covered ?? 0)
        || Number(right.candidate_type === "variant") - Number(left.candidate_type === "variant")
        || Number(right.priority_score) - Number(left.priority_score)
        || String(left.discovered_at ?? left.created_at).localeCompare(String(right.discovered_at ?? right.created_at)))
      .slice(0, capped);
  }

  function listPublicationCandidates({ limit } = {}) {
    return db.prepare(`SELECT variants.*, works.priority_score, works.canonical_title
      FROM variants JOIN works ON works.id=variants.work_id
      LEFT JOIN notion_targets ON notion_targets.variant_id=variants.id
      WHERE variants.production_state='qc_passed' AND variants.publication_state<>'sync_ready'
        AND (notion_targets.variant_id IS NULL OR notion_targets.next_check_at IS NULL OR notion_targets.next_check_at <= ?)
      ORDER BY works.priority_score DESC, variants.created_at ASC LIMIT ?`)
      .all(timestamp(), normalizeLimit(limit, 3, 20));
  }

  function listManualUploadHandoffs({ limit } = {}) {
    return db.prepare(`SELECT variants.id AS variant_id, works.canonical_title AS work_title, works.year,
        variants.display_title AS spec_title, variants.output_path, variants.output_size_bytes,
        variants.publication_state, notion_targets.work_page_id, notion_targets.spec_page_id,
        notion_targets.episode_page_id, notion_targets.expected_filename
      FROM variants
      JOIN works ON works.id=variants.work_id
      JOIN notion_targets ON notion_targets.variant_id=variants.id
      WHERE variants.production_state='qc_passed'
        AND variants.publication_state<>'sync_ready'
        AND variants.output_path IS NOT NULL
        AND notion_targets.media_verified_at IS NULL
      ORDER BY works.priority_score DESC, variants.created_at ASC LIMIT ?`)
      .all(normalizeLimit(limit, 20, 50));
  }

  function getEvents({ entityType, entityId }) {
    return db.prepare("SELECT * FROM events WHERE entity_type=? AND entity_id=? ORDER BY id ASC").all(entityType, entityId);
  }

  function getStatusSummary() {
    const production = Object.fromEntries(db.prepare("SELECT production_state state, count(*) count FROM variants GROUP BY production_state").all().map(r => [r.state, r.count]));
    const publication = Object.fromEntries(db.prepare("SELECT publication_state state, count(*) count FROM variants GROUP BY publication_state").all().map(r => [r.state, r.count]));
    const handoff = Object.fromEntries(db.prepare("SELECT workflow_status state, count(*) count FROM works WHERE workflow_status IS NOT NULL GROUP BY workflow_status").all().map(r => [r.state, r.count]));
    const totals = db.prepare("SELECT count(*) variants, sum(CASE WHEN publication_state='sync_ready' THEN 1 ELSE 0 END) syncReady FROM variants").get();
    return { production, publication, handoff, totals: { variants: totals.variants, syncReady: totals.syncReady ?? 0 } };
  }

  function listSourcesForRoot(inputRootId) {
    return db.prepare("SELECT * FROM sources WHERE input_root_id = ? ORDER BY id").all(inputRootId);
  }

  function listWorkflowTasks({ taskType, status = "pending", limit = 5 } = {}) {
    const types = taskType ? [taskType] : ["intake", "metadata_backfill"];
    const placeholders = types.map(() => "?").join(",");
    return db.prepare(`SELECT workflow_tasks.*, sources.relative_path, sources.absolute_path, sources.quality_state,
        sources.subtitle_evidence, sources.color_risk, works.canonical_title, works.year, works.work_type,
        works.notion_work_page_id, works.scope_state
      FROM workflow_tasks
      LEFT JOIN sources ON sources.id=workflow_tasks.source_id
      LEFT JOIN works ON works.id=workflow_tasks.work_id
      WHERE workflow_tasks.task_type IN (${placeholders}) AND workflow_tasks.status=?
        AND (workflow_tasks.next_run_at IS NULL OR workflow_tasks.next_run_at <= ?)
      ORDER BY workflow_tasks.priority_score DESC, workflow_tasks.created_at ASC LIMIT ?`)
      .all(...types, status, timestamp(), normalizeLimit(limit, 5, 20));
  }

  function getWorkflowTaskSummary() {
    return Object.fromEntries(db.prepare("SELECT task_type || ':' || status AS key, count(*) AS count FROM workflow_tasks GROUP BY task_type, status")
      .all().map(row => [row.key, row.count]));
  }

  function recordWorkHandoff(workId, input, { enforceTransition = false } = {}) {
    const work = db.prepare("SELECT * FROM works WHERE id=?").get(workId);
    if (!work) throw new Error(`work not found: ${workId}`);
    assertWorkflowHandoffState(input.status);
    if (enforceTransition) assertWorkflowHandoffTransition(work.workflow_status, input.status);
    const observedAt = input.observedAt ?? timestamp();
    const note = input.note == null ? work.workflow_note : String(input.note);
    const changed = work.workflow_status !== input.status || work.workflow_note !== note;
    db.prepare(`UPDATE works SET workflow_status=?, workflow_note=?, workflow_status_observed_at=?,
      updated_at=CASE WHEN ? THEN ? ELSE updated_at END WHERE id=?`)
      .run(input.status, note ?? null, observedAt, changed ? 1 : 0, observedAt, workId);
    if (changed) {
      insertEvent.run("work", workId, "workflow_handoff_changed", stableJson({
        from: work.workflow_status,
        to: input.status,
        note: note ?? null,
        actor: input.actor ?? "unknown",
        notionPageId: work.notion_work_page_id ?? null
      }), observedAt);
    }
    return { row: db.prepare("SELECT * FROM works WHERE id=?").get(workId), changed };
  }

  function recordWorkHandoffByNotionPage(notionPageId, input, options) {
    const work = db.prepare("SELECT * FROM works WHERE notion_work_page_id=?").get(notionPageId);
    if (!work) return { row: null, changed: false, unmatched: true };
    return { ...recordWorkHandoff(work.id, input, options), unmatched: false };
  }

  function listWorkHandoffs({ statuses = AI_ACTIONABLE_WORKFLOW_STATES, limit = 3 } = {}) {
    const values = [...new Set(statuses)];
    for (const status of values) assertWorkflowHandoffState(status);
    if (values.length === 0) return [];
    const placeholders = values.map(() => "?").join(",");
    return db.prepare(`SELECT * FROM works WHERE workflow_status IN (${placeholders})
      ORDER BY priority_score DESC, COALESCE(workflow_status_observed_at, created_at) ASC, id ASC LIMIT ?`)
      .all(...values, normalizeLimit(limit, 3, 3));
  }

  function refreshDueMetadataTasks({ now = timestamp(), limit = 20 } = {}) {
    const dueWorks = db.prepare(`SELECT works.id, works.priority_score,
        'Scheduled catalog maintenance is due' AS reason
      FROM works
      WHERE works.next_review_at IS NOT NULL AND works.next_review_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM workflow_tasks
          WHERE workflow_tasks.task_key = 'metadata:work:' || works.id
            AND workflow_tasks.status = 'deferred'
            AND workflow_tasks.next_run_at IS NOT NULL
            AND workflow_tasks.next_run_at > ?
        )
      UNION ALL
      SELECT workflow_tasks.work_id AS id,
        COALESCE(workflow_tasks.priority_score, works.priority_score) AS priority_score,
        'Deferred metadata review is due' AS reason
      FROM workflow_tasks
      JOIN works ON works.id=workflow_tasks.work_id
      WHERE workflow_tasks.task_type='metadata_backfill'
        AND workflow_tasks.status='deferred'
        AND workflow_tasks.next_run_at IS NOT NULL
        AND workflow_tasks.next_run_at <= ?`).all(now, now, now);
    const uniqueDueWorks = [...new Map(dueWorks.map((work) => [work.id, work])).values()]
      .sort((left, right) => (right.priority_score - left.priority_score) || (left.id - right.id))
      .slice(0, normalizeLimit(limit, 1, 20));
    return uniqueDueWorks.map((work) => requeueMetadataTask(work.id, {
      reason: work.reason,
      priorityScore: work.priority_score
    }));
  }

  function transitionWorkflowTask(taskId, status, details = {}) {
    if (!["pending", "in_progress", "waiting_user", "deferred", "done"].includes(status)) {
      throw new Error(`unsupported workflow task status: ${status}`);
    }
    const at = timestamp();
    const task = db.prepare("SELECT * FROM workflow_tasks WHERE id=?").get(taskId);
    if (!task) throw new Error(`workflow task not found: ${taskId}`);
    const result = db.prepare(`UPDATE workflow_tasks SET status=?, reason=COALESCE(?, reason), last_error=?,
      next_run_at=?, updated_at=? WHERE id=?`).run(status, details.reason ?? null, details.lastError ?? null,
      details.nextRunAt ?? null, at, taskId);
    if (status === "done" && task.task_type === "metadata_backfill" && task.work_id) {
      const work = db.prepare("SELECT next_review_at FROM works WHERE id=?").get(task.work_id);
      if (work?.next_review_at && work.next_review_at <= at && details.nextRunAt == null) {
        const nextReviewAt = new Date(new Date(at).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
        db.prepare("UPDATE works SET next_review_at=?, updated_at=? WHERE id=?")
          .run(nextReviewAt, at, task.work_id);
        insertEvent.run("work", task.work_id, "metadata_review_scheduled", stableJson({
          nextReviewAt,
          reason: "Completed metadata maintenance; schedule the next bounded review"
        }), at);
      }
    }
    insertEvent.run("workflow_task", taskId, "workflow_task_status_changed", stableJson({ status, ...details }), at);
    return db.prepare("SELECT * FROM workflow_tasks WHERE id=?").get(taskId);
  }

  function markSourceMissing(sourceId, missing = true) {
    const at = timestamp();
    db.prepare("UPDATE sources SET missing = ?, updated_at = ? WHERE id = ?").run(missing ? 1 : 0, at, sourceId);
    if (missing) {
      db.prepare(`UPDATE workflow_tasks
        SET status='done', reason='Source is no longer present in the configured input root',
            next_run_at=NULL, updated_at=?
        WHERE source_id=? AND task_type='intake' AND status IN ('pending','in_progress','waiting_user')`)
        .run(at, sourceId);
    }
    return db.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId);
  }

  function listDueNotionTargets({ limit = 3, now: dueAt = timestamp(), variantIds = [] } = {}) {
    const ids = (variantIds ?? []).map(Number).filter(Number.isInteger);
    const variantClause = ids.length > 0 ? ` AND variants.id IN (${ids.map(() => "?").join(",")})` : "";
    const dueClause = ids.length > 0 ? "" : " AND (notion_targets.next_check_at IS NULL OR notion_targets.next_check_at <= ?)";
    return db.prepare(`SELECT notion_targets.*, variants.publication_state, variants.production_state,
        works.id AS work_id, works.canonical_title, works.work_type
      FROM notion_targets JOIN variants ON variants.id=notion_targets.variant_id
      JOIN works ON works.id=variants.work_id
      WHERE variants.production_state='qc_passed' AND variants.publication_state<>'sync_ready'
        ` + dueClause + variantClause + `
      ORDER BY notion_targets.updated_at ASC, notion_targets.variant_id ASC LIMIT ?`)
      .all(...(ids.length > 0 ? [] : [dueAt]), ...ids, normalizeLimit(limit, 3, 3));
  }

  function getSchedulerState(key) {
    return db.prepare("SELECT value FROM scheduler_state WHERE key=?").get(key)?.value ?? null;
  }

  function setSchedulerState(key, value, updatedAt = timestamp()) {
    db.prepare(`INSERT INTO scheduler_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, value, updatedAt);
  }

  function recordNotionInspection(variantId, evidence, inspectedAt = timestamp(), nextCheckAt = null) {
    db.prepare(`UPDATE notion_targets SET
      media_block_id=CASE WHEN ? THEN ? ELSE media_block_id END,
      media_asset_page_id=CASE WHEN ? THEN ? ELSE media_asset_page_id END,
      structure_verified_at=CASE WHEN ? THEN ? ELSE structure_verified_at END,
      media_verified_at=CASE WHEN ? THEN ? ELSE media_verified_at END,
      assets_verified_at=CASE WHEN ? THEN ? ELSE assets_verified_at END,
      next_check_at=?, attempt_count=CASE WHEN ? IS NULL THEN 0 ELSE attempt_count + 1 END,
      last_error_code=?, last_error_detail=?, updated_at=? WHERE variant_id=?`)
      .run(evidence.mediaVerified === true ? 1 : 0, evidence.mediaBlockId ?? null,
        evidence.mediaAssetPageId != null ? 1 : 0, evidence.mediaAssetPageId ?? null,
        evidence.structureVerified === true ? 1 : 0, inspectedAt,
        evidence.mediaVerified === true ? 1 : 0, inspectedAt,
        evidence.assetsVerified === true ? 1 : 0, inspectedAt,
        nextCheckAt, nextCheckAt, evidence.assetGateCode ?? null, evidence.assetGateDetail ?? null, inspectedAt, variantId);
  }

  function recordNotionFailure(variantId, { code, detail, nextCheckAt }, failedAt = timestamp()) {
    db.prepare(`UPDATE notion_targets SET next_check_at=?, attempt_count=attempt_count + 1,
      last_error_code=?, last_error_detail=?, updated_at=? WHERE variant_id=?`)
      .run(nextCheckAt, code, detail, failedAt, variantId);
  }

  function findVariantByOutputPath(outputPath) {
    return db.prepare("SELECT * FROM variants WHERE output_path = ?").get(normalizeLedgerPath(outputPath)) ?? null;
  }

  function findVariantByNotionTarget({ workPageId, specPageId, episodePageId = null }) {
    return db.prepare(`SELECT variants.*
      FROM notion_targets
      JOIN variants ON variants.id=notion_targets.variant_id
      WHERE notion_targets.work_page_id=? AND notion_targets.spec_page_id=?
        AND notion_targets.episode_page_id IS ?`)
      .get(workPageId, specPageId, episodePageId) ?? null;
  }

  function mergeDuplicateVariant(duplicateId, canonicalId) {
    return withTransaction(db, () => {
      if (duplicateId === canonicalId) throw new Error("duplicate and canonical variant must differ");
      const duplicate = getVariant.get(duplicateId);
      const canonical = getVariant.get(canonicalId);
      if (!duplicate || !canonical) throw new Error("duplicate and canonical variants must both exist");
      if (duplicate.work_id !== canonical.work_id) throw new Error("duplicate variants must belong to the same work");
      const duplicateTarget = db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(duplicateId);
      const canonicalTarget = db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(canonicalId);
      if (duplicateTarget && canonicalTarget) {
        const sameTarget = duplicateTarget.work_page_id === canonicalTarget.work_page_id
          && duplicateTarget.spec_page_id === canonicalTarget.spec_page_id
          && duplicateTarget.episode_page_id === canonicalTarget.episode_page_id;
        if (!sameTarget) throw new Error("duplicate variants have different Notion targets");
      }
      const at = timestamp();
      db.prepare(`UPDATE variants SET source_id=COALESCE(?, source_id), display_title=?, audio_variant=?,
        subtitle_variant=?, cut_variant=?, target_size_bytes=COALESCE(?, target_size_bytes),
        output_path=COALESCE(?, output_path), output_size_bytes=COALESCE(?, output_size_bytes),
        probe_path=COALESCE(?, probe_path), qc_artifact_path=COALESCE(?, qc_artifact_path),
        updated_at=? WHERE id=?`)
        .run(duplicate.source_id, duplicate.display_title, duplicate.audio_variant,
          duplicate.subtitle_variant, duplicate.cut_variant, duplicate.target_size_bytes,
          duplicate.output_path, duplicate.output_size_bytes, duplicate.probe_path,
          duplicate.qc_artifact_path, at, canonicalId);
      if (!canonicalTarget && duplicateTarget) {
        db.prepare("UPDATE notion_targets SET variant_id=?, updated_at=? WHERE variant_id=?")
          .run(canonicalId, at, duplicateId);
      } else {
        db.prepare("DELETE FROM notion_targets WHERE variant_id=?").run(duplicateId);
      }
      db.prepare("UPDATE workflow_tasks SET variant_id=?, updated_at=? WHERE variant_id=?")
        .run(canonicalId, at, duplicateId);
      db.prepare("UPDATE events SET entity_id=? WHERE entity_type='variant' AND entity_id=?")
        .run(canonicalId, duplicateId);
      db.prepare("DELETE FROM variants WHERE id=?").run(duplicateId);
      insertEvent.run("variant", canonicalId, "variant_duplicate_merged",
        stableJson({ duplicateVariantId: duplicateId, canonicalVariantId: canonicalId }), at);
      return getVariant.get(canonicalId);
    });
  }

  function applyMigrationCorrection(variantId, correction) {
    return withTransaction(db, () => {
      const current = getVariant.get(variantId);
      if (!current) throw new Error(`variant not found: ${variantId}`);
      if (correction.productionState && !new Set(["qc_failed", "deferred"]).has(correction.productionState)) {
        throw new Error("migration productionState must be qc_failed or deferred");
      }
      const desired = {
        specKey: correction.specKey ?? current.spec_key,
        displayTitle: correction.displayTitle ?? current.display_title,
        audioVariant: correction.audioVariant ?? current.audio_variant,
        subtitleVariant: correction.subtitleVariant ?? current.subtitle_variant,
        productionState: correction.productionState ?? current.production_state,
        failureCode: correction.failureCode ?? current.failure_code,
        failureDetail: correction.failureDetail ?? current.failure_detail
      };
      const unchanged = desired.specKey === current.spec_key
        && desired.displayTitle === current.display_title
        && desired.audioVariant === current.audio_variant
        && desired.subtitleVariant === current.subtitle_variant
        && desired.productionState === current.production_state
        && desired.failureCode === current.failure_code
        && desired.failureDetail === current.failure_detail;
      if (unchanged) return { row: current, applied: false };
      const at = timestamp();
      db.prepare(`UPDATE variants SET spec_key=COALESCE(?, spec_key), display_title=COALESCE(?, display_title),
        audio_variant=COALESCE(?, audio_variant), subtitle_variant=COALESCE(?, subtitle_variant),
        production_state=COALESCE(?, production_state), failure_code=COALESCE(?, failure_code),
        failure_detail=COALESCE(?, failure_detail), updated_at=? WHERE id=?`)
        .run(correction.specKey ?? null, correction.displayTitle ?? null, correction.audioVariant ?? null,
          correction.subtitleVariant ?? null, correction.productionState ?? null,
          correction.failureCode ?? null, correction.failureDetail ?? null, at, variantId);
      insertEvent.run("variant", variantId, "human_review_correction",
        stableJson({ from: {
          specKey: current.spec_key,
          displayTitle: current.display_title,
          audioVariant: current.audio_variant,
          subtitleVariant: current.subtitle_variant,
          productionState: current.production_state
        }, correction }), at);
      return { row: getVariant.get(variantId), applied: true };
    });
  }

  return { upsertInputRoot, setInputRootEnabled, upsertDiscoveredSource, bindSourceToWork, updateSourceEvidence, splitSourceCollection, ensureWork, fillMissingWorkYear, renameWork, ensureVariant, attachVariantSource, correctVariantSource, transitionProduction,
    refreshProductionEvidence,
    transitionPublication, registerNotionTarget, resetNotionTargetEvidence, listProductionCandidates, listProductionSourceCandidates, listProductionQueue, listPublicationCandidates, listManualUploadHandoffs,
    getStatusSummary, getEvents, listSourcesForRoot, markSourceMissing, listDueNotionTargets,
    getSchedulerState, setSchedulerState, recordNotionInspection, recordNotionFailure,
    findVariantByOutputPath, findVariantByNotionTarget, mergeDuplicateVariant, applyMigrationCorrection,
    ensureWorkflowTask, requeueMetadataTask, requeueIntakeTask, listWorkflowTasks,
    getWorkflowTaskSummary, refreshDueMetadataTasks, refreshDueIntakeTasks, transitionWorkflowTask,
    recordWorkHandoff, recordWorkHandoffByNotionPage, listWorkHandoffs };
}
