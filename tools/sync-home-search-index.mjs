import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
config({ path: path.join(repositoryRoot, ".env"), override: false, quiet: true });

process.env.WWPDW_LOCAL_DATA_DIR = path.resolve(
  process.env.WWPDW_HOME_DATA_DIR ?? path.join(repositoryRoot, ".local-data", "home-site")
);
process.env.CACHE_BACKEND = process.env.WWPDW_HOME_CACHE_BACKEND ?? "filesystem";
process.env.WWPDW_MEDIA_ROOT ??= "F:\\wwp_storage";
process.env.SEARCH_INDEX_BACKEND = "local";
process.env.TSPDT_BROWSE_BACKEND = "local";
process.env.SEARCH_INDEX_WRITE_THROUGH = "false";
process.env.SEARCH_INDEX_SYNC_CONCURRENCY ??= "2";
process.env.WWPDW_META_SYNC_LIBRARY_MODE = "true";

const { runMetaSync } = await import("../apps/api/src/meta-sync.ts");
await runMetaSync();
