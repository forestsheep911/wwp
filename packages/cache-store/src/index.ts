import path from "node:path";
import { fileURLToPath } from "node:url";
import { AzureCacheStore } from "./azure.js";
import { LocalCacheStore } from "./local.js";
import type { CacheBackend, CacheStore } from "./types.js";

export type { CacheBackend, CacheStore } from "./types.js";
export { addDays, createJob, isFreshReady } from "./jobs.js";
export { AzureCacheStore } from "./azure.js";
export { LocalCacheStore } from "./local.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const defaultStatePath = path.join(repoRoot, ".local-data", "cache-state.json");

export function createCacheStore(backend = process.env.CACHE_BACKEND as CacheBackend): CacheStore {
  if (backend === "azure") {
    return new AzureCacheStore();
  }

  return new LocalCacheStore(process.env.WWPDW_LOCAL_DATA_DIR
    ? path.resolve(process.env.WWPDW_LOCAL_DATA_DIR, "cache-state.json")
    : defaultStatePath);
}
