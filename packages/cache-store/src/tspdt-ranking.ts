import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  MovieCatalogEntry,
  MovieCatalogState,
  SearchResult,
  TspdtRankingCandidate,
  TspdtRankingEntry,
  TspdtRankingState
} from "@wwpdw/shared";
import type { CacheBackend } from "./types.js";

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

export interface TspdtBrowseEntry {
  rank: number;
  result: SearchResult;
}

export interface TspdtBrowseState {
  schemaVersion: 1;
  generatedAt: string;
  edition: string;
  sourceUrl: string;
  entries: TspdtBrowseEntry[];
  rankingSummary: TspdtRankingState["summary"];
}

export interface TspdtBrowseStore {
  readonly backend: CacheBackend;
  readonly description: string;
  getState(): Promise<TspdtBrowseState | undefined>;
  replaceState(state: TspdtBrowseState): Promise<void>;
}

interface AzureTspdtBrowseConfig {
  accountName: string;
  connectionString?: string;
  tableName: string;
}

type PayloadEntity = {
  partitionKey: string;
  rowKey: string;
  generatedAt?: string;
  edition?: string;
  chunkCount?: number;
  chunkIndex?: number;
  payload?: string;
  payloadChunks?: number;
  [key: string]: unknown;
};

const defaultAccountName = "stwwcachee9219db7";
const defaultTspdtBrowseTableName = "tspdtbrowse";
const tspdtBrowsePartitionKey = "state";
const tspdtBrowseRowKey = "current";
const payloadChunkChars = 30_000;

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

export class LocalTspdtBrowseStore implements TspdtBrowseStore {
  readonly backend = "local" as const;
  readonly description: string;

  constructor(private readonly statePath: string) {
    this.description = `local:${statePath}`;
  }

  async getState() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as TspdtBrowseState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async replaceState(state: TspdtBrowseState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }
}

export class AzureTspdtBrowseStore implements TspdtBrowseStore {
  readonly backend = "azure" as const;
  readonly description: string;

  private readonly config = readAzureTspdtBrowseConfig();
  private readonly tableClient: TableClient;
  private readonly credential = new DefaultAzureCredential();
  private ready?: Promise<void>;
  private stateCache?: { expiresAt: number; state: TspdtBrowseState };

  constructor() {
    this.tableClient = this.config.connectionString
      ? TableClient.fromConnectionString(this.config.connectionString, this.config.tableName)
      : new TableClient(
        `https://${this.config.accountName}.table.core.windows.net`,
        this.config.tableName,
        this.credential
      );
    this.description = `azure:${this.config.accountName}/${this.config.tableName}`;
  }

  async getState() {
    await this.ensureReady();
    const now = Date.now();
    if (this.stateCache && this.stateCache.expiresAt > now) {
      return cloneState(this.stateCache.state);
    }

    try {
      const manifest = await this.tableClient.getEntity<PayloadEntity>(tspdtBrowsePartitionKey, tspdtBrowseRowKey);
      const state = await this.readStateFromManifest(manifest);
      this.stateCache = {
        expiresAt: now + Math.max(0, Number(process.env.TSPDT_BROWSE_CACHE_TTL_SECONDS ?? 300)) * 1000,
        state: cloneState(state)
      };
      return state;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async replaceState(state: TspdtBrowseState) {
    await this.ensureReady();
    this.stateCache = undefined;
    const chunks = splitPayload(serialize(state));

    await Promise.all(chunks.map((chunk, index) => this.tableClient.upsertEntity<PayloadEntity>(
      {
        partitionKey: tspdtBrowsePartitionKey,
        rowKey: chunkRowKey(index),
        chunkIndex: index,
        payload: chunk
      },
      "Replace"
    )));

    await this.tableClient.upsertEntity<PayloadEntity>(
      {
        partitionKey: tspdtBrowsePartitionKey,
        rowKey: tspdtBrowseRowKey,
        generatedAt: state.generatedAt,
        edition: state.edition,
        chunkCount: chunks.length
      },
      "Replace"
    );
  }

  private async ensureReady() {
    this.ready ??= this.createTableIfMissing();
    await this.ready;
  }

  private async createTableIfMissing() {
    try {
      await this.tableClient.createTable();
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }
    }
  }

  private async readStateFromManifest(manifest: PayloadEntity) {
    if (typeof manifest.payload === "string") {
      return deserialize<TspdtBrowseState>(manifest);
    }

    const chunkCount = typeof manifest.chunkCount === "number" ? manifest.chunkCount : 0;
    if (chunkCount <= 0) {
      throw new Error("TSPDT browse state manifest has no payload chunks.");
    }

    const chunks: string[] = [];
    for (let index = 0; index < chunkCount; index += 1) {
      const entity = await this.tableClient.getEntity<PayloadEntity>(tspdtBrowsePartitionKey, chunkRowKey(index));
      if (typeof entity.payload !== "string") {
        throw new Error(`TSPDT browse state chunk is missing: ${index}`);
      }
      chunks.push(entity.payload);
    }

    return JSON.parse(chunks.join("")) as TspdtBrowseState;
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

export function buildTspdtBrowseState(
  ranking: TspdtRankingState,
  catalog: MovieCatalogState,
  results: SearchResult[]
): TspdtBrowseState {
  const resultByAssetKey = new Map(results.map((result) => [result.assetKey, result]));
  const entries: TspdtBrowseEntry[] = [];

  for (const rankingEntry of ranking.entries) {
    if (!rankingEntry.workId) {
      continue;
    }
    const catalogEntry = catalog.works[rankingEntry.workId];
    const result = preferredResultForCatalogEntry(catalogEntry, resultByAssetKey);
    if (result) {
      entries.push({
        rank: rankingEntry.rank,
        result
      });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    edition: ranking.edition,
    sourceUrl: ranking.sourceUrl,
    entries,
    rankingSummary: ranking.summary
  };
}

function preferredResultForCatalogEntry(
  catalogEntry: MovieCatalogEntry | undefined,
  resultByAssetKey: Map<string, SearchResult>
) {
  if (!catalogEntry) {
    return undefined;
  }
  const results = catalogEntry.assetKeys
    .map((assetKey) => resultByAssetKey.get(assetKey))
    .filter((result): result is SearchResult => Boolean(result));
  return results.find((result) => (result.variants?.length ?? 0) > 0) ?? results[0];
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

function readAzureTspdtBrowseConfig(): AzureTspdtBrowseConfig {
  return {
    accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName,
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    tableName: process.env.AZURE_STORAGE_TSPDT_BROWSE_TABLE ?? defaultTspdtBrowseTableName
  };
}

function serialize<T>(payload: T) {
  return JSON.stringify(payload);
}

function splitPayload(payload: string) {
  return payload.match(new RegExp(`[\\s\\S]{1,${payloadChunkChars}}`, "g")) ?? [""];
}

function chunkRowKey(index: number) {
  return `${tspdtBrowseRowKey}:chunk:${String(index).padStart(4, "0")}`;
}

function payloadFromEntity(entity: PayloadEntity) {
  const firstChunk = entity.payload;
  if (typeof firstChunk !== "string") {
    throw new Error("TSPDT browse state payload is missing.");
  }

  const chunkCount = typeof entity.payloadChunks === "number" ? entity.payloadChunks : 1;
  if (chunkCount <= 1) {
    return firstChunk;
  }

  const chunks = [firstChunk];
  for (let index = 1; index < chunkCount; index += 1) {
    const propertyName = `payload${String(index).padStart(2, "0")}`;
    const chunk = entity[propertyName];
    if (typeof chunk !== "string") {
      throw new Error(`TSPDT browse state payload chunk is missing: ${propertyName}`);
    }
    chunks.push(chunk);
  }

  return chunks.join("");
}

function deserialize<T>(entity: PayloadEntity) {
  return JSON.parse(payloadFromEntity(entity)) as T;
}

function isConflict(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 409;
}

function isNotFound(error: unknown) {
  const statusCode = (error as { statusCode?: number }).statusCode;
  const code = (error as { code?: string }).code;
  return statusCode === 404 || code === "ResourceNotFound";
}

function cloneState(state: TspdtBrowseState) {
  return JSON.parse(JSON.stringify(state)) as TspdtBrowseState;
}
