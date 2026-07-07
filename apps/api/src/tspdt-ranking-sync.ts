import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMovieCatalogFromResults,
  buildTspdtBrowseState,
  buildTspdtRanking,
  createSearchIndexStore,
  createTspdtBrowseStore,
  createTspdtRankingStore
} from "@wwpdw/cache-store";
import {
  tspdtEdition,
  tspdtSourceUrl,
  tspdtTop1000,
  type TspdtEntry
} from "../../web/src/cinema/tspdt";
import { tspdtImdbIds } from "../../web/src/cinema/tspdt-id-map";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const idMapPath = path.join(repoRoot, ".local-data", `tspdt-id-map-${tspdtEdition}.json`);

interface TspdtIdMapState {
  entries?: Record<string, {
    status?: string;
    imdb?: string;
  }>;
}

async function main() {
  const searchIndex = createSearchIndexStore();
  const browseStore = createTspdtBrowseStore();
  const rankingStore = createTspdtRankingStore();
  const limit = Math.max(1, Math.floor(Number(process.env.TSPDT_BROWSE_SYNC_LIMIT ?? 100_000)));
  const results = await searchIndex.search("", limit);
  const { state: catalog, summary: catalogSummary } = buildMovieCatalogFromResults(results, {
    sourceKind: "search-index",
    sourcePath: searchIndex.description
  });
  const catalogWorkCount = Object.keys(catalog.works).length;

  if (catalogWorkCount === 0) {
    throw new Error("Movie catalog is empty. Sync the search index before syncing TSPDT ranking.");
  }

  const idMap = await readIdMap();
  const enrichedEntries = mergeIdMap(tspdtTop1000, idMap);
  const ranking = buildTspdtRanking(enrichedEntries, catalog, {
    edition: tspdtEdition,
    sourceUrl: tspdtSourceUrl
  });
  const browseState = buildTspdtBrowseState(ranking, catalog, results);

  await rankingStore.replaceState(ranking);
  await browseStore.replaceState(browseState);

  console.log(JSON.stringify({
    status: "ok",
    ranking: rankingStore.description,
    browse: browseStore.description,
    searchIndex: searchIndex.description,
    idMapPath,
    idMapMatched: Object.values(idMap.entries ?? {}).filter((entry) => entry.status === "matched" && entry.imdb).length,
    embeddedIdMapMatched: Object.keys(tspdtImdbIds).length,
    catalogWorkCount,
    catalogIssueCount: catalogSummary.issueCount,
    browseEntryCount: browseState.entries.length,
    ...ranking.summary
  }, null, 2));
}

async function readIdMap(): Promise<TspdtIdMapState> {
  try {
    const raw = await readFile(idMapPath, "utf8");
    return JSON.parse(raw) as TspdtIdMapState;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function mergeIdMap(entries: TspdtEntry[], idMap: TspdtIdMapState) {
  return entries.map((entry) => {
    const mapped = idMap.entries?.[String(entry.rank)];
    const imdbId = entry.imdbId ?? (mapped?.status === "matched" ? mapped.imdb : undefined) ?? tspdtImdbIds[entry.rank];
    if (!imdbId || entry.imdbId === imdbId) {
      return entry;
    }
    return {
      ...entry,
      imdbId
    };
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
