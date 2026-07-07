import fs from "node:fs";
import path from "node:path";

function parseArgs() {
  const options = {
    manifestPath: "",
    previewPath: "",
    outputPath: ".local-data/notion-media-assets-batch-low-risk.json",
    minWouldCreate: 1,
    maxIssues: 1,
    maxSelected: 3,
    excludeSeries: true,
    requireStrongSingleAssetTitle: true,
    excludeTitlePatterns: []
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--manifest") options.manifestPath = value();
    else if (name === "--preview") options.previewPath = value();
    else if (name === "--output") options.outputPath = value();
    else if (name === "--min-would-create") options.minWouldCreate = Number(value());
    else if (name === "--max-issues") options.maxIssues = Number(value());
    else if (name === "--max-selected") options.maxSelected = Number(value());
    else if (name === "--exclude-title-pattern") options.excludeTitlePatterns.push(value());
    else if (arg === "--include-series") options.excludeSeries = false;
    else if (arg === "--allow-weak-single-asset-title") options.requireStrongSingleAssetTitle = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.manifestPath) throw new Error("Set --manifest.");
  if (!options.previewPath) throw new Error("Set --preview.");
  if (!Number.isFinite(options.minWouldCreate) || options.minWouldCreate < 0) {
    throw new Error("--min-would-create must be a non-negative number.");
  }
  if (!Number.isFinite(options.maxIssues) || options.maxIssues < 0) {
    throw new Error("--max-issues must be a non-negative number.");
  }
  if (!Number.isFinite(options.maxSelected) || options.maxSelected < 1) {
    throw new Error("--max-selected must be a positive number.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-filter-batch.mjs --manifest .local-data/batch.json --preview .local-data/batch-preview.json --output .local-data/batch-low-risk.json

This is local-only. It filters a generated Media Assets batch manifest using a
writer dry-run report, keeping low-risk pages for apply mode.

Defaults:
  --min-would-create 1
  --max-issues 1
  --max-selected 3
  exclude series-looking titles
  require year/script disambiguation for single-asset pages

Options:
  --include-series
  --allow-weak-single-asset-title
  --exclude-title-pattern "regex"
`);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cleanText(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function titleFor(page, item) {
  return cleanText(page?.title || item?.label || "");
}

function looksLikeSeries(title) {
  return /(?:第\s*[一二三四五六七八九十\d]+\s*季|Season\s*\d+|\bS\d{1,2}\b|\bs\d{1,2}\b|最终季|最終季|Part\.\d+|\bE(?:P|pisode)?\s*\d{1,3}\b|第\s*[一二三四五六七八九十\d]+\s*[集话話])/iu.test(title);
}

function hasStrongSingleAssetTitle(title) {
  const cleaned = cleanText(title);
  if (/(?:19|20)\d{2}/u.test(cleaned)) return true;

  const scripts = [
    /\p{Script=Han}/u,
    /\p{Script=Latin}/u,
    /\p{Script=Hiragana}|\p{Script=Katakana}/u,
    /\p{Script=Hangul}/u
  ].filter((pattern) => pattern.test(cleaned));

  return scripts.length >= 2;
}

function compilePatterns(patterns) {
  return patterns.map((pattern) => new RegExp(pattern, "iu"));
}

function previewPagesById(preview) {
  const pages = new Map();
  for (const page of preview.pages ?? []) {
    if (page.pageId) pages.set(page.pageId, page);
  }
  return pages;
}

function rejectReasons(item, page, options, titlePatterns) {
  const summary = page?.summary ?? {};
  const title = titleFor(page, item);
  const reasons = [];

  if (!page) reasons.push("missing_preview");
  if ((summary.wouldCreate ?? 0) < options.minWouldCreate) reasons.push("below_min_would_create");
  if ((summary.issues ?? 0) > options.maxIssues) reasons.push("too_many_issues");
  if ((summary.selected ?? 0) > options.maxSelected) reasons.push("too_many_selected_assets");
  if ((summary.skippedTitleMismatch ?? 0) > 0) reasons.push("title_mismatch");
  if (options.excludeSeries && looksLikeSeries(title)) reasons.push("series_like_title");
  if (
    options.requireStrongSingleAssetTitle &&
    (summary.selected ?? 0) === 1 &&
    !hasStrongSingleAssetTitle(title)
  ) {
    reasons.push("single_asset_weak_title");
  }
  if (titlePatterns.some((pattern) => pattern.test(title))) reasons.push("excluded_title_pattern");

  return reasons;
}

function main() {
  const options = parseArgs();
  const manifest = loadJson(options.manifestPath);
  const preview = loadJson(options.previewPath);
  const titlePatterns = compilePatterns(options.excludeTitlePatterns);
  const pagesById = previewPagesById(preview);

  const items = [];
  const filteredOut = [];

  for (const item of manifest.items ?? []) {
    const page = pagesById.get(item.pageId);
    const reasons = rejectReasons(item, page, options, titlePatterns);
    if (reasons.length > 0) {
      filteredOut.push({
        pageId: item.pageId,
        label: item.label,
        title: titleFor(page, item),
        reasons,
        summary: page?.summary
      });
      continue;
    }
    items.push(item);
  }

  const output = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    note: "Filtered from a generated Media Assets batch manifest and writer dry-run report. Dry-run again before apply.",
    source: {
      ...(manifest.source ?? {}),
      filter: {
        manifestPath: options.manifestPath,
        previewPath: options.previewPath,
        minWouldCreate: options.minWouldCreate,
        maxIssues: options.maxIssues,
        maxSelected: options.maxSelected,
        excludeSeries: options.excludeSeries,
        requireStrongSingleAssetTitle: options.requireStrongSingleAssetTitle,
        excludeTitlePatterns: options.excludeTitlePatterns
      }
    },
    items,
    skipped: [
      ...(manifest.skipped ?? []),
      ...filteredOut.map(({ pageId, title, reasons }) => ({ pageId, title, reasons }))
    ],
    filteredOut
  };

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputPath: options.outputPath,
    summary: {
      inputItems: manifest.items?.length ?? 0,
      selected: items.length,
      filteredOut: filteredOut.length
    },
    firstItems: items.slice(0, 10),
    firstFilteredOut: filteredOut.slice(0, 10)
  }, null, 2));
}

main();
