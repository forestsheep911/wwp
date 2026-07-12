import { withTransaction } from "./film-ledger-schema.mjs";
import { assertProductionTransition, assertPublicationTransition, normalizeLimit } from "./film-ledger-domain.mjs";

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

  function upsertInputRoot(rootPath, options = {}) {
    const at = timestamp();
    db.prepare(`INSERT INTO input_roots (path, enabled, last_scan_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET enabled=excluded.enabled,
        last_scan_at=COALESCE(excluded.last_scan_at, input_roots.last_scan_at), updated_at=excluded.updated_at`)
      .run(rootPath, options.enabled === false ? 0 : 1, options.lastScanAt ?? null, at, at);
    return db.prepare("SELECT * FROM input_roots WHERE path = ?").get(rootPath);
  }

  function ensureWork(input) {
    const at = timestamp();
    const key = [input.canonicalTitle, input.year ?? null, input.workType ?? "movie"];
    const existing = db.prepare("SELECT * FROM works WHERE canonical_title = ? AND year IS ? AND work_type = ?").get(...key);
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
    return db.prepare("SELECT * FROM works WHERE canonical_title = ? AND year IS ? AND work_type = ?").get(...key);
  }

  function upsertDiscoveredSource(input) {
    const at = timestamp();
    const fingerprintMatch = db.prepare("SELECT id FROM sources WHERE input_root_id = ? AND fingerprint = ?")
      .get(input.inputRootId, input.fingerprint);
    if (fingerprintMatch) {
      db.prepare(`UPDATE sources SET work_id=COALESCE(?, work_id), relative_path=?, absolute_path=?, source_kind=?,
        probe_path=COALESCE(?, probe_path), quality_state=?, subtitle_evidence=COALESCE(?, subtitle_evidence),
        audio_evidence=COALESCE(?, audio_evidence), color_risk=?, missing=?, updated_at=? WHERE id=?`)
        .run(input.workId ?? null, input.relativePath, input.absolutePath, input.sourceKind, input.probePath ?? null,
          input.qualityState ?? "unknown", nullableJson(input.subtitleEvidence), nullableJson(input.audioEvidence),
          input.colorRisk ?? "unknown", input.missing ? 1 : 0, at, fingerprintMatch.id);
      return db.prepare("SELECT * FROM sources WHERE id = ?").get(fingerprintMatch.id);
    }
    db.prepare(`INSERT INTO sources (work_id, input_root_id, relative_path, absolute_path, fingerprint, source_kind, probe_path,
        quality_state, subtitle_evidence, audio_evidence, color_risk, missing, discovered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(input_root_id, relative_path) DO UPDATE SET
        work_id=COALESCE(excluded.work_id, sources.work_id), absolute_path=excluded.absolute_path,
        fingerprint=excluded.fingerprint, source_kind=excluded.source_kind,
        probe_path=COALESCE(excluded.probe_path, sources.probe_path), quality_state=excluded.quality_state,
        subtitle_evidence=COALESCE(excluded.subtitle_evidence, sources.subtitle_evidence),
        audio_evidence=COALESCE(excluded.audio_evidence, sources.audio_evidence), color_risk=excluded.color_risk,
        missing=excluded.missing, updated_at=excluded.updated_at`)
      .run(input.workId ?? null, input.inputRootId, input.relativePath, input.absolutePath, input.fingerprint,
        input.sourceKind, input.probePath ?? null, input.qualityState ?? "unknown", nullableJson(input.subtitleEvidence),
        nullableJson(input.audioEvidence), input.colorRisk ?? "unknown", input.missing ? 1 : 0, input.discoveredAt ?? at, at);
    return db.prepare("SELECT * FROM sources WHERE input_root_id = ? AND relative_path = ?").get(input.inputRootId, input.relativePath);
  }

  function ensureVariant(input) {
    const at = timestamp();
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
        input.outputPath ?? null, input.probePath ?? null, input.nextReviewAt ?? null, at, at);
    return db.prepare("SELECT * FROM variants WHERE work_id = ? AND spec_key = ?").get(input.workId, input.specKey);
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
        next_review_at=?, publication_state=CASE WHEN ?='qc_passed' THEN 'not_ready' ELSE publication_state END,
        updated_at=? WHERE id=?`)
        .run(to, details.outputPath ?? null, details.outputSizeBytes ?? null, details.probePath ?? null,
          details.qcArtifactPath ?? null, details.failureCode ?? null, details.failureDetail ?? null,
          details.nextReviewAt ?? null, to, at, variantId);
      insertEvent.run("variant", variantId, "production_state_changed",
        stableJson({ from: current.production_state, to, ...details }), at);
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
      if (!getVariant.get(variantId)) throw new Error(`variant not found: ${variantId}`);
      db.prepare(`INSERT INTO notion_targets (variant_id, work_page_id, spec_page_id, episode_page_id, expected_filename,
          media_block_id, media_asset_page_id, structure_verified_at, media_verified_at, assets_verified_at,
          next_check_at, attempt_count, last_error_code, last_error_detail, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(variant_id) DO UPDATE SET work_page_id=excluded.work_page_id, spec_page_id=excluded.spec_page_id,
          episode_page_id=COALESCE(excluded.episode_page_id, notion_targets.episode_page_id),
          expected_filename=COALESCE(excluded.expected_filename, notion_targets.expected_filename),
          media_block_id=COALESCE(excluded.media_block_id, notion_targets.media_block_id),
          media_asset_page_id=COALESCE(excluded.media_asset_page_id, notion_targets.media_asset_page_id),
          structure_verified_at=COALESCE(excluded.structure_verified_at, notion_targets.structure_verified_at),
          media_verified_at=COALESCE(excluded.media_verified_at, notion_targets.media_verified_at),
          assets_verified_at=COALESCE(excluded.assets_verified_at, notion_targets.assets_verified_at),
          next_check_at=COALESCE(excluded.next_check_at, notion_targets.next_check_at),
          attempt_count=excluded.attempt_count, last_error_code=excluded.last_error_code,
          last_error_detail=excluded.last_error_detail, updated_at=excluded.updated_at`)
        .run(variantId, input.workPageId, input.specPageId, input.episodePageId ?? null, input.expectedFilename ?? null,
          input.mediaBlockId ?? null, input.mediaAssetPageId ?? null, input.structureVerifiedAt ?? null,
          input.mediaVerifiedAt ?? null, input.assetsVerifiedAt ?? null, input.nextCheckAt ?? null,
          input.attemptCount ?? 0, input.lastErrorCode ?? null, input.lastErrorDetail ?? null, at);
      insertEvent.run("variant", variantId, "notion_target_registered", stableJson(input), at);
      return db.prepare("SELECT * FROM notion_targets WHERE variant_id = ?").get(variantId);
    });
  }

  function listProductionCandidates({ limit } = {}) {
    return db.prepare(`SELECT variants.*, works.priority_score, works.canonical_title
      FROM variants JOIN works ON works.id=variants.work_id
      WHERE variants.production_state NOT IN ('qc_passed','rejected')
        AND (variants.next_review_at IS NULL OR variants.next_review_at <= ?)
        AND (works.next_review_at IS NULL OR works.next_review_at <= ?)
      ORDER BY works.priority_score DESC, variants.created_at ASC LIMIT ?`)
      .all(timestamp(), timestamp(), normalizeLimit(limit, 5, 50));
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

  function getEvents({ entityType, entityId }) {
    return db.prepare("SELECT * FROM events WHERE entity_type=? AND entity_id=? ORDER BY id ASC").all(entityType, entityId);
  }

  function getStatusSummary() {
    const production = Object.fromEntries(db.prepare("SELECT production_state state, count(*) count FROM variants GROUP BY production_state").all().map(r => [r.state, r.count]));
    const publication = Object.fromEntries(db.prepare("SELECT publication_state state, count(*) count FROM variants GROUP BY publication_state").all().map(r => [r.state, r.count]));
    const totals = db.prepare("SELECT count(*) variants, sum(CASE WHEN publication_state='sync_ready' THEN 1 ELSE 0 END) syncReady FROM variants").get();
    return { production, publication, totals: { variants: totals.variants, syncReady: totals.syncReady ?? 0 } };
  }

  function listSourcesForRoot(inputRootId) {
    return db.prepare("SELECT * FROM sources WHERE input_root_id = ? ORDER BY id").all(inputRootId);
  }

  function markSourceMissing(sourceId, missing = true) {
    const at = timestamp();
    db.prepare("UPDATE sources SET missing = ?, updated_at = ? WHERE id = ?").run(missing ? 1 : 0, at, sourceId);
    return db.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId);
  }

  function listDueNotionTargets({ limit = 3, now: dueAt = timestamp() } = {}) {
    return db.prepare(`SELECT notion_targets.*, variants.publication_state, variants.production_state
      FROM notion_targets JOIN variants ON variants.id=notion_targets.variant_id
      WHERE variants.production_state='qc_passed' AND variants.publication_state<>'sync_ready'
        AND (notion_targets.next_check_at IS NULL OR notion_targets.next_check_at <= ?)
      ORDER BY notion_targets.updated_at ASC, notion_targets.variant_id ASC LIMIT ?`)
      .all(dueAt, normalizeLimit(limit, 3, 3));
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
      last_error_code=NULL, last_error_detail=NULL, updated_at=? WHERE variant_id=?`)
      .run(evidence.mediaVerified === true ? 1 : 0, evidence.mediaBlockId ?? null,
        evidence.assetsVerified === true ? 1 : 0, evidence.mediaAssetPageId ?? null,
        evidence.structureVerified === true ? 1 : 0, inspectedAt,
        evidence.mediaVerified === true ? 1 : 0, inspectedAt,
        evidence.assetsVerified === true ? 1 : 0, inspectedAt,
        nextCheckAt, nextCheckAt, inspectedAt, variantId);
  }

  function recordNotionFailure(variantId, { code, detail, nextCheckAt }, failedAt = timestamp()) {
    db.prepare(`UPDATE notion_targets SET next_check_at=?, attempt_count=attempt_count + 1,
      last_error_code=?, last_error_detail=?, updated_at=? WHERE variant_id=?`)
      .run(nextCheckAt, code, detail, failedAt, variantId);
  }

  function findVariantByOutputPath(outputPath) {
    return db.prepare("SELECT * FROM variants WHERE output_path = ?").get(outputPath) ?? null;
  }

  function applyMigrationCorrection(variantId, correction) {
    return withTransaction(db, () => {
      const current = getVariant.get(variantId);
      if (!current) throw new Error(`variant not found: ${variantId}`);
      if (correction.productionState && !new Set(["qc_failed", "deferred"]).has(correction.productionState)) {
        throw new Error("migration productionState must be qc_failed or deferred");
      }
      const at = timestamp();
      db.prepare(`UPDATE variants SET audio_variant=COALESCE(?, audio_variant),
        production_state=COALESCE(?, production_state), failure_code=COALESCE(?, failure_code),
        failure_detail=COALESCE(?, failure_detail), updated_at=? WHERE id=?`)
        .run(correction.audioVariant ?? null, correction.productionState ?? null,
          correction.failureCode ?? null, correction.failureDetail ?? null, at, variantId);
      insertEvent.run("variant", variantId, "human_review_correction",
        stableJson({ from: { audioVariant: current.audio_variant, productionState: current.production_state }, correction }), at);
      return getVariant.get(variantId);
    });
  }

  return { upsertInputRoot, upsertDiscoveredSource, ensureWork, ensureVariant, transitionProduction,
    transitionPublication, registerNotionTarget, listProductionCandidates, listPublicationCandidates,
    getStatusSummary, getEvents, listSourcesForRoot, markSourceMissing, listDueNotionTargets,
    getSchedulerState, setSchedulerState, recordNotionInspection, recordNotionFailure,
    findVariantByOutputPath, applyMigrationCorrection };
}
