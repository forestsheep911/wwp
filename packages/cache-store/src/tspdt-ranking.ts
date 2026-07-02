import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MovieCatalogEntry,
  MovieCatalogState,
  TspdtRankingCandidate,
  TspdtRankingEntry,
  TspdtRankingState
} from "@wwpdw/shared";

export interface TspdtSourceEntry {
  rank: number;
  previousRank: string;
  title: string;
  director: string;
  year: string;
  country: string;
  workId?: string;
  imdbId?: string;
  doubanSubjectId?: string;
}

export interface TspdtRankingBuildOptions {
  edition: string;
  sourceUrl: string;
  listId?: string;
}

export interface TspdtRankingStore {
  readonly description: string;
  getState(): Promise<TspdtRankingState | undefined>;
  replaceState(state: TspdtRankingState): Promise<void>;
}

export class LocalTspdtRankingStore implements TspdtRankingStore {
  readonly description: string;

  constructor(private readonly statePath: string) {
    this.description = `local:${statePath}`;
  }

  async getState() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as TspdtRankingState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async replaceState(state: TspdtRankingState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }
}

export function buildTspdtRanking(
  entries: TspdtSourceEntry[],
  catalog: MovieCatalogState,
  options: TspdtRankingBuildOptions
): TspdtRankingState {
  const listId = options.listId ?? `tspdt-gf1000-${options.edition}`;
  const rankingEntries = entries.map((entry) => matchTspdtEntry(entry, catalog, listId));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    listId,
    edition: options.edition,
    sourceUrl: options.sourceUrl,
    entries: rankingEntries,
    summary: {
      total: rankingEntries.length,
      matched: rankingEntries.filter((entry) => entry.matchStatus === "matched").length,
      manual: rankingEntries.filter((entry) => entry.matchStatus === "manual").length,
      ambiguous: rankingEntries.filter((entry) => entry.matchStatus === "ambiguous").length,
      unmatched: rankingEntries.filter((entry) => entry.matchStatus === "unmatched").length
    }
  };
}

function matchTspdtEntry(
  entry: TspdtSourceEntry,
  catalog: MovieCatalogState,
  listId: string
): TspdtRankingEntry {
  const base: Omit<TspdtRankingEntry, "matchStatus"> = {
    listId,
    rank: entry.rank,
    previousRank: entry.previousRank,
    title: entry.title,
    director: entry.director,
    year: entry.year,
    country: entry.country,
    externalIds: cleanExternalIds({
      imdb: entry.imdbId,
      douban: entry.doubanSubjectId
    })
  };

  if (entry.workId && catalog.works[entry.workId]) {
    return {
      ...base,
      workId: entry.workId,
      matchStatus: "manual",
      matchMethod: "workId",
      matchConfidence: 1
    };
  }

  const externalCandidates = uniqueCandidates([
    ...candidateFromExternalId(catalog, "imdb", entry.imdbId, 0.98),
    ...candidateFromExternalId(catalog, "douban", entry.doubanSubjectId, 0.98)
  ]);

  if (externalCandidates.length === 1) {
    const candidate = externalCandidates[0];
    return {
      ...base,
      workId: candidate.workId,
      matchStatus: "matched",
      matchMethod: candidate.method,
      matchConfidence: candidate.confidence
    };
  }

  if (externalCandidates.length > 1) {
    return {
      ...base,
      matchStatus: "ambiguous",
      candidates: externalCandidates
    };
  }

  const titleYearCandidates = uniqueCandidates(
    (catalog.titleYearIndex[titleYearKey(entry.title, entry.year) ?? ""] ?? [])
      .map((workId) => candidateFromWork(catalog, workId, "title_year", 0.72))
      .filter((candidate): candidate is TspdtRankingCandidate => Boolean(candidate))
  );

  if (titleYearCandidates.length === 1) {
    const candidate = titleYearCandidates[0];
    return {
      ...base,
      workId: candidate.workId,
      matchStatus: "matched",
      matchMethod: "title_year",
      matchConfidence: candidate.confidence
    };
  }

  if (titleYearCandidates.length > 1) {
    return {
      ...base,
      matchStatus: "ambiguous",
      candidates: titleYearCandidates
    };
  }

  return {
    ...base,
    matchStatus: "unmatched"
  };
}

function candidateFromExternalId(
  catalog: MovieCatalogState,
  source: "imdb" | "douban",
  id: string | undefined,
  confidence: number
) {
  const normalizedId = source === "imdb" ? id?.toLowerCase() : id;
  const workId = normalizedId ? catalog.externalIdIndex[source]?.[normalizedId] : undefined;
  const candidate = workId ? candidateFromWork(catalog, workId, source, confidence) : undefined;
  return candidate ? [candidate] : [];
}

function candidateFromWork(
  catalog: MovieCatalogState,
  workId: string,
  method: TspdtRankingCandidate["method"],
  confidence: number
): TspdtRankingCandidate | undefined {
  const entry = catalog.works[workId];
  if (!entry) {
    return undefined;
  }

  return {
    workId,
    method,
    confidence,
    title: displayTitle(entry),
    year: entry.work.release?.year
  };
}

function displayTitle(entry: MovieCatalogEntry) {
  return entry.work.display?.title ?? entry.work.titles[0]?.title;
}

function titleYearKey(title?: string, year?: string) {
  const normalizedTitle = normalizeTitle(title);
  const normalizedYear = year?.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  return normalizedTitle && normalizedYear ? `${normalizedTitle}|${normalizedYear}` : undefined;
}

function normalizeTitle(value?: string) {
  return value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueCandidates(candidates: TspdtRankingCandidate[]) {
  const seen = new Set<string>();
  const result: TspdtRankingCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.workId)) {
      continue;
    }
    seen.add(candidate.workId);
    result.push(candidate);
  }
  return result;
}

function cleanExternalIds(externalIds: { imdb?: string; douban?: string }) {
  const cleaned = Object.fromEntries(
    Object.entries(externalIds).filter(([, value]) => Boolean(value))
  ) as { imdb?: string; douban?: string };
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
