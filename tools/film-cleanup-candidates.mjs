#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openLedger } from "./lib/film-ledger-schema.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");
const DEFAULT_OUTPUT_ROOT = "E:\\video_made";
const DEFAULT_MANIFEST_DIR = path.resolve(".local-data");

function parseArgs(args) {
  const options = { db: DEFAULT_DB, outputRoot: DEFAULT_OUTPUT_ROOT, manifestDir: DEFAULT_MANIFEST_DIR, json: false, apply: false, limit: null, candidateType: "all", variantId: null, sourceId: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--db") options.db = path.resolve(args[++index]);
    else if (arg === "--output-root") options.outputRoot = path.resolve(args[++index]);
    else if (arg === "--manifest-dir") options.manifestDir = path.resolve(args[++index]);
    else if (arg === "--quarantine-dir") options.quarantineDir = path.resolve(args[++index]);
    else if (arg === "--limit") options.limit = Number(args[++index]);
    else if (arg === "--variant-id") options.variantId = Number(args[++index]);
    else if (arg === "--source-id") options.sourceId = Number(args[++index]);
    else if (arg === "--coverage-reason") options.coverageReason = args[++index];
    else if (arg === "--candidate-type") options.candidateType = args[++index];
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--allow-reviewed-uncovered-media") options.allowReviewedUncoveredMedia = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/film-cleanup-candidates.mjs [--output-root E:\\video_made] [--manifest-dir .local-data] [--quarantine-dir <dir>] [--candidate-type all|playable_output|uploaded_output|source_input] [--variant-id <id>] [--source-id <id>] [--allow-reviewed-uncovered-media --coverage-reason <reason>] [--limit <n>] [--apply] [--json]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.limit != null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  for (const [name, value] of [["--variant-id", options.variantId], ["--source-id", options.sourceId]]) {
    if (value != null && (!Number.isInteger(value) || value < 1)) throw new Error(`${name} must be a positive integer`);
  }
  if (options.variantId != null && options.sourceId != null) throw new Error("--variant-id and --source-id are mutually exclusive");
  if (options.allowReviewedUncoveredMedia && options.sourceId == null) throw new Error("--allow-reviewed-uncovered-media requires --source-id");
  if (options.allowReviewedUncoveredMedia && !String(options.coverageReason ?? "").trim()) throw new Error("--allow-reviewed-uncovered-media requires --coverage-reason");
  if (options.coverageReason && !options.allowReviewedUncoveredMedia) throw new Error("--coverage-reason requires --allow-reviewed-uncovered-media");
  if (!["all", "playable_output", "uploaded_output", "source_input"].includes(options.candidateType)) {
    throw new Error("--candidate-type must be all|playable_output|uploaded_output|source_input");
  }
  return options;
}

function quarantineDirectory(filePath, override) {
  if (override) return override;
  return path.join(path.parse(path.resolve(filePath)).root, "待人工删除");
}

function uniqueQuarantinePath(sourcePath, quarantineDir, prefix) {
  const extension = path.extname(sourcePath);
  const base = path.basename(sourcePath, extension);
  let destination = path.join(quarantineDir, `${base}.${prefix}${extension}`);
  let suffix = 2;
  while (fs.existsSync(destination)) {
    destination = path.join(quarantineDir, `${base}.${prefix}-${suffix}${extension}`);
    suffix += 1;
  }
  return destination;
}

function baseQuarantinePath(sourcePath, quarantineDir, prefix) {
  const extension = path.extname(sourcePath);
  const base = path.basename(sourcePath, extension);
  return path.join(quarantineDir, `${base}.${prefix}${extension}`);
}

function mergeDirectoryIntoExisting(source, destination) {
  const conflicts = [];
  const pending = [[source, destination]];
  while (pending.length > 0) {
    const [sourceDir, destinationDir] = pending.pop();
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourceEntry = path.join(sourceDir, entry.name);
      const destinationEntry = path.join(destinationDir, entry.name);
      if (!fs.existsSync(destinationEntry)) continue;
      const destinationStat = fs.statSync(destinationEntry);
      if (entry.isDirectory() && destinationStat.isDirectory()) pending.push([sourceEntry, destinationEntry]);
      else conflicts.push(path.relative(source, sourceEntry));
    }
  }
  if (conflicts.length > 0) throw new Error(`partial quarantine has conflicting entries: ${conflicts.join(", ")}`);

  function moveContents(sourceDir, destinationDir) {
    fs.mkdirSync(destinationDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourceEntry = path.join(sourceDir, entry.name);
      const destinationEntry = path.join(destinationDir, entry.name);
      if (entry.isDirectory()) {
        moveContents(sourceEntry, destinationEntry);
        fs.rmdirSync(sourceEntry);
      } else {
        fs.renameSync(sourceEntry, destinationEntry);
      }
    }
  }

  moveContents(source, destination);
  fs.rmdirSync(source);
}

export function moveCleanupCandidates(candidates, { quarantineDir } = {}) {
  const moved = [];
  const failed = [];
  const skipped = [];
  const seenPaths = new Set();
  for (const candidate of candidates.filter((item) => item.eligible)) {
    const pathKey = path.resolve(candidate.path).toLowerCase();
    if (seenPaths.has(pathKey)) {
      skipped.push({ candidateType: candidate.candidate_type, path: candidate.path, reason: "duplicate_physical_path" });
      continue;
    }
    seenPaths.add(pathKey);
    const requestedRoot = quarantineDirectory(candidate.path, quarantineDir);
    const sourceRoot = path.parse(path.resolve(candidate.path)).root;
    const root = path.parse(path.resolve(requestedRoot)).root.toLowerCase() === sourceRoot.toLowerCase()
      ? requestedRoot
      : quarantineDirectory(candidate.path);
    fs.mkdirSync(root, { recursive: true });
    const prefix = candidate.variantId != null
      ? `variant-${candidate.variantId}`
      : candidate.sourceId != null
        ? `source-${candidate.sourceId}`
        : "uploaded";
    const baseDestination = baseQuarantinePath(candidate.path, root, prefix);
    const sourceIsDirectory = fs.existsSync(candidate.path) && fs.statSync(candidate.path).isDirectory();
    const resumesPartialDirectory = sourceIsDirectory
      && fs.existsSync(baseDestination)
      && fs.statSync(baseDestination).isDirectory();
    const destination = resumesPartialDirectory
      ? baseDestination
      : uniqueQuarantinePath(candidate.path, root, prefix);
    try {
      if (resumesPartialDirectory) mergeDirectoryIntoExisting(candidate.path, destination);
      else fs.renameSync(candidate.path, destination);
      moved.push({ candidateType: candidate.candidate_type, variantId: candidate.variantId ?? null, sourceId: candidate.sourceId ?? null, path: candidate.path, destination, isDirectory: candidate.isDirectory ?? false });
    } catch (error) {
      failed.push({
        candidateType: candidate.candidate_type,
        variantId: candidate.variantId ?? null,
        sourceId: candidate.sourceId ?? null,
        path: candidate.path,
        errorCode: error?.code ?? "rename_failed",
        error: error?.message ?? String(error)
      });
    }
  }
  return { moved, failed, skipped };
}

export function recordMovedVariantPath(db, moved, at = new Date().toISOString()) {
  for (const item of moved) {
    if (item.candidateType !== "playable_output" || item.variantId == null) continue;
    const previousPath = item.path;
    const nextPath = path.resolve(item.destination);
    db.prepare("UPDATE variants SET output_path=?, updated_at=? WHERE id=?")
      .run(nextPath.replaceAll("/", "\\"), at, item.variantId);
    db.prepare("INSERT INTO events (entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("variant", item.variantId, "output_quarantined", JSON.stringify({ previousPath, nextPath, reason: "Moved after publication and retained for human deletion" }), at);
    item.ledgerUpdated = true;
    item.ledgerPath = nextPath;
  }
}

export function recordMovedSourcePath(db, moved, at = new Date().toISOString()) {
  for (const item of moved) {
    if (item.candidateType !== "source_input" || item.sourceId == null) continue;
    const previousPath = item.path;
    const nextPath = path.resolve(item.destination);
    // A split source can have multiple ledger rows pointing to one physical
    // directory. Move the path for every alias so the ledger stays coherent.
    const aliases = db.prepare(`SELECT id FROM sources
      WHERE lower(replace(absolute_path, '/', '\\')) = lower(replace(?, '/', '\\'))`).all(previousPath);
    const sourceIds = aliases.length > 0 ? aliases.map((row) => row.id) : [item.sourceId];
    for (const sourceId of sourceIds) {
      db.prepare("UPDATE sources SET absolute_path=?, updated_at=? WHERE id=?")
        .run(nextPath.replaceAll("/", "\\"), at, sourceId);
      db.prepare("INSERT INTO events (entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("source", sourceId, "source_quarantined", JSON.stringify({
          previousPath,
          nextPath,
          reason: sourceId === item.sourceId
            ? "Moved after all linked variants closed"
            : "Moved with an aliased physical source path",
          reviewedUncoveredMediaReason: item.coverageOverrideReason ?? null
        }), at);
    }
    item.ledgerUpdated = true;
    item.ledgerPath = nextPath;
  }
}

export function recordCleanupMoveFailures(db, failed, at = new Date().toISOString()) {
  const insert = db.prepare("INSERT INTO events (entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)");
  for (const item of failed) {
    const entityType = item.sourceId != null ? "source" : item.variantId != null ? "variant" : null;
    const entityId = item.sourceId ?? item.variantId ?? null;
    if (!entityType || entityId == null) continue;
    insert.run(entityType, entityId, `${entityType}_quarantine_failed`, JSON.stringify({
      path: item.path,
      errorCode: item.errorCode,
      error: item.error
    }), at);
    item.ledgerRecorded = true;
  }
}

export function applySourceCoverageOverride(candidates, { sourceId, reason } = {}) {
  if (sourceId == null) return candidates;
  const candidate = candidates.find((item) => item.candidate_type === "source_input" && item.sourceId === sourceId);
  if (!candidate) throw new Error(`source ${sourceId} is not an active cleanup candidate`);
  if (candidate.reasons.length !== 1 || candidate.reasons[0] !== "source_media_not_fully_covered") {
    throw new Error(`source ${sourceId} cannot waive blockers: ${candidate.reasons.join(",") || "none"}`);
  }
  candidate.reasons = [];
  candidate.eligible = true;
  candidate.coverageOverrideReason = String(reason).trim();
  candidate.waivedReason = "source_media_not_fully_covered";
  return candidates;
}

export function selectCleanupCandidates(candidates, { candidateType = "all", variantId = null, sourceId = null, limit = null } = {}) {
  let filtered = candidateType === "all"
    ? candidates
    : candidates.filter((item) => item.candidate_type === candidateType);
  if (variantId != null) filtered = filtered.filter((item) => item.candidate_type === "playable_output" && item.variantId === variantId);
  if (sourceId != null) filtered = filtered.filter((item) => item.candidate_type === "source_input" && item.sourceId === sourceId);
  return limit == null ? filtered : filtered.slice(0, limit);
}

export function cleanupReportSections(candidates) {
  return {
    candidates: candidates.filter((row) => row.candidate_type === "playable_output"),
    sourceCandidates: candidates.filter((row) => row.candidate_type === "source_input"),
    manifestMatches: candidates.filter((row) => row.candidate_type === "uploaded_output")
  };
}

export function collectManifestMatches(manifestDir, outputRoot) {
  if (!fs.existsSync(manifestDir)) return [];
  const root = path.resolve(outputRoot);
  const matches = [];
  for (const entry of fs.readdirSync(manifestDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith("-release-manifest.json")) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, entry.name), "utf8"));
    } catch {
      continue;
    }
    for (const item of manifest.items ?? []) {
      if (!item?.originalFileName || path.basename(item.originalFileName) !== item.originalFileName) continue;
      const filePath = path.resolve(root, item.originalFileName);
      if (!isInsideRoot(filePath, root) || !fs.existsSync(filePath)) continue;
      matches.push({
        path: filePath,
        actualBytes: fs.statSync(filePath).size,
        manifest: entry.name,
        mediaAssetPageId: item.pageId ?? null,
        workPageId: item.expectedWorkPageId ?? null,
        sourcePageId: item.expectedSourcePageId ?? null,
        mediaBlockId: item.expectedMediaBlockId ?? null,
        expectedApproxSizeGb: item.expectedApproxSizeGb ?? null,
        eligible: true,
        reasons: []
      });
    }
  }
  return matches;
}

function isInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function isSampleArtifact(filePath) {
  return /(?:^|[._-])sample(?:[._-]|$)/iu.test(path.basename(filePath));
}

export function latestExpansionDecision(workflowNote) {
  const matches = [...String(workflowNote ?? "").matchAll(/\[规格扩展:(OPEN|CLOSED)\]/gu)];
  return matches.at(-1)?.[1] ?? null;
}

function hasOpticalDiscLayout(directory) {
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (/^(?:BDMV|VIDEO_TS)$/iu.test(entry.name)) return true;
      pending.push(path.join(current, entry.name));
    }
  }
  return false;
}

function countMediaFiles(directory, sourceKind = null) {
  // A disc backup contains many playlist streams and extras; count it as one
  // source content unit and leave detailed title selection to the coverage audit.
  if (sourceKind === "original_disc" || hasOpticalDiscLayout(directory)) return 1;
  let count = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (!isSampleArtifact(entryPath) && /\.(?:mkv|mp4|m2ts|ts|avi|mov|webm)$/iu.test(entry.name)) count += 1;
    }
  }
  return count;
}

function isEmptyDirectory(directory) {
  return fs.readdirSync(directory).length === 0;
}

export function collectCleanupCandidates(db, outputRoot) {
  const root = path.resolve(outputRoot);
  const rows = db.prepare(`
    SELECT variants.id AS variant_id, variants.output_path, variants.output_size_bytes,
           variants.publication_state, works.canonical_title, works.workflow_status
    FROM variants
    JOIN works ON works.id = variants.work_id
    WHERE variants.publication_state = 'sync_ready'
      AND variants.output_path IS NOT NULL
    ORDER BY variants.id
  `).all();
  return rows.map(row => {
    const filePath = path.resolve(row.output_path);
    const result = {
      variantId: row.variant_id,
      title: row.canonical_title,
      path: filePath,
      expectedBytes: row.output_size_bytes,
      actualBytes: null,
      eligible: false,
      reasons: []
    };
    if (!isInsideRoot(filePath, root)) {
      result.reasons.push("outside_output_root");
      return result;
    }
    if (isSampleArtifact(filePath)) result.reasons.push("sample_artifact");
    if (!fs.existsSync(filePath)) {
      result.reasons.push("file_missing");
      return result;
    }
    result.actualBytes = fs.statSync(filePath).size;
    if (row.output_size_bytes == null) result.reasons.push("ledger_size_missing");
    else if (result.actualBytes !== row.output_size_bytes) result.reasons.push("size_mismatch");
    result.eligible = result.reasons.length === 0;
    return result;
  });
}

export function collectSourceCleanupCandidates(db) {
  const rows = db.prepare(`
    SELECT sources.id AS source_id, sources.work_id, sources.absolute_path, sources.relative_path, sources.source_kind,
           input_roots.path AS input_root_path,
           works.canonical_title, works.workflow_status, works.workflow_note,
           COUNT(variants.id) AS linked_variant_count,
           SUM(CASE WHEN variants.publication_state='sync_ready' THEN 1 ELSE 0 END) AS sync_ready_count,
           SUM(CASE WHEN variants.publication_state IN ('sync_ready','cancelled') THEN 1 ELSE 0 END) AS closed_variant_count,
           SUM(CASE WHEN variants.production_state IN ('encoding','evaluated','selected')
             OR variants.publication_state NOT IN ('sync_ready','cancelled') THEN 1 ELSE 0 END) AS active_variant_count
    FROM sources
    JOIN input_roots ON input_roots.id=sources.input_root_id AND input_roots.enabled=1
    LEFT JOIN works ON works.id=sources.work_id
    LEFT JOIN variants ON variants.source_id=sources.id
    WHERE sources.missing=0
      AND sources.relative_path NOT LIKE '@flat/%'
    GROUP BY sources.id
    ORDER BY sources.id
  `).all();
  return rows.map((row) => {
    const filePath = path.resolve(row.absolute_path);
    if (row.input_root_path && !isInsideRoot(filePath, path.resolve(row.input_root_path))) return null;
    const result = {
      sourceId: row.source_id,
      title: row.canonical_title,
      path: filePath,
      sourceKind: row.source_kind,
      linkedVariantCount: row.linked_variant_count,
      syncReadyCount: row.sync_ready_count ?? 0,
      closedVariantCount: row.closed_variant_count ?? 0,
      actualBytes: null,
      isDirectory: null,
      mediaFileCount: null,
      eligible: false,
      reasons: []
    };
    const hasWorkColumn = Object.prototype.hasOwnProperty.call(row, "work_id");
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() && isEmptyDirectory(filePath)) {
      result.isDirectory = true;
      result.mediaFileCount = 0;
      result.eligible = true;
      result.reasons.push(row.work_id == null ? "empty_unbound_directory" : "empty_source_directory");
      return result;
    }
    if (row.linked_variant_count === 0) return null;
    if (hasWorkColumn && row.work_id == null) {
      return null;
    }
    if (row.active_variant_count > 0 || row.closed_variant_count !== row.linked_variant_count) result.reasons.push("linked_variants_not_closed");
    const expansionDecision = latestExpansionDecision(row.workflow_note);
    if (expansionDecision === "OPEN") result.reasons.push("source_expansion_open");
    else if (expansionDecision !== "CLOSED") result.reasons.push("source_expansion_unresolved");
    if (!fs.existsSync(filePath)) result.reasons.push("file_missing");
    else {
      const stats = fs.statSync(filePath);
      result.actualBytes = stats.isFile() ? stats.size : null;
      result.isDirectory = stats.isDirectory();
      if (result.isDirectory) {
        result.mediaFileCount = countMediaFiles(filePath, row.source_kind);
        if (result.mediaFileCount > row.linked_variant_count) result.reasons.push("source_media_not_fully_covered");
      }
    }
    result.eligible = result.reasons.length === 0;
    return result;
  }).filter(Boolean);
}

export function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const db = openLedger(options.db);
  try {
    const candidates = collectCleanupCandidates(db, options.outputRoot);
    const manifestMatches = collectManifestMatches(options.manifestDir, options.outputRoot);
    const uniqueManifestMatches = [...new Map(manifestMatches.map((row) => [row.path.toLowerCase(), row])).values()];
    const cleanupCandidates = [
      ...candidates.map((row) => ({ candidate_type: "playable_output", ...row })),
      ...uniqueManifestMatches.map((row) => ({ candidate_type: "uploaded_output", ...row })),
      ...collectSourceCleanupCandidates(db).map((row) => ({ candidate_type: "source_input", ...row }))
    ];
    if (options.allowReviewedUncoveredMedia) {
      applySourceCoverageOverride(cleanupCandidates, { sourceId: options.sourceId, reason: options.coverageReason });
    }
    const scopedCandidates = selectCleanupCandidates(cleanupCandidates, {
      candidateType: options.candidateType,
      variantId: options.variantId,
      sourceId: options.sourceId,
      limit: options.limit
    });
    const sections = cleanupReportSections(scopedCandidates);
    const report = {
      generatedAt: new Date().toISOString(),
      outputRoot: path.resolve(options.outputRoot),
      deletePerformed: false,
      movePerformed: false,
      candidates: sections.candidates,
      eligibleCount: sections.candidates.filter(item => item.eligible).length,
      sourceCandidates: sections.sourceCandidates,
      manifestMatches: sections.manifestMatches
    };
    report.sourceEligibleCount = report.sourceCandidates.filter(item => item.eligible).length;
    if (options.apply) {
      const selected = scopedCandidates.filter((item) => item.eligible);
      const result = moveCleanupCandidates(selected, { quarantineDir: options.quarantineDir });
      report.selectedForMove = selected;
      report.moved = result.moved;
      report.moveFailures = result.failed;
      report.moveSkipped = result.skipped;
      try {
        recordMovedVariantPath(db, report.moved);
        recordMovedSourcePath(db, report.moved);
      } catch (error) {
        report.ledgerUpdateFailure = { errorCode: error?.code ?? "ledger_update_failed", error: error?.message ?? String(error) };
      }
      try {
        recordCleanupMoveFailures(db, report.moveFailures);
      } catch (error) {
        report.failureRecordError = { errorCode: error?.code ?? "failure_record_failed", error: error?.message ?? String(error) };
      }
      report.movePerformed = true;
    }
    console.log(options.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    return report;
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
