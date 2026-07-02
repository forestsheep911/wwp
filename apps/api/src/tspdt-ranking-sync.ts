import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTspdtRanking,
  createMovieCatalogStore,
  createTspdtRankingStore
} from "@wwpdw/cache-store";
import {
  tspdtEdition,
  tspdtSourceUrl,
  tspdtTop1000,
  type TspdtEntry
} from "../../web/src/cinema/tspdt";

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
  const catalogStore = createMovieCatalogStore();
  const rankingStore = createTspdtRankingStore();
  const catalog = await catalogStore.getState();
  const catalogWorkCount = Object.keys(catalog.works).length;

  if (catalogWorkCount === 0) {
    throw new Error("Movie catalog is empty. Run `npm run sync:catalog` before syncing TSPDT ranking.");
  }

  const idMap = await readIdMap();
  const enrichedEntries = mergeIdMap(tspdtTop1000, idMap);
  const ranking = buildTspdtRanking(enrichedEntries, catalog, {
    edition: tspdtEdition,
    sourceUrl: tspdtSourceUrl
  });

  await rankingStore.replaceState(ranking);

  console.log(JSON.stringify({
    status: "ok",
    ranking: rankingStore.description,
    catalog: catalogStore.description,
    idMapPath,
    idMapMatched: Object.values(idMap.entries ?? {}).filter((entry) => entry.status === "matched" && entry.imdb).length,
    catalogWorkCount,
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
    if (entry.imdbId || mapped?.status !== "matched" || !mapped.imdb) {
      return entry;
    }
    return {
      ...entry,
      imdbId: mapped.imdb
    };
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
