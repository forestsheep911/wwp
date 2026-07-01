import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type { MovieMetadata, SearchResult } from "@wwpdw/shared";
import type { CacheBackend } from "./types.js";

export type SearchIndexSyncMode = "full" | "incremental" | "ondemand";
export type SearchIndexSyncStatus = "running" | "succeeded" | "failed";

export interface SearchIndexEntry {
  assetKey: string;
  title: string;
  source: string;
  sourcePageId?: string;
  sourceUpdatedAt: string;
  indexedAt: string;
  searchText: string;
  result: SearchResult;
}

export interface SearchIndexRun {
  id: string;
  mode: SearchIndexSyncMode;
  status: SearchIndexSyncStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  scanned: number;
  saved: number;
  deleted: number;
  failed: number;
  lastSourceUpdatedAt?: string;
  error?: string;
}

export interface SearchIndexStats {
  backend: CacheBackend;
  description: string;
  entryCount: number;
  latestIndexedAt?: string;
  latestSourceUpdatedAt?: string;
  lastFullSyncAt?: string;
  lastIncrementalSyncAt?: string;
  lastRun?: SearchIndexRun;
}

export interface SearchIndexStore {
  readonly backend: CacheBackend;
  readonly description: string;
  getHealth(): Promise<Record<string, unknown>>;
  getStats(): Promise<SearchIndexStats>;
  search(query: string, limit: number): Promise<SearchResult[]>;
  getResult(assetKey: string): Promise<SearchResult | undefined>;
  upsertResult(result: SearchResult, indexedAt?: string): Promise<SearchIndexEntry>;
  upsertResults(results: SearchResult[], indexedAt?: string): Promise<SearchIndexEntry[]>;
  deleteEntriesNotIn(assetKeys: Set<string>): Promise<number>;
  startRun(mode: SearchIndexSyncMode): Promise<SearchIndexRun>;
  updateRun(run: SearchIndexRun): Promise<void>;
  completeRun(run: SearchIndexRun, status: SearchIndexSyncStatus, error?: string): Promise<SearchIndexRun>;
}

interface LocalSearchIndexState {
  entries: Record<string, SearchIndexEntry>;
  runs: Record<string, SearchIndexRun>;
}

interface AzureSearchIndexConfig {
  accountName: string;
  connectionString?: string;
  tableName: string;
}

type PayloadEntity = {
  partitionKey: string;
  rowKey: string;
  assetKey?: string;
  mode?: string;
  status?: string;
  sourceUpdatedAt?: string;
  indexedAt?: string;
  updatedAt?: string;
  payload: string;
};

const defaultAccountName = "stwwcachee9219db7";
const defaultSearchIndexTableName = "movieindex";
const moviePartitionKey = "movie";
const runPartitionKey = "run";
const cjkPattern = /[\u3400-\u9fff]/;
const searchIndexEntryCacheTtlMs = Math.max(
  0,
  Number(process.env.SEARCH_INDEX_ENTRY_CACHE_TTL_SECONDS ?? 300)
) * 1000;

function emptySearchIndexState(): LocalSearchIndexState {
  return {
    entries: {},
    runs: {}
  };
}

function readAzureConfig(): AzureSearchIndexConfig {
  return {
    accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName,
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    tableName: process.env.AZURE_STORAGE_SEARCH_INDEX_TABLE ?? defaultSearchIndexTableName
  };
}

function encodeRowKey(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function serialize<T>(payload: T) {
  return JSON.stringify(payload);
}

function deserialize<T>(entity: Pick<PayloadEntity, "payload">) {
  return JSON.parse(entity.payload) as T;
}

function isConflict(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 409;
}

function isNotFound(error: unknown) {
  const statusCode = (error as { statusCode?: number }).statusCode;
  const code = (error as { code?: string }).code;
  return statusCode === 404 || code === "ResourceNotFound";
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function textMatches(text: string, query: string) {
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  return normalizedText.includes(normalizedQuery) ||
    compactSearchText(normalizedText).includes(compactSearchText(normalizedQuery));
}

function querySegments(query: string) {
  if (!cjkPattern.test(query) || Array.from(query).length < 3) {
    return [];
  }

  const chars = Array.from(query);
  return [...new Set([
    chars.slice(0, 2).join(""),
    chars.slice(-2).join("")
  ].filter((segment) => segment && segment !== query))];
}

function metadataText(metadata?: MovieMetadata) {
  if (!metadata) {
    return [];
  }

  const omdb = metadata.external?.omdb;

  return [
    metadata.type,
    metadata.releaseDate,
    metadata.year,
    metadata.genres?.join(" "),
    metadata.directors?.join(" "),
    metadata.people?.join(" "),
    metadata.ratings?.map((rating) => `${rating.label} ${rating.value}`).join(" "),
    metadata.ratingLevel?.join(" "),
    metadata.info,
    metadata.description,
    metadata.imdbId,
    metadata.externalIds?.imdb,
    metadata.externalIds?.tmdb,
    metadata.externalIds?.douban,
    omdb?.title,
    omdb?.year,
    omdb?.type,
    omdb?.rated,
    omdb?.released,
    omdb?.runtime,
    omdb?.genres?.join(" "),
    omdb?.directors?.join(" "),
    omdb?.writers?.join(" "),
    omdb?.actors?.join(" "),
    omdb?.plot,
    omdb?.languages?.join(" "),
    omdb?.countries?.join(" "),
    omdb?.awards,
    omdb?.ratings?.map((rating) => `${rating.label} ${rating.value}`).join(" "),
    omdb?.metascore,
    omdb?.imdbRating,
    omdb?.imdbVotes,
    omdb?.imdbId,
    omdb?.boxOffice,
    omdb?.production,
    omdb?.totalSeasons,
    omdb?.season,
    omdb?.episode,
    omdb?.seriesId
  ].filter((value): value is string => Boolean(value));
}

function buildSearchText(result: SearchResult) {
  const variantText = result.variants?.flatMap((variant) => [
    variant.assetKey,
    variant.label,
    variant.summary,
    variant.kind,
    variant.sourceBreadcrumb?.join(" ")
  ]) ?? [];

  return [
    result.assetKey,
    result.title,
    result.source,
    result.sourcePageId,
    result.sourceBreadcrumb?.join(" "),
    result.durationLabel,
    result.summary,
    ...metadataText(result.metadata),
    ...variantText
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function cloneResult(result: SearchResult) {
  return JSON.parse(JSON.stringify(result)) as SearchResult;
}

function cloneEntry(entry: SearchIndexEntry) {
  return JSON.parse(JSON.stringify(entry)) as SearchIndexEntry;
}

function cloneRun(run: SearchIndexRun) {
  return JSON.parse(JSON.stringify(run)) as SearchIndexRun;
}

function entryForResult(result: SearchResult, indexedAt = new Date().toISOString()): SearchIndexEntry {
  return {
    assetKey: result.assetKey,
    title: result.title,
    source: result.source,
    sourcePageId: result.sourcePageId,
    sourceUpdatedAt: result.updatedAt,
    indexedAt,
    searchText: buildSearchText(result),
    result: cloneResult(result)
  };
}

function scoreEntry(entry: SearchIndexEntry, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 1;
  }

  const title = entry.title;
  const searchText = entry.searchText;
  let score = 0;

  if (normalizeSearchText(title) === normalizedQuery) {
    score += 250;
  }

  if (textMatches(title, query)) {
    score += 140;
  }

  if (textMatches(searchText, query)) {
    score += 40;
  }

  for (const part of normalizedQuery.split(" ").filter(Boolean)) {
    if (part.length >= 2 && textMatches(title, part)) {
      score += 12;
    } else if (part.length >= 2 && textMatches(searchText, part)) {
      score += 4;
    }
  }

  for (const segment of querySegments(query)) {
    if (textMatches(title, segment)) {
      score += 12;
    } else if (textMatches(searchText, segment)) {
      score += 5;
    }
  }

  return score;
}

function runSortTime(run: SearchIndexRun) {
  return run.completedAt ?? run.updatedAt ?? run.startedAt;
}

function statsFromEntries(
  backend: CacheBackend,
  description: string,
  entries: SearchIndexEntry[],
  runs: SearchIndexRun[]
): SearchIndexStats {
  const lastFull = runs
    .filter((run) => run.mode === "full" && run.status === "succeeded")
    .sort((left, right) => runSortTime(right).localeCompare(runSortTime(left)))[0];
  const lastIncremental = runs
    .filter((run) => run.mode === "incremental" && run.status === "succeeded")
    .sort((left, right) => runSortTime(right).localeCompare(runSortTime(left)))[0];
  const lastRun = runs.sort((left, right) => runSortTime(right).localeCompare(runSortTime(left)))[0];

  return {
    backend,
    description,
    entryCount: entries.length,
    latestIndexedAt: entries
      .map((entry) => entry.indexedAt)
      .filter(Boolean)
      .sort()
      .at(-1),
    latestSourceUpdatedAt: entries
      .map((entry) => entry.sourceUpdatedAt)
      .filter(Boolean)
      .sort()
      .at(-1),
    lastFullSyncAt: lastFull?.completedAt,
    lastIncrementalSyncAt: lastIncremental?.completedAt,
    lastRun: lastRun ? cloneRun(lastRun) : undefined
  };
}

function searchEntries(entries: SearchIndexEntry[], query: string, limit: number) {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const ranked = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter(({ score }) => !query.trim() || score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.entry.sourceUpdatedAt.localeCompare(left.entry.sourceUpdatedAt);
    })
    .slice(0, boundedLimit);

  return ranked.map(({ entry }) => cloneResult(entry.result));
}

function createRun(mode: SearchIndexSyncMode): SearchIndexRun {
  const now = new Date().toISOString();
  return {
    id: `${mode}-${now.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    mode,
    status: "running",
    startedAt: now,
    updatedAt: now,
    scanned: 0,
    saved: 0,
    deleted: 0,
    failed: 0
  };
}

export class LocalSearchIndexStore implements SearchIndexStore {
  readonly backend = "local" as const;
  readonly description: string;

  constructor(private readonly statePath: string) {
    this.description = `local:${statePath}`;
  }

  async getHealth() {
    return {
      backend: this.backend,
      statePath: this.statePath
    };
  }

  async getStats() {
    const state = await this.readState();
    return statsFromEntries(
      this.backend,
      this.description,
      Object.values(state.entries),
      Object.values(state.runs)
    );
  }

  async search(query: string, limit: number) {
    const state = await this.readState();
    return searchEntries(Object.values(state.entries), query, limit);
  }

  async getResult(assetKey: string) {
    const state = await this.readState();
    const entry = state.entries[assetKey];
    return entry ? cloneResult(entry.result) : undefined;
  }

  async upsertResult(result: SearchResult, indexedAt?: string) {
    return this.updateState((state) => {
      const entry = entryForResult(result, indexedAt);
      state.entries[entry.assetKey] = entry;
      return entry;
    });
  }

  async upsertResults(results: SearchResult[], indexedAt?: string) {
    return this.updateState((state) => {
      const now = indexedAt ?? new Date().toISOString();
      return results.map((result) => {
        const entry = entryForResult(result, now);
        state.entries[entry.assetKey] = entry;
        return entry;
      });
    });
  }

  async deleteEntriesNotIn(assetKeys: Set<string>) {
    return this.updateState((state) => {
      let deleted = 0;
      for (const assetKey of Object.keys(state.entries)) {
        if (!assetKeys.has(assetKey)) {
          delete state.entries[assetKey];
          deleted += 1;
        }
      }
      return deleted;
    });
  }

  async startRun(mode: SearchIndexSyncMode) {
    return this.updateState((state) => {
      const run = createRun(mode);
      state.runs[run.id] = run;
      return cloneRun(run);
    });
  }

  async updateRun(run: SearchIndexRun) {
    await this.updateState((state) => {
      state.runs[run.id] = cloneRun({
        ...run,
        updatedAt: new Date().toISOString()
      });
    });
  }

  async completeRun(run: SearchIndexRun, status: SearchIndexSyncStatus, error?: string) {
    return this.updateState((state) => {
      const completedAt = new Date().toISOString();
      const nextRun: SearchIndexRun = {
        ...run,
        status,
        updatedAt: completedAt,
        completedAt,
        error
      };
      state.runs[nextRun.id] = nextRun;
      return cloneRun(nextRun);
    });
  }

  private async readState(): Promise<LocalSearchIndexState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as LocalSearchIndexState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return emptySearchIndexState();
      }
      throw error;
    }
  }

  private async writeState(state: LocalSearchIndexState): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }

  private async updateState<T>(mutator: (state: LocalSearchIndexState) => T | Promise<T>) {
    const state = await this.readState();
    const result = await mutator(state);
    await this.writeState(state);
    return result;
  }
}

export class AzureSearchIndexStore implements SearchIndexStore {
  readonly backend = "azure" as const;
  readonly description: string;

  private readonly config = readAzureConfig();
  private readonly tableClient: TableClient;
  private readonly credential = new DefaultAzureCredential();
  private ready?: Promise<void>;
  private entriesCache?: { expiresAt: number; entries: SearchIndexEntry[] };

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

  async getHealth() {
    await this.ensureReady();
    return {
      backend: this.backend,
      accountName: this.config.accountName,
      tableName: this.config.tableName
    };
  }

  async getStats() {
    await this.ensureReady();
    const entries = await this.listEntries();
    const runs = await this.listRuns();
    return statsFromEntries(this.backend, this.description, entries, runs);
  }

  async search(query: string, limit: number) {
    await this.ensureReady();
    return searchEntries(await this.listEntries(), query, limit);
  }

  async getResult(assetKey: string) {
    await this.ensureReady();
    try {
      const entity = await this.tableClient.getEntity<PayloadEntity>(
        moviePartitionKey,
        encodeRowKey(assetKey)
      );
      return cloneResult(deserialize<SearchIndexEntry>(entity).result);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async upsertResult(result: SearchResult, indexedAt?: string) {
    await this.ensureReady();
    const entry = entryForResult(result, indexedAt);
    await this.saveEntry(entry);
    return entry;
  }

  async upsertResults(results: SearchResult[], indexedAt?: string) {
    await this.ensureReady();
    const now = indexedAt ?? new Date().toISOString();
    const entries = results.map((result) => entryForResult(result, now));
    for (const entry of entries) {
      await this.saveEntry(entry);
    }
    return entries;
  }

  async deleteEntriesNotIn(assetKeys: Set<string>) {
    await this.ensureReady();
    this.entriesCache = undefined;
    let deleted = 0;
    const entities = this.tableClient.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${moviePartitionKey}'`
      }
    });

    for await (const entity of entities) {
      const assetKey = entity.assetKey ?? deserialize<SearchIndexEntry>(entity).assetKey;
      if (!assetKeys.has(assetKey)) {
        await this.tableClient.deleteEntity(moviePartitionKey, entity.rowKey);
        deleted += 1;
      }
    }

    return deleted;
  }

  async startRun(mode: SearchIndexSyncMode) {
    await this.ensureReady();
    const run = createRun(mode);
    await this.saveRun(run);
    return cloneRun(run);
  }

  async updateRun(run: SearchIndexRun) {
    await this.ensureReady();
    await this.saveRun({
      ...run,
      updatedAt: new Date().toISOString()
    });
  }

  async completeRun(run: SearchIndexRun, status: SearchIndexSyncStatus, error?: string) {
    await this.ensureReady();
    const completedAt = new Date().toISOString();
    const nextRun: SearchIndexRun = {
      ...run,
      status,
      updatedAt: completedAt,
      completedAt,
      error
    };
    await this.saveRun(nextRun);
    return cloneRun(nextRun);
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

  private async saveEntry(entry: SearchIndexEntry) {
    this.entriesCache = undefined;
    await this.tableClient.upsertEntity<PayloadEntity>(
      {
        partitionKey: moviePartitionKey,
        rowKey: encodeRowKey(entry.assetKey),
        assetKey: entry.assetKey,
        sourceUpdatedAt: entry.sourceUpdatedAt,
        indexedAt: entry.indexedAt,
        payload: serialize(entry)
      },
      "Replace"
    );
  }

  private async saveRun(run: SearchIndexRun) {
    await this.tableClient.upsertEntity<PayloadEntity>(
      {
        partitionKey: runPartitionKey,
        rowKey: run.id,
        mode: run.mode,
        status: run.status,
        updatedAt: run.updatedAt,
        payload: serialize(run)
      },
      "Replace"
    );
  }

  private async listEntries() {
    const now = Date.now();
    if (this.entriesCache && this.entriesCache.expiresAt > now) {
      return this.entriesCache.entries.map(cloneEntry);
    }

    const entries: SearchIndexEntry[] = [];
    const entities = this.tableClient.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${moviePartitionKey}'`
      }
    });

    for await (const entity of entities) {
      entries.push(deserialize<SearchIndexEntry>(entity));
    }

    if (searchIndexEntryCacheTtlMs > 0) {
      this.entriesCache = {
        expiresAt: now + searchIndexEntryCacheTtlMs,
        entries: entries.map(cloneEntry)
      };
    }

    return entries;
  }

  private async listRuns() {
    const runs: SearchIndexRun[] = [];
    const entities = this.tableClient.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${runPartitionKey}'`
      }
    });

    for await (const entity of entities) {
      runs.push(deserialize<SearchIndexRun>(entity));
    }

    return runs;
  }
}
