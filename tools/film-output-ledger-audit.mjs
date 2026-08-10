#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { openLedger } from "./lib/film-ledger-schema.mjs";

const DEFAULT_ROOT = "E:\\video_made";
const DEFAULT_DB = ".local-data/wwp-film-workflow.sqlite";
const MEDIA_EXTENSION = /\.(?:mp4|m4v|mov|mkv)$/iu;

function usage() {
  console.log(`Usage:
  node tools/film-output-ledger-audit.mjs [--root E:\\video_made] [--db .local-data/wwp-film-workflow.sqlite] [--report .local-data/video-made-ledger-audit.json] [--json]

Read-only audit for local media files versus the workflow ledger. It does not
register, upload, move, or delete any file. Filename matches are leads only;
never use them as automatic variant adoption evidence.
`);
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, db: DEFAULT_DB, report: ".local-data/video-made-ledger-audit.json", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--root", "--db", "--report"].includes(arg)) options[arg.slice(2)] = argv[++index];
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function normalizePath(value) {
  return path.resolve(value).replaceAll("/", "\\").toLowerCase();
}

function listMediaFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listMediaFiles(fullPath));
    else if (entry.isFile() && MEDIA_EXTENSION.test(entry.name)) result.push(fullPath);
  }
  return result;
}

export function classifyLocalMedia(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  if (normalized.startsWith("_qc/") || /(?:\.sample|diagnostic(?:[-_.]\d+(?:s|sec)?)?|smoke(?:[-_.]\d+(?:s|sec)?)?)\.(?:mp4|m4v|mov|mkv)$/u.test(normalized)) return "qc_artifact";
  if (/\.work\.mkv$/u.test(normalized)) return "work_intermediate";
  return "playable_candidate";
}

export function pendingDeletionPath(outputRoot, variant) {
  const extension = path.extname(variant.output_path);
  const basename = path.basename(variant.output_path, extension);
  return path.join(path.dirname(outputRoot), "待人工删除", `${basename}.variant-${variant.id}${extension}`);
}

export function flatSourceSlug(relativePath) {
  const match = String(relativePath ?? "").replaceAll("\\", "/").match(/^@flat\/(.+)$/iu);
  if (!match) return null;
  return match[1].replace(/^\[[^\]]+\]\.?/u, "").toLowerCase();
}

export function relatedFlatSources(filePath, flatSources) {
  const filename = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return flatSources.filter((source) => filename.startsWith(source.slug) || source.slug.startsWith(filename));
}

export function isDeferredRetainedCandidate(item) {
  return item.exactVariantId === null
    && item.classification === "playable_candidate"
    && item.flatSourceCandidates.some((source) => source.qualityState === "deferred");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();
  const root = path.resolve(options.root);
  if (!fs.existsSync(root)) throw new Error(`Output root does not exist: ${root}`);
  const db = openLedger(path.resolve(options.db));
  try {
    const variants = db.prepare(`SELECT variants.id, variants.output_path, variants.production_state, variants.publication_state,
      works.canonical_title FROM variants JOIN works ON works.id=variants.work_id WHERE variants.output_path IS NOT NULL`).all();
    const flatSources = db.prepare(`SELECT sources.id, sources.relative_path, sources.quality_state, sources.color_risk,
      works.id AS work_id, works.canonical_title, works.workflow_status
      FROM sources JOIN works ON works.id=sources.work_id
      WHERE sources.relative_path LIKE '@flat/%'`).all().map((source) => ({ ...source, slug: flatSourceSlug(source.relative_path) })).filter((source) => source.slug);
    const movedToPendingDeletion = variants.filter((variant) =>
      variant.publication_state === "sync_ready"
      && !fs.existsSync(variant.output_path)
      && fs.existsSync(pendingDeletionPath(root, variant))
    );
    const registeredOutputsMissing = variants.filter((variant) =>
      !fs.existsSync(variant.output_path)
      && !movedToPendingDeletion.some((moved) => moved.id === variant.id)
    );
    const byPath = new Map(variants.map((variant) => [normalizePath(variant.output_path), variant]));
    const byFilename = new Map();
    for (const variant of variants) {
      const key = path.basename(variant.output_path).toLowerCase();
      const rows = byFilename.get(key) ?? [];
      rows.push(variant);
      byFilename.set(key, rows);
    }
    const localFiles = listMediaFiles(root).sort((left, right) => left.localeCompare(right)).map((filePath) => {
      const stats = fs.statSync(filePath);
      const exact = byPath.get(normalizePath(filePath));
      const filenameMatches = byFilename.get(path.basename(filePath).toLowerCase()) ?? [];
      const sourceMatches = relatedFlatSources(filePath, flatSources);
      return {
        path: filePath,
        relativePath: path.relative(root, filePath),
        sizeBytes: stats.size,
        classification: classifyLocalMedia(path.relative(root, filePath)),
        exactVariantId: exact?.id ?? null,
        filenameVariantIds: filenameMatches.map((variant) => variant.id),
        filenameMatchOnly: !exact && filenameMatches.length > 0,
        flatSourceCandidates: sourceMatches.map((source) => ({
          sourceId: source.id,
          workId: source.work_id,
          title: source.canonical_title,
          workflowStatus: source.workflow_status,
          qualityState: source.quality_state,
          colorRisk: source.color_risk
        }))
      };
    });
    const report = {
      generatedAt: new Date().toISOString(),
      root,
      summary: {
        localFiles: localFiles.length,
        exactRegisteredPresent: localFiles.filter((item) => item.exactVariantId !== null).length,
        filenameMatchOnly: localFiles.filter((item) => item.filenameMatchOnly).length,
        unregisteredPlayableCandidates: localFiles.filter((item) => item.exactVariantId === null && item.classification === "playable_candidate").length,
        deferredRetainedCandidates: localFiles.filter(isDeferredRetainedCandidate).length,
        unresolvedPlayableCandidates: localFiles.filter((item) => item.exactVariantId === null && item.classification === "playable_candidate" && !isDeferredRetainedCandidate(item)).length,
        qcArtifacts: localFiles.filter((item) => item.classification === "qc_artifact").length,
        workIntermediates: localFiles.filter((item) => item.classification === "work_intermediate").length,
        registeredOutputsMovedToPendingDeletion: movedToPendingDeletion.length,
        registeredOutputsMissing: registeredOutputsMissing.length
      },
      localFiles,
      registeredOutputsMovedToPendingDeletion: movedToPendingDeletion.map((variant) => ({
        variantId: variant.id,
        title: variant.canonical_title,
        path: pendingDeletionPath(root, variant),
        productionState: variant.production_state,
        publicationState: variant.publication_state
      })),
      registeredOutputsMissing: registeredOutputsMissing.map((variant) => ({
        variantId: variant.id,
        title: variant.canonical_title,
        path: variant.output_path,
        productionState: variant.production_state,
        publicationState: variant.publication_state
      }))
    };
    fs.mkdirSync(path.dirname(path.resolve(options.report)), { recursive: true });
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ report: path.resolve(options.report), summary: report.summary }, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
