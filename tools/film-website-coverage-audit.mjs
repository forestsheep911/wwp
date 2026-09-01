#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PREVIEW_LIMIT = 3;

function parseArgs(args) {
  const options = { index: path.resolve(".local-data/home-site/search-index.json"), previewLimit: DEFAULT_PREVIEW_LIMIT };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--index") options.index = path.resolve(args[++index]);
    else if (arg === "--preview-limit") options.previewLimit = Number(args[++index]);
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pageId?.trim()) throw new Error("--page-id is required.");
  if (!Number.isInteger(options.previewLimit) || options.previewLimit < 1) throw new Error("--preview-limit must be a positive integer.");
  return options;
}

export function auditWebsiteCoverage(indexDocument, pageId, previewLimit = DEFAULT_PREVIEW_LIMIT) {
  const normalizedPageId = pageId.trim();
  const entries = indexDocument?.entries ?? {};
  const entry = entries[`notion-page-${normalizedPageId}`] ?? entries[`notion-page-${normalizedPageId.replaceAll("-", "")}`];
  if (!entry) return { status: "missing", pageId: normalizedPageId, fullVariantCount: 0, previewVariantCount: 0, variants: [] };

  const variants = Array.isArray(entry.result?.variants) ? entry.result.variants : [];
  return {
    status: "ok",
    pageId: normalizedPageId,
    title: entry.result?.title ?? entry.title,
    fullVariantCount: variants.length,
    previewVariantCount: Math.min(variants.length, previewLimit),
    previewLimit,
    previewOnly: variants.length > previewLimit,
    variants: variants.map((variant) => ({
      assetKey: variant.assetKey,
      label: variant.label,
      sourcePageId: variant.sourcePageId,
      mediaAssetPageId: variant.metadata?.mediaAssetPageId,
      mediaBlockId: variant.metadata?.mediaBlockId
    }))
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = auditWebsiteCoverage(JSON.parse(fs.readFileSync(options.index, "utf8")), options.pageId, options.previewLimit);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`${report.title ?? report.pageId}: ${report.fullVariantCount} full variants; list preview ${report.previewVariantCount}/${report.previewLimit}.`);
  if (report.previewOnly) console.log("Diagnosis: list preview is capped; inspect the full detail/index result before treating this as sync loss.");
  for (const variant of report.variants) console.log(`- ${variant.label ?? "(unnamed)"} | ${variant.assetKey}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
