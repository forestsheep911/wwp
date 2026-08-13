import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type { PersonCatalogState } from "@wwpdw/shared";
import type { PersonCatalogStore } from "./person-catalog.js";

interface PersonCatalogEntity {
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
  upsertEntity<T extends object>(entity: T, mode?: "Merge" | "Replace"): Promise<unknown>;
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

export class AzurePersonCatalogStore implements PersonCatalogStore {
  readonly description: string;
  private readonly tableClient: PersonCatalogTableClient;
  private ready?: Promise<void>;

  constructor(options: AzurePersonCatalogStoreOptions = {}) {
    const accountName = options.accountName ?? process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName;
    const connectionString = options.connectionString ?? process.env.AZURE_STORAGE_CONNECTION_STRING;
    const tableName = options.tableName ?? process.env.AZURE_STORAGE_PERSON_CATALOG_TABLE ?? defaultTableName;
    this.tableClient = options.tableClient ?? (connectionString
      ? TableClient.fromConnectionString(connectionString, tableName)
      : new TableClient(
        `https://${accountName}.table.core.windows.net`,
        tableName,
        new DefaultAzureCredential()
      ));
    this.description = `azure:${accountName}/${tableName}`;
  }

  async getState() {
    await this.ensureReady();
    try {
      const manifest = await this.tableClient.getEntity<PersonCatalogEntity>(partitionKey, manifestRowKey);
      if (!manifest.generationId || !manifest.chunkCount || manifest.chunkCount < 1) {
        throw new Error("Person catalog manifest is incomplete.");
      }
      const chunks: string[] = [];
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const entity = await this.tableClient.getEntity<PersonCatalogEntity>(
          partitionKey,
          chunkRowKey(manifest.generationId, index)
        );
        if (typeof entity.payload !== "string") throw new Error(`Person catalog chunk is missing: ${index}`);
        chunks.push(entity.payload);
      }
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
    for (let index = 0; index < chunks.length; index += 1) {
      await this.tableClient.upsertEntity<PersonCatalogEntity>({
        partitionKey,
        rowKey: chunkRowKey(generationId, index),
        generationId,
        chunkIndex: index,
        payload: chunks[index]
      }, "Replace");
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
