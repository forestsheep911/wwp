import "./env.js";
import {
  durationMs,
  errorLogFields,
  logError,
  logInfo,
  logWarn
} from "@wwpdw/shared";
import {
  buildMovieCatalogFromResults,
  buildTspdtBrowseState,
  buildTspdtRanking,
  createCacheStore,
  createSearchIndexStore,
  createTspdtBrowseStore,
  type SearchIndexRun,
  type SearchIndexSyncMode
} from "@wwpdw/cache-store";
import { NotionSearchSource } from "./notion-source.js";
import { tspdtEdition, tspdtSourceUrl, tspdtTop1000 } from "../../web/src/cinema/tspdt";
import { tspdtImdbIds } from "../../web/src/cinema/tspdt-id-map";

interface SyncOptions {
  mode: SearchIndexSyncMode;
  limit?: number;
  delayMs: number;
  pageSize: number;
  progressEvery: number;
  incrementalOverlapMinutes: number;
  incrementalBootstrapLimit: number;
  deleteMissingOnFull: boolean;
  posterCacheEnabled: boolean;
}

function numberOption(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function booleanOption(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    parsed.set(rawName, value ?? "");
  }

  if (!parsed.has("mode") && positionals[0]) {
    parsed.set("mode", positionals[0]);
  }

  if (!parsed.has("limit") && positionals[1]) {
    parsed.set("limit", positionals[1]);
  }

  if (!parsed.has("delay-ms") && positionals[2]) {
    parsed.set("delay-ms", positionals[2]);
  }

  return parsed;
}

function syncOptions(): SyncOptions {
  const args = parseArgs();
  const mode = (args.get("mode") ?? process.env.META_SYNC_MODE ?? "incremental") as SearchIndexSyncMode;
  if (!["full", "incremental", "ondemand"].includes(mode)) {
    throw new Error(`Unsupported META_SYNC_MODE: ${mode}`);
  }

  const limitValue = Number(args.get("limit") ?? process.env.SEARCH_INDEX_SYNC_LIMIT ?? 0);
  return {
    mode,
    limit: Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : undefined,
    delayMs: Math.max(0, Math.floor(Number(args.get("delay-ms") ?? numberOption("SEARCH_INDEX_SYNC_DELAY_MS", 1500)))),
    pageSize: Math.min(
      100,
      Math.max(1, Math.floor(Number(args.get("page-size") ?? numberOption("SEARCH_INDEX_SYNC_PAGE_SIZE", 25))))
    ),
    progressEvery: Math.max(1, Math.floor(numberOption("SEARCH_INDEX_SYNC_PROGRESS_EVERY", 10))),
    incrementalOverlapMinutes: Math.max(0, Math.floor(numberOption("SEARCH_INDEX_INCREMENTAL_OVERLAP_MINUTES", 10))),
    incrementalBootstrapLimit: Math.max(1, Math.floor(numberOption("SEARCH_INDEX_INCREMENTAL_BOOTSTRAP_LIMIT", 200))),
    deleteMissingOnFull: booleanOption("SEARCH_INDEX_FULL_DELETE_MISSING", true),
    posterCacheEnabled: booleanOption("POSTER_CACHE_ENABLED", true)
  };
}

function sinceWithOverlap(value: string | undefined, overlapMinutes: number) {
  if (!value) {
    return undefined;
  }

  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return undefined;
  }

  return new Date(time - overlapMinutes * 60 * 1000).toISOString();
}

async function updateRunSafely(run: SearchIndexRun) {
  try {
    await searchIndex.updateRun(run);
  } catch (error) {
    logWarn("meta.sync.run_update_failed", {
      runId: run.id,
      ...errorLogFields(error)
    });
  }
}

const searchIndex = createSearchIndexStore();
const cacheStore = createCacheStore();
const tspdtBrowseStore = createTspdtBrowseStore();
const notionSource = new NotionSearchSource();

async function runSync() {
  const startedAt = Date.now();
  const options = syncOptions();
  const stats = await searchIndex.getStats();
  const since = options.mode === "incremental"
    ? sinceWithOverlap(stats.latestSourceUpdatedAt ?? stats.lastFullSyncAt, options.incrementalOverlapMinutes)
    : undefined;
  const limit = options.limit ?? (options.mode === "incremental" && !since
    ? options.incrementalBootstrapLimit
    : undefined);
  const seenAssetKeys = new Set<string>();
  const run = await searchIndex.startRun(options.mode);

  logInfo("meta.sync.start", {
    runId: run.id,
    mode: options.mode,
    index: searchIndex.description,
    since,
    limit,
    delayMs: options.delayMs,
    pageSize: options.pageSize,
    posterCacheEnabled: options.posterCacheEnabled,
    previousEntryCount: stats.entryCount
  });

  try {
    for await (const item of notionSource.scanLibraryResults({
      since,
      limit,
      delayMs: options.delayMs,
      pageSize: options.pageSize
    })) {
      run.scanned += 1;
      run.lastSourceUpdatedAt = [run.lastSourceUpdatedAt, item.lastEditedTime]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);

      if (!item.result) {
        run.failed += 1;
        logWarn("meta.sync.page_failed", {
          runId: run.id,
          pageId: item.pageId,
          title: item.title,
          lastEditedTime: item.lastEditedTime,
          errorMessage: item.error
        });
      } else {
        const result = options.posterCacheEnabled
          ? await cacheStore.cacheMoviePosters(item.result)
          : item.result;
        await searchIndex.upsertResult(result);
        run.saved += 1;
        seenAssetKeys.add(result.assetKey);
      }

      if (run.scanned % options.progressEvery === 0) {
        await updateRunSafely(run);
        logInfo("meta.sync.progress", {
          runId: run.id,
          mode: run.mode,
          scanned: run.scanned,
          saved: run.saved,
          failed: run.failed,
          lastSourceUpdatedAt: run.lastSourceUpdatedAt,
          durationMs: durationMs(startedAt)
        });
      }
    }

    if (options.mode === "full" && options.deleteMissingOnFull) {
      run.deleted = await searchIndex.deleteEntriesNotIn(seenAssetKeys);
    }

    const completed = await searchIndex.completeRun(run, "succeeded");
    await refreshTspdtBrowseIndexSafely(completed.id);
    logInfo("meta.sync.complete", {
      runId: completed.id,
      mode: completed.mode,
      scanned: completed.scanned,
      saved: completed.saved,
      deleted: completed.deleted,
      failed: completed.failed,
      lastSourceUpdatedAt: completed.lastSourceUpdatedAt,
      durationMs: durationMs(startedAt)
    });
  } catch (error) {
    const failed = await searchIndex.completeRun(
      run,
      "failed",
      error instanceof Error ? error.message : "Metadata sync failed."
    );
    logError("meta.sync.failed", {
      runId: failed.id,
      mode: failed.mode,
      scanned: failed.scanned,
      saved: failed.saved,
      deleted: failed.deleted,
      failed: failed.failed,
      durationMs: durationMs(startedAt),
      ...errorLogFields(error)
    });
    throw error;
  }
}

async function refreshTspdtBrowseIndexSafely(runId: string) {
  if (!booleanOption("TSPDT_BROWSE_SYNC_ENABLED", true)) {
    return;
  }

  const startedAt = Date.now();
  const limit = Math.max(1, Math.floor(numberOption("TSPDT_BROWSE_SYNC_LIMIT", 100_000)));
  try {
    const results = await searchIndex.search("", limit);
    const { state: catalog, summary: catalogSummary } = buildMovieCatalogFromResults(results, {
      sourceKind: "search-index",
      sourcePath: searchIndex.description
    });
    const ranking = buildTspdtRanking(mergeTspdtImdbIds(), catalog, {
      edition: tspdtEdition,
      sourceUrl: tspdtSourceUrl
    });
    const browseState = buildTspdtBrowseState(ranking, catalog, results);

    await tspdtBrowseStore.replaceState(browseState);
    logInfo("meta.sync.tspdt_browse.complete", {
      runId,
      store: tspdtBrowseStore.description,
      searchIndex: searchIndex.description,
      resultCount: results.length,
      catalogWorkCount: Object.keys(catalog.works).length,
      catalogIssueCount: catalogSummary.issueCount,
      browseEntryCount: browseState.entries.length,
      ...ranking.summary,
      durationMs: durationMs(startedAt)
    });
  } catch (error) {
    logWarn("meta.sync.tspdt_browse.failed", {
      runId,
      store: tspdtBrowseStore.description,
      durationMs: durationMs(startedAt),
      ...errorLogFields(error)
    });
  }
}

function mergeTspdtImdbIds() {
  return tspdtTop1000.map((entry) => {
    const imdbId = entry.imdbId ?? tspdtImdbIds[entry.rank];
    return imdbId ? { ...entry, imdbId } : entry;
  });
}

try {
  await runSync();
  process.exit(0);
} catch {
  process.exit(1);
}
