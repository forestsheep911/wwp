import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { SearchResult } from "@wwpdw/shared";

await import("./env.js");

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");

if (process.env.WWPDW_LOCAL_DATA_DIR && !path.isAbsolute(process.env.WWPDW_LOCAL_DATA_DIR)) {
  process.env.WWPDW_LOCAL_DATA_DIR = path.resolve(repoRoot, process.env.WWPDW_LOCAL_DATA_DIR);
}

const { createCacheStore, createSearchIndexStore } = await import("@wwpdw/cache-store");
const { NotionSearchSource } = await import("./notion-source.js");

interface Options {
  apply: boolean;
  force: boolean;
  includeMissing: boolean;
  limit: number;
  scanLimit?: number;
  query: string;
  delayMs: number;
  reportPath: string;
  assetKeys: Set<string>;
}

interface BackfillRecord {
  assetKey: string;
  title: string;
  status: "would_update" | "updated" | "skipped" | "failed";
  reason?: string;
  beforePosterUrl?: string;
  afterPosterUrl?: string;
  beforePosterSource?: string;
  afterPosterSource?: string;
  beforePosterCount?: number;
  afterPosterCount?: number;
  error?: string;
}

const notionHostedFilePattern = /(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i;
const defaultReportPath = path.join(repoRoot, ".local-data", "poster-backfill-report.json");

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    apply: false,
    force: false,
    includeMissing: false,
    limit: Infinity,
    query: "",
    delayMs: 500,
    reportPath: defaultReportPath,
    assetKeys: new Set()
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--include-missing") {
      options.includeMissing = true;
    } else if (arg === "--limit") {
      options.limit = Number(args[++index]);
    } else if (arg === "--scan-limit") {
      options.scanLimit = Number(args[++index]);
    } else if (arg === "--query") {
      options.query = args[++index] ?? "";
    } else if (arg === "--delay-ms") {
      options.delayMs = Number(args[++index]);
    } else if (arg === "--report") {
      options.reportPath = args[++index] ?? defaultReportPath;
    } else if (arg === "--asset-key") {
      const assetKey = args[++index];
      if (assetKey) {
        options.assetKeys.add(assetKey);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    options.limit = Infinity;
  }
  if (options.scanLimit !== undefined && (!Number.isFinite(options.scanLimit) || options.scanLimit <= 0)) {
    options.scanLimit = undefined;
  }
  options.delayMs = Number.isFinite(options.delayMs) && options.delayMs > 0 ? Math.floor(options.delayMs) : 0;

  return options;
}

function posterUrl(result: SearchResult) {
  return result.metadata?.posterUrl ??
    result.metadata?.posters?.[0]?.url ??
    result.metadata?.work?.media?.posters?.[0]?.url;
}

function posterSource(result: SearchResult) {
  return result.metadata?.posters?.[0]?.source ??
    result.metadata?.work?.media?.posters?.[0]?.source;
}

function isNotionTemporaryUrl(url?: string) {
  return Boolean(url && notionHostedFilePattern.test(url));
}

function needsPosterBackfill(result: SearchResult, options: Options) {
  if (options.force) {
    return true;
  }

  const url = posterUrl(result);
  const posters = [
    ...(result.metadata?.posters ?? []),
    ...(result.metadata?.work?.media?.posters ?? [])
  ];
  if (!url) {
    return options.includeMissing;
  }

  if (isNotionTemporaryUrl(url)) {
    return true;
  }

  return posters.some((poster) => isNotionTemporaryUrl(poster.url) || (poster.source !== "blob" && !poster.blobName));
}

function summarize(result: SearchResult) {
  return {
    posterUrl: posterUrl(result),
    posterSource: posterSource(result),
    posterCount: result.metadata?.posters?.length ?? 0
  };
}

function recordFor(
  result: SearchResult,
  status: BackfillRecord["status"],
  reason?: string,
  refreshed?: SearchResult
): BackfillRecord {
  const before = summarize(result);
  const after = refreshed ? summarize(refreshed) : undefined;
  return {
    assetKey: result.assetKey,
    title: result.title,
    status,
    reason,
    beforePosterUrl: before.posterUrl,
    afterPosterUrl: after?.posterUrl,
    beforePosterSource: before.posterSource,
    afterPosterSource: after?.posterSource,
    beforePosterCount: before.posterCount,
    afterPosterCount: after?.posterCount
  };
}

async function writeReport(reportPath: string, report: unknown) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseArgs();
  const searchIndex = createSearchIndexStore();
  const cacheStore = createCacheStore();
  const notionSource = new NotionSearchSource();
  const refreshPostersForResult = (result: SearchResult) => {
    let refreshed: Promise<SearchResult | undefined> | undefined;
    return async () => {
      refreshed ??= notionSource.refreshAsset({
        assetKey: result.assetKey,
        sourcePageId: result.sourcePageId,
        title: result.title,
        sourceBreadcrumb: result.sourceBreadcrumb
      });
      return (await refreshed)?.metadata?.posters;
    };
  };
  const stats = await searchIndex.getStats();
  const scanLimit = options.scanLimit ?? (options.query ? 100 : stats.entryCount);
  const candidates = await searchIndex.search(options.query, scanLimit);
  const filtered = candidates.filter((result) => {
    if (options.assetKeys.size > 0 && !options.assetKeys.has(result.assetKey)) {
      return false;
    }
    return needsPosterBackfill(result, options);
  });
  const selected = filtered.slice(0, options.limit);
  const records: BackfillRecord[] = [];

  console.log(JSON.stringify({
    event: "poster.backfill.start",
    apply: options.apply,
    backend: stats.backend,
    index: stats.description,
    entryCount: stats.entryCount,
    scanLimit,
    candidateCount: candidates.length,
    staleCount: filtered.length,
    selectedCount: selected.length,
    query: options.query || undefined
  }));

  for (const [index, result] of selected.entries()) {
    try {
      const refreshed = await notionSource.refreshAsset({
        assetKey: result.assetKey,
        sourcePageId: result.sourcePageId,
        title: result.title,
        sourceBreadcrumb: result.sourceBreadcrumb
      });

      if (!refreshed) {
        records.push(recordFor(result, "failed", "notion_refresh_missing"));
      } else if (!options.apply) {
        records.push(recordFor(result, "would_update", undefined, refreshed));
      } else {
        const cached = await cacheStore.cacheMoviePosters(refreshed, {
          refreshPosters: refreshPostersForResult(refreshed)
        });
        await searchIndex.upsertResult(cached);
        records.push(recordFor(result, "updated", undefined, cached));
      }
    } catch (error) {
      const record = recordFor(result, "failed");
      record.error = error instanceof Error ? error.message : "Unknown poster backfill error.";
      records.push(record);
    }

    const latest = records.at(-1);
    console.log(JSON.stringify({
      event: "poster.backfill.progress",
      index: index + 1,
      total: selected.length,
      assetKey: result.assetKey,
      title: result.title,
      status: latest?.status,
      beforePosterSource: latest?.beforePosterSource,
      afterPosterSource: latest?.afterPosterSource
    }));

    if (options.delayMs > 0 && index < selected.length - 1) {
      await sleep(options.delayMs);
    }
  }

  const summary = {
    apply: options.apply,
    backend: stats.backend,
    index: stats.description,
    entryCount: stats.entryCount,
    scanned: candidates.length,
    stale: filtered.length,
    selected: selected.length,
    updated: records.filter((record) => record.status === "updated").length,
    wouldUpdate: records.filter((record) => record.status === "would_update").length,
    failed: records.filter((record) => record.status === "failed").length,
    skipped: records.filter((record) => record.status === "skipped").length
  };

  await writeReport(options.reportPath, {
    generatedAt: new Date().toISOString(),
    summary,
    records
  });

  console.log(JSON.stringify({
    event: "poster.backfill.complete",
    ...summary,
    reportPath: options.reportPath
  }));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

await main();
