import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { emptyPeopleNotionSyncCheckpoint, type PeopleNotionSyncCheckpoint } from "./person-notion-sync.js";

interface SyncStateEntity {
  partitionKey: string;
  rowKey: string;
  payload?: string;
  updatedAt?: string;
}

export interface PeopleNotionSyncStateTableClient {
  createTable(): Promise<unknown>;
  getEntity<T extends object>(partitionKey: string, rowKey: string): Promise<T>;
  upsertEntity<T extends object>(entity: T, mode?: "Merge" | "Replace"): Promise<unknown>;
}

export interface AzurePeopleNotionSyncStateOptions {
  accountName?: string;
  connectionString?: string;
  tableName?: string;
  tableClient?: PeopleNotionSyncStateTableClient;
}

const defaultAccountName = "stwwcachee9219db7";
const defaultTableName = "peoplecatalog";
const partitionKey = "peopleNotionSync";

export class AzurePeopleNotionSyncStateStore {
  readonly description: string;
  private readonly tableClient: PeopleNotionSyncStateTableClient;
  private ready?: Promise<void>;

  constructor(options: AzurePeopleNotionSyncStateOptions = {}) {
    const accountName = options.accountName ?? process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName;
    const connectionString = options.connectionString ?? process.env.AZURE_STORAGE_CONNECTION_STRING;
    const tableName = options.tableName
      ?? process.env.AZURE_STORAGE_PERSON_SYNC_TABLE
      ?? process.env.AZURE_STORAGE_PERSON_CATALOG_TABLE
      ?? defaultTableName;
    this.tableClient = options.tableClient ?? (connectionString
      ? TableClient.fromConnectionString(connectionString, tableName)
      : new TableClient(
        `https://${accountName}.table.core.windows.net`,
        tableName,
        new DefaultAzureCredential()
      ));
    this.description = `azure:${accountName}/${tableName}/${partitionKey}`;
  }

  async readCheckpoint(): Promise<PeopleNotionSyncCheckpoint> {
    const value = await this.readJson<PeopleNotionSyncCheckpoint>("checkpoint");
    if (!value) return emptyPeopleNotionSyncCheckpoint();
    if (value.schemaVersion !== 1) {
      throw new Error(`Unsupported People Notion sync checkpoint: ${String(value.schemaVersion)}`);
    }
    return value;
  }

  async writeCheckpoint(value: PeopleNotionSyncCheckpoint) {
    await this.writeJson("checkpoint", value);
  }

  async writeReport(value: unknown) {
    await this.writeJson("latestReport", value);
  }

  private async readJson<T>(rowKey: string): Promise<T | undefined> {
    await this.ensureReady();
    try {
      const entity = await this.tableClient.getEntity<SyncStateEntity>(partitionKey, rowKey);
      if (!entity.payload) return undefined;
      return JSON.parse(entity.payload) as T;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async writeJson(rowKey: string, value: unknown) {
    await this.ensureReady();
    await this.tableClient.upsertEntity<SyncStateEntity>({
      partitionKey,
      rowKey,
      payload: JSON.stringify(value),
      updatedAt: new Date().toISOString()
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

function isConflict(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 409;
}

function isNotFound(error: unknown) {
  const candidate = error as { statusCode?: number; code?: string };
  return candidate.statusCode === 404 || candidate.code === "ResourceNotFound";
}
