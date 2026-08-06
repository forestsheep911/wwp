#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openLedger } from "./lib/film-ledger-schema.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");
const DEFAULT_OUTPUT_ROOT = "E:\\video_made";
const DEFAULT_MANIFEST_DIR = path.resolve(".local-data");

function parseArgs(args) {
  const options = { db: DEFAULT_DB, outputRoot: DEFAULT_OUTPUT_ROOT, manifestDir: DEFAULT_MANIFEST_DIR, json: false, apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--db") options.db = path.resolve(args[++index]);
    else if (arg === "--output-root") options.outputRoot = path.resolve(args[++index]);
    else if (arg === "--manifest-dir") options.manifestDir = path.resolve(args[++index]);
    else if (arg === "--quarantine-dir") options.quarantineDir = path.resolve(args[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/film-cleanup-candidates.mjs [--output-root E:\\video_made] [--manifest-dir .local-data] [--quarantine-dir <dir>] [--apply] [--json]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
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

export function moveCleanupCandidates(candidates, { quarantineDir } = {}) {
  const moved = [];
  for (const candidate of candidates.filter((item) => item.eligible)) {
    const root = quarantineDirectory(candidate.path, quarantineDir);
    fs.mkdirSync(root, { recursive: true });
    const prefix = candidate.variantId != null ? `variant-${candidate.variantId}` : `source-${candidate.sourceId}`;
    const destination = uniqueQuarantinePath(candidate.path, root, prefix);
    fs.renameSync(candidate.path, destination);
    moved.push({ candidateType: candidate.candidate_type, path: candidate.path, destination, isDirectory: candidate.isDirectory ?? false });
  }
  return moved;
}

function collectManifestMatches(manifestDir, outputRoot) {
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
        eligible: false,
        reason: "release_manifest_match_requires_current_release_check"
      });
    }
  }
  return matches;
}

function isInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function countMediaFiles(directory) {
  let count = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (/\.(?:mkv|mp4|m2ts|ts|avi|mov|webm)$/iu.test(entry.name)) count += 1;
    }
  }
  return count;
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
    if (/^(?:待人工|暂缓)/u.test(String(row.workflow_status ?? "").trim())) {
      result.reasons.push("human_workflow_gate");
      return result;
    }
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
    SELECT sources.id AS source_id, sources.absolute_path, sources.relative_path, sources.source_kind,
           works.canonical_title, works.workflow_status,
           COUNT(variants.id) AS linked_variant_count,
           SUM(CASE WHEN variants.publication_state='sync_ready' THEN 1 ELSE 0 END) AS sync_ready_count,
           SUM(CASE WHEN variants.publication_state IN ('sync_ready','cancelled') THEN 1 ELSE 0 END) AS closed_variant_count,
           SUM(CASE WHEN variants.production_state IN ('encoding','evaluated','selected')
             OR variants.publication_state NOT IN ('sync_ready','cancelled') THEN 1 ELSE 0 END) AS active_variant_count
    FROM sources
    JOIN input_roots ON input_roots.id=sources.input_root_id AND input_roots.enabled=1
    JOIN works ON works.id=sources.work_id
    LEFT JOIN variants ON variants.source_id=sources.id
    WHERE sources.missing=0 AND sources.work_id IS NOT NULL
      AND sources.relative_path NOT LIKE '@flat/%'
    GROUP BY sources.id
    HAVING COUNT(variants.id) > 0
    ORDER BY sources.id
  `).all();
  return rows.map((row) => {
    const filePath = path.resolve(row.absolute_path);
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
    if (/^(?:待人工|暂缓)/u.test(String(row.workflow_status ?? "").trim())) result.reasons.push("human_workflow_gate");
    if (row.active_variant_count > 0 || row.closed_variant_count !== row.linked_variant_count) result.reasons.push("linked_variants_not_closed");
    if (!fs.existsSync(filePath)) result.reasons.push("file_missing");
    else {
      const stats = fs.statSync(filePath);
      result.actualBytes = stats.isFile() ? stats.size : null;
      result.isDirectory = stats.isDirectory();
      if (result.isDirectory) {
        result.mediaFileCount = countMediaFiles(filePath);
        if (result.mediaFileCount > row.linked_variant_count) result.reasons.push("source_media_not_fully_covered");
      }
    }
    result.eligible = result.reasons.length === 0;
    return result;
  });
}

export function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const db = openLedger(options.db);
  try {
    const candidates = collectCleanupCandidates(db, options.outputRoot);
    const cleanupCandidates = [
      ...candidates.map((row) => ({ candidate_type: "playable_output", ...row })),
      ...collectSourceCleanupCandidates(db).map((row) => ({ candidate_type: "source_input", ...row }))
    ];
    const report = {
      generatedAt: new Date().toISOString(),
      outputRoot: path.resolve(options.outputRoot),
      deletePerformed: false,
      movePerformed: false,
      candidates,
      eligibleCount: candidates.filter(item => item.eligible).length,
      sourceCandidates: cleanupCandidates.filter((row) => row.candidate_type === "source_input"),
      manifestMatches: collectManifestMatches(options.manifestDir, options.outputRoot)
    };
    report.sourceEligibleCount = report.sourceCandidates.filter(item => item.eligible).length;
    if (options.apply) {
      report.moved = moveCleanupCandidates(cleanupCandidates, { quarantineDir: options.quarantineDir });
      report.movePerformed = true;
    }
    console.log(options.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    return report;
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
