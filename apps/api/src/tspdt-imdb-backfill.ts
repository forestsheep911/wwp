import "dotenv/config";
import { createWriteStream } from "node:fs";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import {
  tspdtEdition,
  tspdtSourceUrl,
  tspdtTop1000,
  type TspdtEntry
} from "../../web/src/cinema/tspdt";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const imdbDataDir = path.join(repoRoot, ".local-data", "imdb");
const outputPath = path.join(repoRoot, ".local-data", `tspdt-id-map-${tspdtEdition}.json`);
const reportPath = path.join(repoRoot, ".local-data", `tspdt-id-map-${tspdtEdition}-report.json`);

const imdbDatasetUrls = {
  akas: "https://datasets.imdbws.com/title.akas.tsv.gz",
  basics: "https://datasets.imdbws.com/title.basics.tsv.gz",
  crew: "https://datasets.imdbws.com/title.crew.tsv.gz",
  names: "https://datasets.imdbws.com/name.basics.tsv.gz"
};

const candidateTitleTypes = new Set([
  "movie",
  "short",
  "tvMovie",
  "video",
  "tvMiniSeries",
  "tvSeries",
  "tvSpecial",
  "tvShort"
]);

interface Candidate {
  rank: number;
  tconst: string;
  title: string;
  originalTitle?: string;
  year: string;
  titleType: string;
  directors: string[];
  directorNames: string[];
}

interface MatchResult {
  rank: number;
  status: "matched" | "ambiguous" | "unmatched";
  imdb?: string;
  confidence?: number;
  source: "imdb-dataset" | "omdb" | "manual-override";
  matchedTitle?: string;
  matchedYear?: string;
  directorNames?: string[];
  candidates?: Array<{
    imdb: string;
    title: string;
    originalTitle?: string;
    year: string;
    titleType: string;
    directorNames: string[];
    confidence: number;
    reason: string;
  }>;
}

interface TspdtIdMapState {
  schemaVersion: 1;
  generatedAt: string;
  edition: string;
  sourceUrl: string;
  imdbDatasetUrls: typeof imdbDatasetUrls;
  entries: Record<string, MatchResult>;
  summary: {
    total: number;
    matched: number;
    ambiguous: number;
    unmatched: number;
  };
}

const manualOverrides: Record<number, {
  imdb: string;
  matchedTitle: string;
  matchedYear?: string;
  directorNames?: string[];
}> = {
  126: { imdb: "tt0028445", matchedTitle: "A Day in the Country", matchedYear: "1936", directorNames: ["Jean Renoir"] },
  153: { imdb: "tt0076263", matchedTitle: "Killer of Sheep", matchedYear: "1978", directorNames: ["Charles Burnett"] },
  154: { imdb: "tt0020530", matchedTitle: "Un chien andalou", matchedYear: "1929", directorNames: ["Luis Bunuel"] },
  273: { imdb: "tt0048434", matchedTitle: "Night and Fog", matchedYear: "1956", directorNames: ["Alain Resnais"] },
  325: { imdb: "tt0058604", matchedTitle: "I Am Cuba", matchedYear: "1964", directorNames: ["Mikhail Kalatozov"] },
  335: { imdb: "tt0080196", matchedTitle: "Berlin Alexanderplatz", matchedYear: "1980", directorNames: ["Rainer Werner Fassbinder"] },
  358: { imdb: "tt0050634", matchedTitle: "The Cranes Are Flying", matchedYear: "1957", directorNames: ["Mikhail Kalatozov"] },
  404: { imdb: "tt0032455", matchedTitle: "Fantasia", matchedYear: "1940", directorNames: ["James Algar", "Samuel Armstrong", "Ford Beebe Jr."] },
  514: { imdb: "tt4093826", matchedTitle: "Twin Peaks", matchedYear: "2017", directorNames: ["David Lynch"] },
  558: { imdb: "tt0040525", matchedTitle: "The Lady from Shanghai", matchedYear: "1947", directorNames: ["Orson Welles"] },
  613: { imdb: "tt0053270", matchedTitle: "Shadows", matchedYear: "1958", directorNames: ["John Cassavetes"] },
  614: { imdb: "tt0074462", matchedTitle: "Edvard Munch", matchedYear: "1974", directorNames: ["Peter Watkins"] },
  621: { imdb: "tt0079986", matchedTitle: "The Tale of Tales", matchedYear: "1979", directorNames: ["Yuri Norstein"] },
  636: { imdb: "tt0046521", matchedTitle: "I Vitelloni", matchedYear: "1953", directorNames: ["Federico Fellini"] },
  652: { imdb: "tt0051983", matchedTitle: "Nazarin", matchedYear: "1959", directorNames: ["Luis Bunuel"] },
  753: { imdb: "tt0095468", matchedTitle: "A Short Film About Killing", matchedYear: "1988", directorNames: ["Krzysztof Kieslowski"] },
  757: { imdb: "tt0052295", matchedTitle: "The Tiger of Eschnapur", matchedYear: "1959", directorNames: ["Fritz Lang"] },
  760: { imdb: "tt0075915", matchedTitle: "One Way or Another", matchedYear: "1975", directorNames: ["Sara Gomez"] },
  769: { imdb: "tt0196499", matchedTitle: "Diaries Notes and Sketches", matchedYear: "1968", directorNames: ["Jonas Mekas"] },
  807: { imdb: "tt0043084", matchedTitle: "Un chant d'amour", matchedYear: "1950", directorNames: ["Jean Genet"] },
  824: { imdb: "tt0063462", matchedTitle: "The Producers", matchedYear: "1967", directorNames: ["Mel Brooks"] },
  890: { imdb: "tt0097270", matchedTitle: "Elephant", matchedYear: "1989", directorNames: ["Alan Clarke"] },
  897: { imdb: "tt0093206", matchedTitle: "Red Sorghum", matchedYear: "1988", directorNames: ["Yimou Zhang"] },
  898: { imdb: "tt0037077", matchedTitle: "The Miracle of Morgan's Creek", matchedYear: "1943", directorNames: ["Preston Sturges"] },
  925: { imdb: "tt0087400", matchedTitle: "Heimat: A Chronicle of Germany", matchedYear: "1984", directorNames: ["Edgar Reitz"] },
  968: { imdb: "tt0077159", matchedTitle: "Ill-Fated Love", matchedYear: "1978", directorNames: ["Manoel de Oliveira"] }
};

interface CliOptions {
  limit?: number;
  refresh: boolean;
}

function parseArgs(args: string[]) {
  const options: CliOptions = { refresh: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      options.limit = Number(args[++index]);
    } else if (arg === "--refresh") {
      options.refresh = true;
    }
  }

  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive number.");
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = options.limit ? tspdtTop1000.slice(0, Math.floor(options.limit)) : tspdtTop1000;
  await mkdir(imdbDataDir, { recursive: true });
  await Promise.all([
    downloadDataset("akas", options.refresh),
    downloadDataset("basics", options.refresh),
    downloadDataset("crew", options.refresh),
    downloadDataset("names", options.refresh)
  ]);

  const targets = buildTargets(entries);
  const candidates = await collectTitleCandidates(targets);
  await collectAkaCandidates(targets, candidates);
  await attachCrew(candidates);
  await attachDirectorNames(candidates);
  const results = matchEntries(entries, candidates, targets);
  await applyOmdbFallback(entries, results, targets);
  applyManualOverrides(results);
  const state = buildIdMapState(results);
  const report = buildReport(entries, results);

  await writeJson(outputPath, state);
  await writeJson(reportPath, report);

  console.log(JSON.stringify({
    status: "ok",
    outputPath,
    reportPath,
    ...state.summary
  }, null, 2));
}

async function downloadDataset(name: keyof typeof imdbDatasetUrls, refresh: boolean) {
  const destination = path.join(imdbDataDir, `${name}.tsv.gz`);
  if (!refresh && await existsWithSize(destination)) {
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  const tempPath = `${destination}.${process.pid}.tmp`;
  await new Promise<void>((resolve, reject) => {
    const request = https.get(imdbDatasetUrls[name], (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        https.get(response.headers.location, (redirectResponse) => {
          pipeDownload(redirectResponse, tempPath, resolve, reject);
        }).on("error", reject);
        return;
      }
      pipeDownload(response, tempPath, resolve, reject);
    });

    request.on("error", reject);
  });
  await rename(tempPath, destination);
}

function pipeDownload(
  response: NodeJS.ReadableStream & { statusCode?: number },
  tempPath: string,
  resolve: () => void,
  reject: (error: Error) => void
) {
  if (response.statusCode && response.statusCode >= 400) {
    reject(new Error(`IMDb dataset download failed with HTTP ${response.statusCode}.`));
    return;
  }

  const output = createWriteStream(tempPath);
  response.pipe(output);
  output.on("finish", () => output.close(() => resolve()));
  output.on("error", reject);
}

async function existsWithSize(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.size > 0;
  } catch {
    return false;
  }
}

function buildTargets(entries: TspdtEntry[]) {
  const byTitleYear = new Map<string, TspdtEntry[]>();
  const byTitle = new Map<string, TspdtEntry[]>();
  const byRank = new Map<number, TspdtEntry>();
  const directorKeys = new Map<number, string[]>();

  for (const entry of entries) {
    byRank.set(entry.rank, entry);
    const years = entryYears(entry.year);
    for (const key of titleKeys(entry.title)) {
      byTitle.set(key, [...(byTitle.get(key) ?? []), entry]);
      for (const year of years) {
        const titleYear = `${key}|${year}`;
        byTitleYear.set(titleYear, [...(byTitleYear.get(titleYear) ?? []), entry]);
      }
    }
    directorKeys.set(entry.rank, directorNameKeys(entry.director));
  }

  return { byTitle, byTitleYear, byRank, directorKeys };
}

async function collectTitleCandidates(targets: ReturnType<typeof buildTargets>) {
  const candidates = new Map<string, Candidate>();
  let isHeader = true;

  for await (const columns of readGzipTsv(datasetPath("basics"))) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const [tconst, titleType, primaryTitle, originalTitle, isAdult, startYear] = columns;
    if (!tconst || isAdult === "1" || !startYear || startYear === "\\N") {
      continue;
    }
    if (!candidateTitleTypes.has(titleType)) {
      continue;
    }

    const keys = new Set([
      ...titleKeys(primaryTitle),
      ...titleKeys(originalTitle)
    ]);

    for (const key of keys) {
      const entries = targets.byTitleYear.get(`${key}|${startYear}`);
      if (!entries?.length) {
        continue;
      }
      for (const entry of entries) {
        candidates.set(`${entry.rank}|${tconst}`, {
          rank: entry.rank,
          tconst,
          title: primaryTitle,
          originalTitle: originalTitle && originalTitle !== primaryTitle ? originalTitle : undefined,
          year: startYear,
          titleType,
          directors: [],
          directorNames: []
        });
      }
    }
  }

  return candidates;
}

async function collectAkaCandidates(
  targets: ReturnType<typeof buildTargets>,
  candidates: Map<string, Candidate>
) {
  const candidateTconsts = new Set([...candidates.values()].map((candidate) => candidate.tconst));
  const ranksWithCandidates = new Set([...candidates.values()].map((candidate) => candidate.rank));
  const ranksToImprove = new Set([...targets.byRank.keys()].filter((rank) => !ranksWithCandidates.has(rank)));
  for (const candidate of candidates.values()) {
    ranksToImprove.add(candidate.rank);
  }
  if (ranksToImprove.size === 0) {
    return;
  }

  let isHeader = true;
  const akaMatches = new Map<string, Set<number>>();
  for await (const columns of readGzipTsv(datasetPath("akas"))) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const [titleId,, title, region, language, types] = columns;
    if (!titleId || candidateTconsts.has(titleId)) {
      continue;
    }
    if (!usefulAka(region, language, types)) {
      continue;
    }

    for (const key of titleKeys(title)) {
      for (const entry of targets.byTitle.get(key) ?? []) {
        if (!ranksToImprove.has(entry.rank)) {
          continue;
        }
        akaMatches.set(titleId, new Set([...(akaMatches.get(titleId) ?? []), entry.rank]));
      }
    }
  }

  if (akaMatches.size === 0) {
    return;
  }

  await collectBasicsByTconst(akaMatches, candidates);
}

async function collectBasicsByTconst(
  akaMatches: Map<string, Set<number>>,
  candidates: Map<string, Candidate>
) {
  let isHeader = true;
  for await (const columns of readGzipTsv(datasetPath("basics"))) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const [tconst, titleType, primaryTitle, originalTitle, isAdult, startYear] = columns;
    const ranks = akaMatches.get(tconst);
    if (!ranks?.size || !candidateTitleTypes.has(titleType) || isAdult === "1" || !startYear || startYear === "\\N") {
      continue;
    }

    for (const rank of ranks) {
      const entry = tspdtTop1000.find((item) => item.rank === rank);
      if (!entry || !entryYears(entry.year).includes(startYear)) {
        continue;
      }
      candidates.set(`${rank}|${tconst}`, {
        rank,
        tconst,
        title: primaryTitle,
        originalTitle: originalTitle && originalTitle !== primaryTitle ? originalTitle : undefined,
        year: startYear,
        titleType,
        directors: [],
        directorNames: []
      });
    }
  }
}

async function attachCrew(candidates: Map<string, Candidate>) {
  const byTconst = new Map<string, Candidate[]>();
  for (const candidate of candidates.values()) {
    byTconst.set(candidate.tconst, [...(byTconst.get(candidate.tconst) ?? []), candidate]);
  }

  let isHeader = true;
  for await (const columns of readGzipTsv(datasetPath("crew"))) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const [tconst, directors] = columns;
    const matches = byTconst.get(tconst);
    if (!matches?.length) {
      continue;
    }

    const directorIds = directors && directors !== "\\N" ? directors.split(",") : [];
    for (const candidate of matches) {
      candidate.directors = directorIds;
    }
  }
}

async function attachDirectorNames(candidates: Map<string, Candidate>) {
  const needed = new Set<string>();
  for (const candidate of candidates.values()) {
    for (const director of candidate.directors) {
      needed.add(director);
    }
  }

  const names = new Map<string, string>();
  let isHeader = true;
  for await (const columns of readGzipTsv(datasetPath("names"))) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    const [nconst, primaryName] = columns;
    if (needed.has(nconst)) {
      names.set(nconst, primaryName);
      if (names.size === needed.size) {
        break;
      }
    }
  }

  for (const candidate of candidates.values()) {
    candidate.directorNames = candidate.directors
      .map((director) => names.get(director))
      .filter((name): name is string => Boolean(name));
  }
}

function matchEntries(
  entries: TspdtEntry[],
  candidates: Map<string, Candidate>,
  targets: ReturnType<typeof buildTargets>
) {
  const byRank = new Map<number, Candidate[]>();
  for (const candidate of candidates.values()) {
    byRank.set(candidate.rank, [...(byRank.get(candidate.rank) ?? []), candidate]);
  }

  return entries.map((entry): MatchResult => {
    const entryCandidates = uniqueCandidates(byRank.get(entry.rank) ?? [])
      .map((candidate) => scoreCandidate(entry, candidate, targets.directorKeys.get(entry.rank) ?? []))
      .sort((left, right) => right.confidence - left.confidence);
    const strongCandidates = entryCandidates.filter((candidate) => candidate.confidence >= 0.95);

    if (strongCandidates.length === 1) {
      const candidate = strongCandidates[0];
      return {
        rank: entry.rank,
        status: "matched",
        imdb: candidate.imdb,
        confidence: candidate.confidence,
        source: "imdb-dataset",
        matchedTitle: candidate.title,
        matchedYear: candidate.year,
        directorNames: candidate.directorNames
      };
    }

    if (entryCandidates.length === 1 && entryCandidates[0].confidence >= 0.82) {
      const candidate = entryCandidates[0];
      return {
        rank: entry.rank,
        status: "matched",
        imdb: candidate.imdb,
        confidence: candidate.confidence,
        source: "imdb-dataset",
        matchedTitle: candidate.title,
        matchedYear: candidate.year,
        directorNames: candidate.directorNames
      };
    }

    if (entryCandidates.length > 0) {
      return {
        rank: entry.rank,
        status: "ambiguous",
        source: "imdb-dataset",
        candidates: entryCandidates.slice(0, 8)
      };
    }

    return {
      rank: entry.rank,
      status: "unmatched",
      source: "imdb-dataset"
    };
  });
}

function scoreCandidate(entry: TspdtEntry, candidate: Candidate, expectedDirectorKeys: string[]) {
  const candidateDirectorKeys = candidate.directorNames.flatMap((name) => personNameKeys(name));
  const directorOverlap = expectedDirectorKeys.some((key) => candidateDirectorKeys.includes(key));
  const hasDirectorEvidence = candidateDirectorKeys.length > 0 && expectedDirectorKeys.length > 0;
  const confidence = directorOverlap
    ? 0.99
    : hasDirectorEvidence
      ? 0.68
      : 0.82;

  return {
    imdb: candidate.tconst,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    year: candidate.year,
    titleType: candidate.titleType,
    directorNames: candidate.directorNames,
    confidence,
    reason: directorOverlap
      ? "title_year_director"
      : hasDirectorEvidence
        ? "title_year_director_mismatch"
        : "title_year_no_director_data"
  };
}

function entryYears(value: string) {
  const years = [...value.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) => match[1]);
  return years.length > 0 ? uniqueStrings([years[0], ...years]) : [value];
}

function usefulAka(region: string | undefined, language: string | undefined, types: string | undefined) {
  if (types?.includes("working")) {
    return false;
  }
  if (!region || region === "\\N") {
    return true;
  }
  return [
    "US",
    "GB",
    "CA",
    "AU",
    "IN",
    "XWW",
    "XEU",
    "XYU",
    "SUHH",
    "CN",
    "HK",
    "TW",
    "JP",
    "KR",
    "FR",
    "DE",
    "IT",
    "ES",
    "PT",
    "BR",
    "PL",
    "RU"
  ].includes(region) || language === "en";
}

function buildIdMapState(results: MatchResult[]): TspdtIdMapState {
  const entries = Object.fromEntries(results.map((result) => [String(result.rank), result]));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    edition: tspdtEdition,
    sourceUrl: tspdtSourceUrl,
    imdbDatasetUrls,
    entries,
    summary: {
      total: results.length,
      matched: results.filter((result) => result.status === "matched").length,
      ambiguous: results.filter((result) => result.status === "ambiguous").length,
      unmatched: results.filter((result) => result.status === "unmatched").length
    }
  };
}

async function applyOmdbFallback(
  entries: TspdtEntry[],
  results: MatchResult[],
  targets: ReturnType<typeof buildTargets>
) {
  const apiKey = process.env.OMDB_API_KEY?.trim();
  if (!apiKey) {
    return;
  }

  const entryByRank = new Map(entries.map((entry) => [entry.rank, entry]));
  for (const result of results) {
    if (result.status === "matched") {
      continue;
    }

    const entry = entryByRank.get(result.rank);
    if (!entry) {
      continue;
    }

    const omdbMatch = await fetchBestOmdbMatch(entry, targets.directorKeys.get(entry.rank) ?? [], apiKey);
    if (!omdbMatch) {
      continue;
    }

    Object.assign(result, {
      status: "matched",
      imdb: omdbMatch.imdb,
      confidence: omdbMatch.confidence,
      source: "omdb",
      matchedTitle: omdbMatch.title,
      matchedYear: omdbMatch.year,
      directorNames: omdbMatch.directorNames,
      candidates: undefined
    });
  }
}

async function fetchBestOmdbMatch(entry: TspdtEntry, expectedDirectorKeys: string[], apiKey: string) {
  const years = entryYears(entry.year);
  const titles = uniqueStrings([
    deInvertTitle(entry.title),
    entry.title
  ]);
  const candidates: Array<{
    imdb: string;
    title: string;
    year: string;
    directorNames: string[];
    confidence: number;
  }> = [];

  for (const title of titles) {
    for (const year of [...years, undefined]) {
      const payload = await fetchOmdbTitle(title, year, apiKey);
      if (!payload || payload.Response !== "True" || !/^tt\d+$/i.test(payload.imdbID ?? "")) {
        continue;
      }

      const directorNames = splitOmdbNames(payload.Director);
      const score = scoreOmdbPayload(entry, payload, expectedDirectorKeys, directorNames);
      if (score >= 0.78) {
        candidates.push({
          imdb: payload.imdbID,
          title: payload.Title,
          year: payload.Year,
          directorNames,
          confidence: score
        });
      }
    }
  }

  const unique = uniqueBy(candidates, (candidate) => candidate.imdb)
    .sort((left, right) => right.confidence - left.confidence);
  const best = unique[0];
  const second = unique[1];
  if (!best || (second && second.confidence === best.confidence)) {
    return undefined;
  }

  return best;
}

async function fetchOmdbTitle(title: string, year: string | undefined, apiKey: string) {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("t", title);
  if (year) {
    url.searchParams.set("y", year);
  }
  url.searchParams.set("r", "json");

  const response = await fetch(url);
  const payload = await response.json() as Record<string, string>;
  await new Promise((resolve) => setTimeout(resolve, 120));
  return payload;
}

function scoreOmdbPayload(
  entry: TspdtEntry,
  payload: Record<string, string>,
  expectedDirectorKeys: string[],
  directorNames: string[]
) {
  const expectedTitleKeys = titleKeys(entry.title);
  const payloadTitleKeys = titleKeys(cleanOmdbTitle(payload.Title));
  const titleMatch = expectedTitleKeys.some((key) => payloadTitleKeys.includes(key));
  const years = entryYears(entry.year);
  const yearMatch = years.some((year) => payload.Year?.includes(year));
  const candidateDirectorKeys = directorNames.flatMap((name) => personNameKeys(name));
  const directorMatch = expectedDirectorKeys.some((key) => candidateDirectorKeys.includes(key));

  let score = 0;
  if (titleMatch) score += 0.5;
  if (yearMatch) score += 0.3;
  if (directorMatch) score += 0.4;
  if (!directorNames.length) score -= 0.08;
  if (payload.Type === "episode") score -= 0.25;
  return Math.min(0.99, score);
}

function cleanOmdbTitle(value?: string) {
  return value?.replace(/\s*\((?:19|20)\d{2}\)\s*$/u, "");
}

function splitOmdbNames(value?: string) {
  if (!value || value === "N/A") {
    return [];
  }
  return value.split(/\s*,\s*/).filter(Boolean);
}

function applyManualOverrides(results: MatchResult[]) {
  for (const result of results) {
    const override = manualOverrides[result.rank];
    if (!override) {
      continue;
    }

    Object.assign(result, {
      status: "matched",
      imdb: override.imdb,
      confidence: 1,
      source: "manual-override",
      matchedTitle: override.matchedTitle,
      matchedYear: override.matchedYear,
      directorNames: override.directorNames,
      candidates: undefined
    });
  }
}

function buildReport(entries: TspdtEntry[], results: MatchResult[]) {
  const entriesByRank = new Map(entries.map((entry) => [entry.rank, entry]));
  return {
    generatedAt: new Date().toISOString(),
    edition: tspdtEdition,
    summary: {
      total: results.length,
      matched: results.filter((result) => result.status === "matched").length,
      ambiguous: results.filter((result) => result.status === "ambiguous").length,
      unmatched: results.filter((result) => result.status === "unmatched").length
    },
    ambiguous: results
      .filter((result) => result.status === "ambiguous")
      .map((result) => ({
        tspdt: entriesByRank.get(result.rank),
        candidates: result.candidates
      })),
    unmatched: results
      .filter((result) => result.status === "unmatched")
      .map((result) => entriesByRank.get(result.rank))
  };
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function* readGzipTsv(filePath: string) {
  const stream = createReadStream(filePath).pipe(createGunzip());
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    yield line.split("\t");
  }
}

function datasetPath(name: keyof typeof imdbDatasetUrls) {
  return path.join(imdbDataDir, `${name}.tsv.gz`);
}

function uniqueCandidates(candidates: Candidate[]) {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.rank}|${candidate.tconst}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function uniqueBy<T>(values: T[], keyForValue: (value: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyForValue(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function titleKeys(value?: string) {
  if (!value || value === "\\N") {
    return [];
  }

  const deInverted = deInvertTitle(value);
  const normalized = normalizeTitle(value);
  const normalizedDeInverted = normalizeTitle(deInverted);
  return uniqueStrings([
    normalized,
    normalizedDeInverted,
    stripLeadingArticle(normalized),
    stripLeadingArticle(normalizedDeInverted)
  ]);
}

function deInvertTitle(value: string) {
  const match = value.match(/^(.+),\s*(the|a|an|l'|la|le|les|el|los|las|il|lo|der|die|das)$/iu);
  return match ? `${match[2]} ${match[1]}` : value;
}

function directorNameKeys(value?: string) {
  if (!value) {
    return [];
  }

  return uniqueStrings(value
    .split(/\s*[/;&]\s*/)
    .flatMap((name) => [
      normalizePersonName(name),
      normalizePersonName(deInvertPersonName(name)),
      compactPersonName(name),
      compactPersonName(deInvertPersonName(name)),
      sortedPersonName(name),
      sortedPersonName(deInvertPersonName(name)),
      surnameKey(name),
      surnameKey(deInvertPersonName(name))
    ]));
}

function personNameKeys(value?: string) {
  return uniqueStrings([
    normalizePersonName(value),
    compactPersonName(value),
    sortedPersonName(value),
    surnameKey(value)
  ]);
}

function deInvertPersonName(value: string) {
  const match = value.match(/^([^,]+),\s*(.+)$/u);
  return match ? `${match[2]} ${match[1]}` : value;
}

function normalizeTitle(value?: string) {
  return value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/½/g, "1/2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePersonName(value?: string) {
  return value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactPersonName(value?: string) {
  return normalizePersonName(value)?.replace(/\s+/g, "");
}

function sortedPersonName(value?: string) {
  const normalized = normalizePersonName(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.split(" ").filter(Boolean).sort().join(" ");
}

function surnameKey(value?: string) {
  const normalized = normalizePersonName(value);
  if (!normalized) {
    return undefined;
  }
  const parts = normalized.split(" ").filter(Boolean);
  return parts.at(-1);
}

function stripLeadingArticle(value?: string) {
  return value?.replace(/^(?:the|a|an|l|la|le|les|el|los|las|il|lo|der|die|das)\s+/u, "");
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
