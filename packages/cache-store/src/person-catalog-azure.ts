import { TableClient, type TransactionAction } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type { PersonCatalogState } from "@wwpdw/shared";
import type { PersonCatalogStore } from "./person-catalog.js";

interface PersonCatalogEntity {
  [key: string]: unknown;
  partitionKey: string;
  rowKey: string;
  generationId?: string;
  generatedAt?: string;
  chunkCount?: number;
  chunkIndex?: number;
  payload?: string;
}

export interface PersonCatalogTableClient {
  createTable(): Promise<unknown>;
  getEntity<T extends object>(partitionKey: string, rowKey: string): Promise<T>;
  listEntities?<T extends object>(options?: {
    queryOptions?: { filter?: string };
  }): AsyncIterable<T>;
  upsertEntity<T extends object>(entity: T, mode?: "Merge" | "Replace"): Promise<unknown>;
  submitTransaction?(actions: TransactionAction[]): Promise<unknown>;
}

export interface AzurePersonCatalogStoreOptions {
  accountName?: string;
  connectionString?: string;
  tableName?: string;
  tableClient?: PersonCatalogTableClient;
}

const defaultAccountName = "stwwcachee9219db7";
const defaultTableName = "peoplecatalog";
const partitionKey = "personcatalog";
const manifestRowKey = "current";
const payloadChunkChars = 30_000;
// Azure Table transactions allow at most 100 actions and a 4 MiB payload.
// Keep transactions well below the payload cap. The production catalog can
// time out with forty biography-heavy entities even when the request is under
// 4 MiB; groups of ten have a much safer service-time margin.
const transactionChunkCount = 10;
const transientReadDelaysMs = [250, 750, 1_500];
const readConcurrency = 8;

export class AzurePersonCatalogStore implements PersonCatalogStore {
  readonly description: string;
  private readonly tableClient: PersonCatalogTableClient;
  private ready?: Promise<void>;

  constructor(options: AzurePersonCatalogStoreOptions = {}) {
    const accountName = options.accountName ?? process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName;
    const connectionString = options.connectionString ?? process.env.AZURE_STORAGE_CONNECTION_STRING;
    const tableName = options.tableName ?? process.env.AZURE_STORAGE_PERSON_CATALOG_TABLE ?? defaultTableName;
    const clientOptions = azureTableClientOptions();
    this.tableClient = options.tableClient ?? (connectionString
      ? TableClient.fromConnectionString(connectionString, tableName, clientOptions)
      : new TableClient(
        `https://${accountName}.table.core.windows.net`,
        tableName,
        new DefaultAzureCredential(),
        clientOptions
      ));
    this.description = `azure:${accountName}/${tableName}`;
  }

  async getState() {
    await this.ensureReady();
    try {
      const manifest = await withTransientRetry(() => this.tableClient.getEntity<PersonCatalogEntity>(partitionKey, manifestRowKey));
      if (!manifest.generationId || !manifest.chunkCount || manifest.chunkCount < 1) {
        throw new Error("Person catalog manifest is incomplete.");
      }
      const chunks = this.tableClient.listEntities
        ? await this.readGeneration(manifest.generationId, manifest.chunkCount)
        : await mapConcurrent(manifest.chunkCount, readConcurrency, async (index) => {
          const entity = await withTransientRetry(() => this.tableClient.getEntity<PersonCatalogEntity>(
            partitionKey,
            chunkRowKey(manifest.generationId!, index)
          ));
          if (typeof entity.payload !== "string") throw new Error(`Person catalog chunk is missing: ${index}`);
          return entity.payload;
        });
      return parseState(chunks.join(""));
    } catch (error) {
      if (isNotFound(error)) return emptyState();
      throw error;
    }
  }

  async replaceState(state: PersonCatalogState) {
    validateState(state);
    await this.ensureReady();
    const generationId = generationKey(state.generatedAt);
    const chunks = splitPayload(JSON.stringify(state));
    const entities = chunks.map((payload, index): PersonCatalogEntity => ({
        partitionKey,
        rowKey: chunkRowKey(generationId, index),
        generationId,
        chunkIndex: index,
        payload
    }));
    if (this.tableClient.submitTransaction) {
      for (let index = 0; index < entities.length; index += transactionChunkCount) {
        const actions = entities
          .slice(index, index + transactionChunkCount)
          .map((entity): TransactionAction => ["upsert", entity, "Replace"]);
        await this.tableClient.submitTransaction(actions);
      }
    } else {
      for (const entity of entities) {
        await this.tableClient.upsertEntity<PersonCatalogEntity>(entity, "Replace");
      }
    }
    await this.tableClient.upsertEntity<PersonCatalogEntity>({
      partitionKey,
      rowKey: manifestRowKey,
      generationId,
      generatedAt: state.generatedAt,
      chunkCount: chunks.length
    }, "Replace");
  }

  private async ensureReady() {
    this.ready ??= this.createTableIfMissing();
    await this.ready;
  }

  private async createTableIfMissing() {
    try {
      await this.tableClient.createTable();
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }

  private async readGeneration(generationId: string, chunkCount: number) {
    const chunks = new Map<number, string>();
    const rowKeyPrefix = `snapshot:${generationId}:`;
    const filter = [
      `PartitionKey eq '${partitionKey}'`,
      `RowKey ge '${escapeODataString(rowKeyPrefix)}'`,
      `RowKey lt '${escapeODataString(`${rowKeyPrefix}~`)}'`
    ].join(" and ");
    for await (const entity of this.tableClient.listEntities!<PersonCatalogEntity>({ queryOptions: { filter } })) {
      const index = Number(entity.chunkIndex);
      if (!Number.isInteger(index) || index < 0 || index >= chunkCount || typeof entity.payload !== "string") continue;
      if (chunks.has(index)) throw new Error(`Person catalog chunk is duplicated: ${index}`);
      chunks.set(index, entity.payload);
    }
    if (chunks.size !== chunkCount) {
      const missing = Array.from({ length: chunkCount }, (_, index) => index).filter((index) => !chunks.has(index));
      throw new Error(`Person catalog generation is incomplete: expected ${chunkCount}, found ${chunks.size}; missing ${missing.slice(0, 10).join(",")}`);
    }
    return Array.from({ length: chunkCount }, (_, index) => chunks.get(index)!);
  }
}

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

function azureTableClientOptions() {
  return {
    retryOptions: {
      maxRetries: 3,
      tryTimeoutInMs: boundedTimeout(process.env.PERSON_CATALOG_AZURE_TRY_TIMEOUT_MS, 30_000)
    }
  };
}

function boundedTimeout(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(120_000, Math.max(5_000, Math.floor(parsed))) : fallback;
}

function parseState(payload: string) {
  const state = JSON.parse(payload) as PersonCatalogState;
  validateState(state);
  return state;
}

function validateState(state: Partial<PersonCatalogState>) {
  if (state.schemaVersion !== 1) throw new Error(`Unsupported person catalog schema version: ${String(state.schemaVersion)}`);
}

function emptyState(): PersonCatalogState {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    people: {},
    redirects: {},
    externalIdIndex: { tmdb: {}, imdb: {}, wikidata: {} },
    aliasIndex: {},
    creditsByWorkId: {},
    creditsByPersonId: {},
    issues: []
  };
}

function splitPayload(payload: string) {
  return payload.match(new RegExp(`[\\s\\S]{1,${payloadChunkChars}}`, "g")) ?? [""];
}

function generationKey(generatedAt: string) {
  return Buffer.from(generatedAt, "utf8").toString("base64url");
}

function chunkRowKey(generationId: string, index: number) {
  return `snapshot:${generationId}:${String(index).padStart(4, "0")}`;
}

function isConflict(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 409;
}

function isNotFound(error: unknown) {
  const candidate = error as { statusCode?: number; code?: string };
  return candidate.statusCode === 404 || candidate.code === "ResourceNotFound";
}

async function withTransientRetry<T>(operation: () => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delayMs = transientReadDelaysMs[attempt];
      if (!delayMs || !isTransientReadError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function mapConcurrent<T>(count: number, concurrency: number, operation: (index: number) => Promise<T>) {
  const results = new Array<T>(count);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (nextIndex < count) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(index);
    }
  }));
  return results;
}

function isTransientReadError(error: unknown) {
  const candidate = error as { code?: string; errno?: string; statusCode?: number };
  return candidate.statusCode === 408
    || candidate.statusCode === 429
    || [candidate.code, candidate.errno].some((value) => [
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT"
    ].includes(value ?? ""));
}
