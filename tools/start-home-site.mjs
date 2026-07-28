import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
config({ path: path.join(repositoryRoot, ".env"), override: false, quiet: true });

const port = String(process.env.WWPDW_HOME_PORT ?? "43187");
const webDistDirectory = path.resolve(
  process.env.WWPDW_WEB_DIST_DIR ?? path.join(repositoryRoot, "apps", "web", "dist")
);
const localDataDirectory = path.resolve(
  process.env.WWPDW_HOME_DATA_DIR ?? path.join(repositoryRoot, ".local-data", "home-site")
);
const publicOrigin = process.env.WWPDW_HOME_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
const localOrigins = [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  publicOrigin
].filter(Boolean);

if (!existsSync(path.join(webDistDirectory, "index.html"))) {
  throw new Error(`Home web build was not found at ${webDistDirectory}. Run "npm run home:build" first.`);
}

process.env.API_PORT = port;
process.env.WWPDW_WEB_DIST_DIR = webDistDirectory;
process.env.WWPDW_LOCAL_DATA_DIR = localDataDirectory;
process.env.CACHE_BACKEND = process.env.WWPDW_HOME_CACHE_BACKEND ?? "filesystem";
process.env.WWPDW_MEDIA_ROOT ??= "F:\\wwp_storage";
process.env.WWPDW_AUTH_BACKEND ??= "azure";
process.env.WWPDW_SESSION_BACKEND ??= process.env.WWPDW_AUTH_BACKEND;
process.env.SEARCH_INDEX_BACKEND = "local";
process.env.TSPDT_BROWSE_BACKEND = "local";
process.env.SEARCH_INDEX_WRITE_THROUGH = "false";
process.env.SEARCH_INDEX_SYNC_CONCURRENCY ??= "2";
process.env.WWPDW_CREDIT_BILLING_ENABLED = "false";
process.env.WORKER_MODE ??= "daemon";
process.env.WORKER_MAX_CONCURRENT ??= "2";
process.env.WWPDW_ALLOWED_WEB_ORIGINS ??= localOrigins.join(",");
process.env.NODE_ENV = publicOrigin?.startsWith("https://") ? "production" : "development";
process.env.WWPDW_META_SYNC_LIBRARY_MODE = "true";

const notionSyncEnabled = !["0", "false", "no", "off"].includes(
  (process.env.WWPDW_HOME_NOTION_SYNC_ENABLED ?? "true").toLowerCase()
);
const notionSyncIntervalMinutes = Math.max(
  5,
  Number(process.env.WWPDW_HOME_NOTION_SYNC_INTERVAL_MINUTES ?? 30)
);
const notionFullSyncMinimumEntries = Math.max(
  1,
  Number(process.env.WWPDW_HOME_NOTION_FULL_SYNC_MIN_ENTRIES ?? 500)
);

console.log(JSON.stringify({
  event: "home.start",
  localUrl: `http://127.0.0.1:${port}`,
  publicOrigin,
  webDistDirectory,
  localDataDirectory,
  mediaRoot: process.env.WWPDW_MEDIA_ROOT,
  cacheBackend: process.env.CACHE_BACKEND,
  authBackend: process.env.WWPDW_AUTH_BACKEND,
  sessionBackend: process.env.WWPDW_SESSION_BACKEND,
  searchIndexBackend: process.env.SEARCH_INDEX_BACKEND,
  creditBillingEnabled: process.env.WWPDW_CREDIT_BILLING_ENABLED,
  notionSyncEnabled,
  notionSyncIntervalMinutes,
  nodeEnvironment: process.env.NODE_ENV
}));

await import("../apps/api/src/server.ts");
await import("../apps/worker/src/worker.ts");

if (notionSyncEnabled) {
  void runNotionSyncLoop().catch((error) => {
    console.error(JSON.stringify({
      event: "home.notion_sync.loop_failed",
      errorMessage: error instanceof Error ? error.message : String(error)
    }));
  });
}

async function runNotionSyncLoop() {
  const [{ createSearchIndexStore }, { runMetaSync }] = await Promise.all([
    import("../packages/cache-store/src/index.ts"),
    import("../apps/api/src/meta-sync.ts")
  ]);
  const searchIndex = createSearchIndexStore();

  while (true) {
    let succeeded = false;
    try {
      const stats = await searchIndex.getStats();
      const mode = stats.entryCount < notionFullSyncMinimumEntries ? "full" : "incremental";
      process.env.META_SYNC_MODE = mode;
      console.log(JSON.stringify({
        event: "home.notion_sync.start",
        mode,
        entryCount: stats.entryCount,
        index: searchIndex.description
      }));
      await runMetaSync();
      succeeded = true;
      console.log(JSON.stringify({
        event: "home.notion_sync.complete",
        mode,
        index: searchIndex.description
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "home.notion_sync.failed",
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
    }

    const waitMinutes = succeeded ? notionSyncIntervalMinutes : 5;
    await new Promise((resolve) => setTimeout(resolve, waitMinutes * 60 * 1000));
  }
}
