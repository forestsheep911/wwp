import path from "node:path";
import { fileURLToPath } from "node:url";
import { AzureCacheStore } from "./azure.js";
import { LocalCacheStore } from "./local.js";
import { LocalMovieCatalogStore } from "./movie-catalog.js";
import { AzureSearchIndexStore, LocalSearchIndexStore } from "./search-index.js";
import { AzureTspdtBrowseStore, LocalTspdtBrowseStore, LocalTspdtRankingStore } from "./tspdt-ranking.js";
import type { CacheBackend, CacheStore } from "./types.js";

export type { CacheBackend, CacheStore } from "./types.js";
export { addDays, cacheAssetIdleTtlDays, createJob, isFreshReady } from "./jobs.js";
export { AzureCacheStore } from "./azure.js";
export { LocalCacheStore } from "./local.js";
export type {
  SearchIndexEntry,
  SearchIndexRun,
  SearchIndexStats,
  SearchIndexStore,
  SearchIndexSyncMode,
  SearchIndexSyncStatus
} from "./search-index.js";
export { AzureSearchIndexStore, LocalSearchIndexStore } from "./search-index.js";
export type {
  MovieCatalogBuildOptions,
  MovieCatalogBuildSummary,
  MovieCatalogStore
} from "./movie-catalog.js";
export {
  buildMovieCatalogFromResults,
  emptyMovieCatalogState,
  LocalMovieCatalogStore,
  summarizeMovieCatalog
} from "./movie-catalog.js";
export type {
  TspdtRankingBuildOptions,
  TspdtBrowseEntry,
  TspdtBrowseState,
  TspdtBrowseStore,
  TspdtRankingStore,
  TspdtSourceEntry
} from "./tspdt-ranking.js";
export {
  AzureTspdtBrowseStore,
  buildTspdtBrowseState,
  buildTspdtRanking,
  LocalTspdtBrowseStore,
  LocalTspdtRankingStore
} from "./tspdt-ranking.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const defaultStatePath = path.join(repoRoot, ".local-data", "cache-state.json");
const defaultSearchIndexPath = path.join(repoRoot, ".local-data", "search-index.json");
const defaultMovieCatalogPath = path.join(repoRoot, ".local-data", "movie-catalog.json");
const defaultTspdtRankingPath = path.join(repoRoot, ".local-data", "tspdt-ranking-2026.json");
const defaultTspdtBrowsePath = path.join(repoRoot, ".local-data", "tspdt-browse-2026.json");

export function createCacheStore(backend = process.env.CACHE_BACKEND as CacheBackend): CacheStore {
  if (backend === "azure") {
    return new AzureCacheStore();
  }

  return new LocalCacheStore(process.env.WWPDW_LOCAL_DATA_DIR
    ? path.resolve(process.env.WWPDW_LOCAL_DATA_DIR, "cache-state.json")
    : defaultStatePath);
}

export function createSearchIndexStore(
  backend = process.env.CACHE_BACKEND as CacheBackend
): LocalSearchIndexStore | AzureSearchIndexStore {
  if (backend === "azure") {
    return new AzureSearchIndexStore();
  }

  return new LocalSearchIndexStore(process.env.WWPDW_LOCAL_DATA_DIR
    ? path.resolve(process.env.WWPDW_LOCAL_DATA_DIR, "search-index.json")
    : defaultSearchIndexPath);
}

export function createMovieCatalogStore(): LocalMovieCatalogStore {
  return new LocalMovieCatalogStore(process.env.WWPDW_LOCAL_DATA_DIR
    ? path.resolve(process.env.WWPDW_LOCAL_DATA_DIR, "movie-catalog.json")
    : defaultMovieCatalogPath);
}

export function createTspdtRankingStore(): LocalTspdtRankingStore {
  return new LocalTspdtRankingStore(process.env.WWPDW_LOCAL_DATA_DIR
    ? path.resolve(process.env.WWPDW_LOCAL_DATA_DIR, "tspdt-ranking-2026.json")
    : defaultTspdtRankingPath);
}

export function createTspdtBrowseStore(
  backend = process.env.CACHE_BACKEND as CacheBackend
): LocalTspdtBrowseStore | AzureTspdtBrowseStore {
  if (backend === "azure") {
    return new AzureTspdtBrowseStore();
  }

  return new LocalTspdtBrowseStore(process.env.WWPDW_LOCAL_DATA_DIR
    ? path.resolve(process.env.WWPDW_LOCAL_DATA_DIR, "tspdt-browse-2026.json")
    : defaultTspdtBrowsePath);
}
