#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openLedger } from "./lib/film-ledger-schema.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");
const DEFAULT_OUTPUT_ROOT = "E:\\video_made";

function parseArgs(args) {
  const options = { db: DEFAULT_DB, outputRoot: DEFAULT_OUTPUT_ROOT, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--db") options.db = path.resolve(args[++index]);
    else if (arg === "--output-root") options.outputRoot = path.resolve(args[++index]);
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/film-cleanup-candidates.mjs [--output-root E:\\video_made] [--json]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function isInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function collectCleanupCandidates(db, outputRoot) {
  const root = path.resolve(outputRoot);
  const rows = db.prepare(`
    SELECT variants.id AS variant_id, variants.output_path, variants.output_size_bytes,
           variants.publication_state, works.canonical_title
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

export function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const db = openLedger(options.db);
  try {
    const candidates = collectCleanupCandidates(db, options.outputRoot);
    const report = {
      generatedAt: new Date().toISOString(),
      outputRoot: path.resolve(options.outputRoot),
      deletePerformed: false,
      candidates,
      eligibleCount: candidates.filter(item => item.eligible).length
    };
    console.log(options.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    return report;
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
