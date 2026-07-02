import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MovieCatalogEntry,
  MovieCatalogIssue,
  MovieCatalogState,
  MovieCreditEntry,
  MovieExternalIds,
  MovieMetadataSource,
  MovieRatingEntry,
  MovieSourceRef,
  MovieTitleEntry,
  MovieWorkKind,
  MovieWorkProfile,
  SearchResult
} from "@wwpdw/shared";

export interface MovieCatalogBuildOptions {
  sourcePath?: string;
  sourceKind?: NonNullable<MovieCatalogState["source"]>["kind"];
}

export interface MovieCatalogBuildSummary {
  entryCount: number;
  workCount: number;
  issueCount: number;
  externalIdCount: number;
}

export interface MovieCatalogStore {
  readonly description: string;
  getState(): Promise<MovieCatalogState>;
  replaceState(state: MovieCatalogState): Promise<void>;
}

export class LocalMovieCatalogStore implements MovieCatalogStore {
  readonly description: string;

  constructor(private readonly statePath: string) {
    this.description = `local:${statePath}`;
  }

  async getState() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as MovieCatalogState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return emptyMovieCatalogState();
      }
      throw error;
    }
  }

  async replaceState(state: MovieCatalogState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }
}

export function emptyMovieCatalogState(): MovieCatalogState {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    works: {},
    externalIdIndex: {},
    titleYearIndex: {},
    issues: []
  };
}

export function buildMovieCatalogFromResults(
  results: SearchResult[],
  options: MovieCatalogBuildOptions = {}
) {
  const state: MovieCatalogState = {
    ...emptyMovieCatalogState(),
    source: {
      kind: options.sourceKind ?? "search-index",
      path: options.sourcePath,
      entryCount: results.length
    }
  };

  for (const result of results) {
    const work = workFromResult(result);
    const canonicalWorkId = canonicalWorkIdForWork(state, work);
    const existing = state.works[canonicalWorkId];
    const entry = existing
      ? mergeCatalogEntry(existing, work, result)
      : catalogEntryFromWork(work, result);

    if (work.workId !== canonicalWorkId) {
      entry.mergedWorkIds = uniqueStrings([...(entry.mergedWorkIds ?? []), work.workId]);
      entry.work.workId = canonicalWorkId;
    }

    state.works[canonicalWorkId] = entry;
    indexExternalIds(state, canonicalWorkId, entry.work.externalIds);
  }

  rebuildTitleYearIndex(state);
  state.issues.push(...titleYearCandidateIssues(state));

  return {
    state,
    summary: summarizeMovieCatalog(state, results.length)
  };
}

export function summarizeMovieCatalog(state: MovieCatalogState, entryCount?: number): MovieCatalogBuildSummary {
  return {
    entryCount: entryCount ?? state.source?.entryCount ?? 0,
    workCount: Object.keys(state.works).length,
    issueCount: state.issues.length,
    externalIdCount: Object.values(state.externalIdIndex)
      .reduce((count, ids) => count + Object.keys(ids).length, 0)
  };
}

function canonicalWorkIdForWork(state: MovieCatalogState, work: MovieWorkProfile) {
  const externalMatches = externalIdKeys(work.externalIds)
    .map(({ source, id }) => state.externalIdIndex[source]?.[id])
    .filter((value): value is string => Boolean(value));
  const uniqueMatches = uniqueStrings(externalMatches);

  if (uniqueMatches.length > 1) {
    state.issues.push({
      kind: "external_id_conflict",
      message: "Multiple existing works share external ids with this incoming work.",
      workIds: uniqueMatches,
      externalId: externalIdKeys(work.externalIds)[0]
    });
  }

  return uniqueMatches[0] ?? work.workId;
}

function catalogEntryFromWork(work: MovieWorkProfile, result: SearchResult): MovieCatalogEntry {
  return {
    work,
    assetKeys: [result.assetKey],
    sourcePageIds: uniqueStrings([result.sourcePageId]),
    sourceTitles: uniqueStrings([result.title]),
    updatedAt: work.updatedAt
  };
}

function mergeCatalogEntry(entry: MovieCatalogEntry, incoming: MovieWorkProfile, result: SearchResult): MovieCatalogEntry {
  const work = entry.work;
  const updatedAt = latestIso(work.updatedAt, incoming.updatedAt);

  return {
    ...entry,
    work: {
      ...work,
      kind: preferKnownKind(work.kind, incoming.kind),
      titles: uniqueByKey([...(work.titles ?? []), ...(incoming.titles ?? [])], titleKey),
      release: {
        ...incoming.release,
        ...work.release,
        year: work.release?.year ?? incoming.release?.year,
        date: work.release?.date ?? incoming.release?.date
      },
      externalIds: mergeExternalIds(work.externalIds, incoming.externalIds),
      genres: uniqueStrings([...(work.genres ?? []), ...(incoming.genres ?? [])]),
      countries: uniqueStrings([...(work.countries ?? []), ...(incoming.countries ?? [])]),
      credits: uniqueByKey([...(work.credits ?? []), ...(incoming.credits ?? [])], creditKey),
      ratings: uniqueByKey([...(work.ratings ?? []), ...(incoming.ratings ?? [])], ratingKey),
      media: {
        ...incoming.media,
        ...work.media,
        posters: uniqueByKey([
          ...(work.media?.posters ?? []),
          ...(incoming.media?.posters ?? [])
        ], (poster) => poster.url)
      },
      sourceRefs: uniqueByKey([...(work.sourceRefs ?? []), ...(incoming.sourceRefs ?? [])], sourceRefKey),
      dataQuality: work.dataQuality ?? incoming.dataQuality,
      display: {
        ...incoming.display,
        ...work.display
      },
      updatedAt
    },
    assetKeys: uniqueStrings([...entry.assetKeys, result.assetKey]),
    sourcePageIds: uniqueStrings([...(entry.sourcePageIds ?? []), result.sourcePageId]),
    sourceTitles: uniqueStrings([...(entry.sourceTitles ?? []), result.title]),
    updatedAt
  };
}

function workFromResult(result: SearchResult): MovieWorkProfile {
  const metadata = result.metadata;
  const source = sourceFromResult(result);
  const year = firstString([
    metadata?.work?.release?.year,
    metadata?.release?.year,
    metadata?.year,
    metadata?.releaseDate?.match(/\b(\d{4})\b/)?.[1]
  ]);
  const workId = firstString([
    metadata?.work?.workId,
    metadata?.workId,
    stableFallbackWorkId(result)
  ]) as string;
  const externalIds = mergeExternalIds(
    metadata?.work?.externalIds,
    metadata?.externalIds,
    metadata?.imdbId ? { imdb: metadata.imdbId } : undefined,
    metadata?.external?.omdb?.imdbId ? { imdb: metadata.external.omdb.imdbId } : undefined
  );
  const titles = uniqueByKey([
    ...(metadata?.work?.titles ?? []),
    ...(metadata?.titles ?? []),
    titleEntry(result.title, "primary", source),
    titleEntry(metadata?.display?.title, "primary", source),
    titleEntry(metadata?.work?.display?.title, "primary", source),
    titleEntry(metadata?.external?.omdb?.title, "alternate", "omdb")
  ].filter((value): value is MovieTitleEntry => Boolean(value)), titleKey);
  const credits = uniqueByKey([
    ...(metadata?.work?.credits ?? []),
    ...(metadata?.credits ?? []),
    ...legacyCredits(metadata?.directors, metadata?.people, source),
    ...legacyCredits(metadata?.external?.omdb?.directors, metadata?.external?.omdb?.actors, "omdb")
  ], creditKey);
  const ratings = uniqueByKey([
    ...(metadata?.work?.ratings ?? []),
    ...(metadata?.ratings ?? []).map((rating) => ({ ...rating, source })),
    ...(metadata?.external?.omdb?.ratings ?? []).map((rating) => ({ ...rating, source: "omdb" as const }))
  ], ratingKey);
  const sourceRefs = uniqueByKey([
    ...(metadata?.work?.sourceRefs ?? []),
    ...(metadata?.sourceRefs ?? []),
    {
      source,
      id: result.sourcePageId,
      url: result.sourceUrl,
      title: result.title,
      observedAt: result.updatedAt
    }
  ], sourceRefKey);

  return {
    workId,
    kind: metadata?.work?.kind ?? metadata?.kind ?? kindFromType(metadata?.type),
    titles,
    release: {
      ...metadata?.work?.release,
      ...metadata?.release,
      year,
      date: metadata?.work?.release?.date ?? metadata?.release?.date ?? metadata?.releaseDate,
      source
    },
    externalIds,
    genres: uniqueStrings([...(metadata?.work?.genres ?? []), ...(metadata?.genres ?? [])]),
    countries: metadata?.work?.countries,
    credits,
    ratings,
    media: {
      ...metadata?.work?.media,
      posters: uniqueByKey([
        ...(metadata?.work?.media?.posters ?? []),
        ...(metadata?.posters ?? [])
      ], (poster) => poster.url)
    },
    sourceRefs,
    dataQuality: metadata?.work?.dataQuality ?? metadata?.dataQuality,
    display: {
      title: metadata?.work?.display?.title ?? metadata?.display?.title ?? result.title,
      subtitle: metadata?.work?.display?.subtitle ?? metadata?.display?.subtitle,
      year,
      directorLine: metadata?.work?.display?.directorLine ?? metadata?.display?.directorLine ?? metadata?.directors?.join(" / "),
      castLine: metadata?.work?.display?.castLine ?? metadata?.display?.castLine ?? metadata?.people?.join(" / ")
    },
    updatedAt: metadata?.work?.updatedAt ?? result.updatedAt ?? new Date().toISOString()
  };
}

function sourceFromResult(result: SearchResult): MovieMetadataSource {
  return /notion/i.test(result.source) ? "notion" : "search-index";
}

function stableFallbackWorkId(result: SearchResult) {
  const seed = result.sourcePageId
    ? `source-page:${result.sourcePageId}`
    : `asset:${result.assetKey}|title:${result.title}`;
  return `wwm_${createHash("sha256").update(seed).digest("base64url").slice(0, 16)}`;
}

function titleEntry(title: string | undefined, kind: MovieTitleEntry["kind"], source: MovieMetadataSource) {
  return title ? { title, kind, source } : undefined;
}

function legacyCredits(directors: string[] = [], people: string[] = [], source: MovieMetadataSource) {
  const credits: MovieCreditEntry[] = [];
  directors.forEach((name, order) => credits.push({
    name,
    department: "directing",
    job: "Director",
    order,
    source
  }));
  people.forEach((name, order) => credits.push({
    name,
    department: "acting",
    job: "Actor",
    order,
    source
  }));
  return credits;
}

function kindFromType(type?: string): MovieWorkKind {
  const normalized = type?.toLowerCase() ?? "";
  if (/episode|\u96c6/.test(normalized)) return "episode";
  if (/season|\u5b63/.test(normalized)) return "season";
  if (/series|tv|\u5267|\u756a/.test(normalized)) return "series";
  if (/short|\u77ed\u7247/.test(normalized)) return "short";
  if (/special|\u7279\u522b/.test(normalized)) return "special";
  if (/movie|film|\u7535\u5f71/.test(normalized)) return "movie";
  return "unknown";
}

function preferKnownKind(current: MovieWorkKind, incoming: MovieWorkKind) {
  return current === "unknown" ? incoming : current;
}

function mergeExternalIds(...values: Array<MovieExternalIds | undefined>) {
  const merged: MovieExternalIds = {};
  for (const value of values) {
    for (const [source, id] of Object.entries(value ?? {})) {
      if (id && !merged[source]) {
        merged[source] = id;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function indexExternalIds(state: MovieCatalogState, workId: string, externalIds?: MovieExternalIds) {
  for (const { source, id } of externalIdKeys(externalIds)) {
    state.externalIdIndex[source] ??= {};
    const existing = state.externalIdIndex[source][id];
    if (existing && existing !== workId) {
      state.issues.push({
        kind: "external_id_conflict",
        message: "External id is already assigned to another work.",
        workIds: [existing, workId],
        externalId: { source, id }
      });
      continue;
    }
    state.externalIdIndex[source][id] = workId;
  }
}

function externalIdKeys(externalIds?: MovieExternalIds) {
  return Object.entries(externalIds ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([source, id]) => ({ source, id: normalizeExternalId(source, id) }));
}

function normalizeExternalId(source: string, id: string) {
  return source === "imdb" ? id.toLowerCase() : id;
}

function rebuildTitleYearIndex(state: MovieCatalogState) {
  state.titleYearIndex = {};
  for (const [workId, entry] of Object.entries(state.works)) {
    for (const title of entry.work.titles ?? []) {
      const key = titleYearKey(title.title, entry.work.release?.year);
      if (!key) continue;
      state.titleYearIndex[key] ??= [];
      state.titleYearIndex[key].push(workId);
    }
  }

  for (const [key, workIds] of Object.entries(state.titleYearIndex)) {
    state.titleYearIndex[key] = uniqueStrings(workIds);
  }
}

function titleYearCandidateIssues(state: MovieCatalogState) {
  const issues: MovieCatalogIssue[] = [];
  for (const [titleKeyValue, workIds] of Object.entries(state.titleYearIndex)) {
    if (workIds.length < 2) {
      continue;
    }
    issues.push({
      kind: "title_year_candidate",
      message: "Multiple works share the same normalized title and year. Review before merging.",
      workIds,
      titleKey: titleKeyValue
    });
  }
  return issues;
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

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniqueByKey<T>(values: T[], keyForValue: (value: T) => string | undefined) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyForValue(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function firstString(values: Array<string | undefined>) {
  return values.find((value) => value && value.trim().length > 0);
}

function latestIso(left?: string, right?: string) {
  if (!left) return right ?? new Date().toISOString();
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function titleKey(title: MovieTitleEntry) {
  return `${title.kind}:${title.lang ?? ""}:${normalizeTitle(title.title) ?? title.title}`;
}

function creditKey(credit: MovieCreditEntry) {
  return [
    credit.department,
    credit.job,
    normalizeTitle(credit.name),
    normalizeTitle(credit.character)
  ].join(":");
}

function ratingKey(rating: MovieRatingEntry) {
  return `${rating.source ?? rating.label}:${rating.label}`;
}

function sourceRefKey(sourceRef: MovieSourceRef) {
  return `${sourceRef.source}:${sourceRef.id ?? sourceRef.url ?? sourceRef.title ?? ""}`;
}
