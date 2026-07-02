import "dotenv/config";
import {
  buildMovieCatalogFromResults,
  createMovieCatalogStore,
  createSearchIndexStore
} from "@wwpdw/cache-store";

interface SyncOptions {
  limit?: number;
}

function parseArgs(args: string[]) {
  const options: SyncOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      options.limit = Number(args[++index]);
    }
  }

  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive number.");
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const searchIndex = createSearchIndexStore();
  const catalogStore = createMovieCatalogStore();
  const limit = Math.floor(options.limit ?? 100_000);
  const results = await searchIndex.search("", limit);
  const { state, summary } = buildMovieCatalogFromResults(results, {
    sourceKind: "search-index",
    sourcePath: searchIndex.description
  });

  await catalogStore.replaceState(state);

  console.log(JSON.stringify({
    status: "ok",
    catalog: catalogStore.description,
    searchIndex: searchIndex.description,
    ...summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
