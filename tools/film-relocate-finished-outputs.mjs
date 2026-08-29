#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openLedger, withTransaction } from "./lib/film-ledger-schema.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");
const DEFAULT_DESTINATION = "E:\\video_made";

export function parseArgs(args) {
  const options = { db: DEFAULT_DB, fromRoot: null, toRoot: DEFAULT_DESTINATION, apply: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from-root") options.fromRoot = args[++index];
    else if (arg === "--to-root") options.toRoot = args[++index];
    else if (arg === "--db") options.db = path.resolve(args[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.fromRoot) throw new Error("--from-root is required");
  if (path.resolve(options.fromRoot) === path.resolve(options.toRoot)) {
    throw new Error("--from-root and --to-root must be different directories; use E:\\待人工删除 when quarantining finished outputs");
  }
  return options;
}

function isInside(filePath, root) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSample(filePath) {
  return /(?:^|[._-])sample(?:[._-]|$)/iu.test(path.basename(filePath));
}

export function pendingDeletionPath(outputRoot, variant) {
  const extension = path.extname(variant.output_path);
  const basename = path.basename(variant.output_path, extension);
  const variantId = variant.id ?? variant.variant_id;
  return path.join(path.dirname(path.resolve(outputRoot)), "待人工删除", `${basename}.variant-${variantId}${extension}`);
}

function destinationPath(toRoot, sourcePath, variantId) {
  const extension = path.extname(sourcePath);
  const base = path.basename(sourcePath, extension);
  const normal = path.join(path.resolve(toRoot), `${base}${extension}`);
  if (!fs.existsSync(normal)) return normal;
  if (fs.statSync(normal).size === fs.statSync(sourcePath).size) return normal;
  return path.join(path.resolve(toRoot), `${base}.variant-${variantId}${extension}`);
}

export function collectRelocationCandidates(db, fromRoot, toRoot) {
  const sourceRoot = path.resolve(fromRoot);
  const rows = db.prepare(`
    SELECT variants.id AS variant_id, variants.output_path, variants.output_size_bytes,
           variants.publication_state, works.canonical_title
    FROM variants JOIN works ON works.id = variants.work_id
    WHERE variants.publication_state='sync_ready' AND variants.output_path IS NOT NULL
    ORDER BY variants.id
  `).all();
  return rows.flatMap(row => {
    const filePath = path.resolve(row.output_path);
    if (!isInside(filePath, sourceRoot)) return [];
    const pendingPath = pendingDeletionPath(toRoot, row);
    if (!fs.existsSync(filePath)) {
      if (!fs.existsSync(pendingPath) || !fs.statSync(pendingPath).isFile()) return [];
      const actualBytes = fs.statSync(pendingPath).size;
      return [{
        variantId: row.variant_id,
        title: row.canonical_title,
        source: filePath,
        destination: pendingPath,
        actualBytes,
        expectedBytes: row.output_size_bytes,
        eligible: row.output_size_bytes != null
          && actualBytes === row.output_size_bytes
          && path.extname(pendingPath).toLowerCase() === ".mp4",
        alreadyAtDestination: true,
        reasons: row.output_size_bytes == null
          ? ["ledger_size_missing"]
          : actualBytes === row.output_size_bytes ? [] : ["size_mismatch"]
      }];
    }
    if (!fs.statSync(filePath).isFile()) return [];
    return [{ row, filePath, pendingPath }];
  }).map(item => {
    if (item.alreadyAtDestination) return item;
    const { row, filePath } = item;
    const source = path.resolve(row.output_path);
    const result = {
      variantId: row.variant_id,
      title: row.canonical_title,
      source,
      destination: destinationPath(toRoot, source, row.variant_id),
      actualBytes: fs.statSync(source).size,
      expectedBytes: row.output_size_bytes,
      eligible: false,
      alreadyAtDestination: false,
      reasons: []
    };
    if (isSample(source)) result.reasons.push("sample_artifact");
    if (row.output_size_bytes == null) result.reasons.push("ledger_size_missing");
    else if (result.actualBytes !== row.output_size_bytes) result.reasons.push("size_mismatch");
    if (path.extname(source).toLowerCase() !== ".mp4") result.reasons.push("non_mp4_output");
    result.eligible = result.reasons.length === 0;
    return result;
  });
}

export function relocateFinishedOutputs(db, candidates, { apply = false } = {}) {
  const result = { planned: candidates.filter(item => item.eligible), moved: [], reconciled: [], failed: [] };
  if (!apply) return result;
  for (const candidate of result.planned) {
    try {
      if (candidate.alreadyAtDestination) {
        const at = new Date().toISOString();
        withTransaction(db, () => {
          db.prepare("UPDATE variants SET output_path=?, updated_at=? WHERE id=?")
            .run(candidate.destination.replaceAll("/", "\\"), at, candidate.variantId);
          db.prepare("INSERT INTO events (entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
            .run("variant", candidate.variantId, "output_reconciled", JSON.stringify({ previousPath: candidate.source, nextPath: candidate.destination }), at);
        });
        result.reconciled.push(candidate);
        continue;
      }
      fs.mkdirSync(path.dirname(candidate.destination), { recursive: true });
      fs.copyFileSync(candidate.source, candidate.destination, fs.constants.COPYFILE_EXCL);
      const copiedBytes = fs.statSync(candidate.destination).size;
      if (copiedBytes !== candidate.actualBytes) throw new Error(`copy size mismatch: ${copiedBytes} != ${candidate.actualBytes}`);
      const at = new Date().toISOString();
      withTransaction(db, () => {
        db.prepare("UPDATE variants SET output_path=?, updated_at=? WHERE id=?")
          .run(candidate.destination.replaceAll("/", "\\"), at, candidate.variantId);
        db.prepare("INSERT INTO events (entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
          .run("variant", candidate.variantId, "output_relocated", JSON.stringify({ previousPath: candidate.source, nextPath: candidate.destination }), at);
      });
      fs.unlinkSync(candidate.source);
      result.moved.push(candidate);
    } catch (error) {
      result.failed.push({ ...candidate, error: error?.message ?? String(error) });
    }
  }
  return result;
}

export function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const db = openLedger(options.db);
  try {
    const candidates = collectRelocationCandidates(db, options.fromRoot, options.toRoot);
    const relocation = relocateFinishedOutputs(db, candidates, options);
    const report = {
      generatedAt: new Date().toISOString(),
      fromRoot: path.resolve(options.fromRoot),
      toRoot: path.resolve(options.toRoot),
      apply: options.apply,
      candidates,
      planned: relocation.planned.length,
      moved: relocation.moved,
      failed: relocation.failed
    };
    console.log(options.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    return report;
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
