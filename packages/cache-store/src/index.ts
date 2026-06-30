import path from "node:path";
import { fileURLToPath } from "node:url";
import { AzureCacheStore } from "./azure.js";
import { LocalCacheStore } from "./local.js";
import { AzureSearchIndexStore, LocalSearchIndexStore } from "./search-index.js";
import type { CacheBackend, CacheStore } from "./types.js";

export type { CacheBackend, CacheStore } from "./types.js";
export { addDays, cacheAssetTtlDays, createJob, isFreshReady } from "./jobs.js";
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

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const defaultStatePath = path.join(repoRoot, ".local-data", "cache-state.json");
const defaultSearchIndexPath = path.join(repoRoot, ".local-data", "search-index.json");

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
