import fs from "node:fs";
import path from "node:path";

const PLACEHOLDER_ISSUE_KINDS = new Set([
  "playable_spec_without_media",
  "source_group_without_media"
]);

function parseArgs() {
  const options = {
    manifestPath: "",
    previewDir: ".local-data",
    outputPath: ".local-data/notion-media-assets-leftovers-report.json",
    markdownPath: "",
    sampleLimit: 12
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--manifest") options.manifestPath = value();
    else if (name === "--preview-dir") options.previewDir = value();
    else if (name === "--output") options.outputPath = value();
    else if (name === "--markdown") options.markdownPath = value();
    else if (name === "--sample-limit") options.sampleLimit = Number(value());
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !options.manifestPath) {
      options.manifestPath = arg;
    } else if (!arg.startsWith("-") && options.outputPath === ".local-data/notion-media-assets-leftovers-report.json") {
      options.outputPath = arg;
    } else if (!arg.startsWith("-") && !options.markdownPath) {
      options.markdownPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.manifestPath) throw new Error("Set --manifest.");
  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1) {
    throw new Error("--sample-limit must be a positive number.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-leftovers-report.mjs --manifest .local-data/notion-media-assets-batch-round22.json --markdown .local-data/notion-media-assets-leftovers.md
  npm run notion:asset-leftovers -- .local-data/notion-media-assets-batch-round22.json .local-data/notion-media-assets-leftovers.json .local-data/notion-media-assets-leftovers.md

This is local-only. It summarizes a generated Media Assets batch manifest after
the broad migration path has run out of safe candidates. It reads historical
writer preview reports from --preview-dir to classify remaining skipped pages.
`);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cleanTitle(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function countBy(items, select) {
  const counts = new Map();
  for (const item of items) {
    for (const key of select(item)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function hasAnyReason(item, predicate) {
  return (item.reasons ?? []).some(predicate);
}

function isCovered(item) {
  return hasAnyReason(item, (reason) => (
    reason === "already_has_media_assets" ||
    reason === "already_has_media_assets_same_title"
  ));
}

function isSeries(item) {
  return hasAnyReason(item, (reason) => reason === "series_season" || reason.startsWith("non_movie_kind:TV"));
}

function isOperatorPrefixed(item) {
  return (item.reasons ?? []).includes("operator_prefix");
}

function loadPreviewReports(previewDir) {
  if (!fs.existsSync(previewDir)) return new Map();

  const reports = new Map();
  const files = fs.readdirSync(previewDir)
    .filter((name) => /^notion-media-assets-batch-.*-preview\.json$/u.test(name))
    .sort();

  for (const name of files) {
    const filePath = path.join(previewDir, name);
    let preview;
    try {
      preview = loadJson(filePath);
    } catch {
      continue;
    }

    for (const report of preview.reports ?? []) {
      if (!report.pageId) continue;
      const generatedAt = Date.parse(preview.generatedAt ?? "") || 0;
      const previous = reports.get(report.pageId);
      if (!previous || generatedAt >= previous.generatedAt) {
        reports.set(report.pageId, {
          file: name,
          generatedAt,
          report
        });
      }
    }
  }
  return reports;
}

function issueKinds(report) {
  return [...new Set((report?.issues ?? []).map((issue) => issue.kind).filter(Boolean))].sort();
}

function onlyPlaceholderIssues(report) {
  const kinds = issueKinds(report);
  return kinds.length > 0 && kinds.every((kind) => PLACEHOLDER_ISSUE_KINDS.has(kind));
}

function pageSummary(page, previewEntry) {
  const report = previewEntry?.report;
  return {
    pageId: page.pageId,
    title: cleanTitle(page.title),
    reasons: page.reasons ?? [],
    previewFile: previewEntry?.file,
    previewSummary: report?.summary,
    issueKinds: issueKinds(report)
  };
}

function sample(items, limit) {
  return items.slice(0, limit).map((item) => ({
    pageId: item.pageId,
    title: cleanTitle(item.title),
    reasons: item.reasons ?? []
  }));
}

function classify(skipped, previewReports, sampleLimit) {
  const uncovered = skipped.filter((item) => !isCovered(item));
  const withPreview = (item) => previewReports.get(item.pageId)?.report;
  const remaining = new Set(uncovered.map((item) => item.pageId));
  const take = (predicate) => {
    const items = uncovered.filter((item) => remaining.has(item.pageId) && predicate(item));
    for (const item of items) remaining.delete(item.pageId);
    return items;
  };

  const operatorPrefixPages = take(isOperatorPrefixed);
  const seriesPages = take(isSeries);
  const manualExcludedTitlePatternPages = take((item) => {
    return (item.reasons ?? []).includes("previous_filter_excluded_title_pattern");
  });

  const salvageablePlaceholderPages = take((item) => {
    const report = withPreview(item);
    return report &&
      (report.summary?.selected ?? 0) > 0 &&
      (report.summary?.skippedTitleMismatch ?? 0) === 0 &&
      onlyPlaceholderIssues(report);
  });

  const noMediaPlaceholderPages = take((item) => {
    const report = withPreview(item);
    return report &&
      (report.summary?.candidatesFound ?? 0) === 0 &&
      onlyPlaceholderIssues(report);
  });

  const weakTitlePages = take((item) => {
    return hasAnyReason(item, (reason) => reason === "previous_filter_single_asset_weak_title" || reason === "weak_expected_title");
  });

  const noWritePages = take((item) => {
    return (item.reasons ?? []).includes("previous_preview_no_writes");
  });

  const highIssuePages = take((item) => {
    return (item.reasons ?? []).includes("previous_preview_high_issues");
  });

  const otherPages = take(() => true);

  return {
    uncoveredTotal: uncovered.length,
    coveredTotal: skipped.length - uncovered.length,
    reasonCountsAll: countBy(skipped, (item) => item.reasons ?? []),
    reasonCountsUncovered: countBy(uncovered, (item) => item.reasons ?? []),
    buckets: {
      salvageablePlaceholderPages: summarizeBucket(salvageablePlaceholderPages, previewReports, sampleLimit),
      noMediaPlaceholderPages: summarizeBucket(noMediaPlaceholderPages, previewReports, sampleLimit),
      weakTitlePages: summarizeBucket(weakTitlePages, previewReports, sampleLimit),
      manualExcludedTitlePatternPages: summarizeBucket(manualExcludedTitlePatternPages, previewReports, sampleLimit),
      noWritePages: summarizeBucket(noWritePages, previewReports, sampleLimit),
      highIssuePages: summarizeBucket(highIssuePages, previewReports, sampleLimit),
      operatorPrefixPages: summarizeBucket(operatorPrefixPages, previewReports, sampleLimit),
      seriesPages: summarizeBucket(seriesPages, previewReports, sampleLimit),
      otherPages: summarizeBucket(otherPages, previewReports, sampleLimit)
    }
  };
}

function summarizeBucket(items, previewReports, sampleLimit) {
  return {
    count: items.length,
    samples: items.slice(0, sampleLimit).map((item) => pageSummary(item, previewReports.get(item.pageId)))
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Notion Media Assets Leftovers",
    "",
    `Generated: ${report.generatedAt}`,
    `Manifest: ${report.manifestPath}`,
    "",
    "## Summary",
    "",
    `- Manifest items still safe to write: ${report.manifestItems}`,
    `- Skipped pages: ${report.skippedPages}`,
    `- Already covered skipped pages: ${report.classification.coveredTotal}`,
    `- Uncovered skipped pages: ${report.classification.uncoveredTotal}`,
    "",
    "## Uncovered Reason Counts",
    ""
  ];

  for (const [reason, count] of Object.entries(report.classification.reasonCountsUncovered)) {
    lines.push(`- ${reason}: ${count}`);
  }

  lines.push("", "## Buckets", "");
  for (const [name, bucket] of Object.entries(report.classification.buckets)) {
    lines.push(`### ${name}`, "", `Count: ${bucket.count}`, "");
    for (const item of bucket.samples) {
      const suffix = item.issueKinds?.length ? `; issues: ${item.issueKinds.join(", ")}` : "";
      lines.push(`- ${item.title || item.pageId} (${item.reasons.join(", ")}${suffix})`);
    }
    if (bucket.samples.length === 0) lines.push("- none");
    lines.push("");
  }

  lines.push(
    "## Suggested Next Actions",
    "",
    "- If `salvageablePlaceholderPages` is non-zero, create a small guarded manifest for those pages and write only real media-block candidates.",
    "- Treat `noMediaPlaceholderPages` as Notion structure cleanup; do not create Media Assets rows from titles alone.",
    "- Treat `manualExcludedTitlePatternPages` as manual review; those pages matched an explicit local exclusion pattern in an earlier filtered batch.",
    "- Handle `operatorPrefixPages` only with status/backlog rules, especially `【仅供下载】`.",
    "- Handle `seriesPages` with the episode-aware TV workflow, not the movie batch writer.",
    ""
  );

  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs();
  const manifest = loadJson(options.manifestPath);
  const skipped = manifest.skipped ?? [];
  const previewReports = loadPreviewReports(options.previewDir);
  const classification = classify(skipped, previewReports, options.sampleLimit);
  const report = {
    generatedAt: new Date().toISOString(),
    manifestPath: options.manifestPath,
    previewDir: options.previewDir,
    previewReportsLoaded: previewReports.size,
    manifestItems: (manifest.items ?? []).length,
    skippedPages: skipped.length,
    classification
  };

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (options.markdownPath) {
    fs.mkdirSync(path.dirname(options.markdownPath), { recursive: true });
    fs.writeFileSync(options.markdownPath, renderMarkdown(report), "utf8");
  }

  console.log(JSON.stringify({
    outputPath: options.outputPath,
    markdownPath: options.markdownPath || undefined,
    previewReportsLoaded: report.previewReportsLoaded,
    manifestItems: report.manifestItems,
    skippedPages: report.skippedPages,
    uncoveredTotal: classification.uncoveredTotal,
    bucketCounts: Object.fromEntries(
      Object.entries(classification.buckets).map(([name, bucket]) => [name, bucket.count])
    )
  }, null, 2));
}

main();
