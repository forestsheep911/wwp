import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
config({ path: path.join(repositoryRoot, ".env"), override: false, quiet: true });

process.env.SEARCH_INDEX_SNAPSHOT_PATH ??= path.join(
  repositoryRoot,
  ".local-data",
  "home-site",
  "search-index-snapshot.json"
);
process.env.SEARCH_INDEX_SNAPSHOT_PROGRESS ??= "true";

const { AzureSearchIndexStore } = await import("../packages/cache-store/src/search-index.ts");
const store = new AzureSearchIndexStore();
const startedAt = Date.now();
const entries = await store.refreshSnapshot();

console.log(JSON.stringify({
  event: "search_index.snapshot.complete",
  entries: entries.length,
  elapsedMs: Date.now() - startedAt,
  snapshotPath: path.resolve(process.env.SEARCH_INDEX_SNAPSHOT_PATH)
}));
