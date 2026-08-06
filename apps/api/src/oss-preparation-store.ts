import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

export type OssPreparationStatus =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface OssPreparationJob {
  id: string;
  assetKey: string;
  title: string;
  sourceUrl: string;
  objectKey: string;
  taskId: string;
  status: OssPreparationStatus;
  progress: number;
  progressDeterminate?: boolean;
  message: string;
  expectedBytes?: number;
  transferredBytes?: number;
  partCount?: number;
  lastProgressAt?: string;
  contentLength?: number;
  contentType?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastPlayedAt?: string;
  expiresAt?: string;
  cleanupClaimedAt?: string;
  cleanupClaimToken?: string;
}

export type PublicOssPreparationJob = Omit<
  OssPreparationJob,
  "sourceUrl" | "cleanupClaimedAt" | "cleanupClaimToken"
>;

interface StoreOptions {
  backend?: "local" | "azure";
  localDataDir?: string;
  accountName?: string;
  tableName?: string;
  connectionString?: string;
}

interface LocalState {
  jobs: Record<string, OssPreparationJob>;
}

const partitionKey = "oss-prepare";
const renameRetryDelaysMs = [10, 25, 50, 100, 250];

function publicJob({
  sourceUrl: _sourceUrl,
  cleanupClaimedAt: _cleanupClaimedAt,
  cleanupClaimToken: _cleanupClaimToken,
  ...job
}: OssPreparationJob): PublicOssPreparationJob {
  return job;
}

function isPreconditionFailure(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 412;
}

export class OssPreparationCleanupClaimedError extends Error {
  constructor() {
    super("OSS preparation is being cleaned up.");
    this.name = "OssPreparationCleanupClaimedError";
  }
}

export class OssPreparationStore {
  private readonly backend: "local" | "azure";
  private readonly statePath: string;
  private readonly table?: TableClient;
  private localMutationTail: Promise<void> = Promise.resolve();
  private ready?: Promise<void>;

  constructor(options: StoreOptions = {}) {
    const configuredBackend = process.env.WWPDW_OSS_PREPARATION_BACKEND ?? process.env.CACHE_BACKEND;
    this.backend = options.backend ?? (configuredBackend === "azure" ? "azure" : "local");
    this.statePath = path.join(
      options.localDataDir ?? process.env.WWPDW_LOCAL_DATA_DIR ?? ".local-data",
      "oss-preparation-state.json"
    );
    if (this.backend === "azure") {
      const tableName = options.tableName ?? process.env.AZURE_STORAGE_OSS_PREPARATION_TABLE ?? "osspreparejobs";
      const connectionString = options.connectionString ?? process.env.AZURE_STORAGE_CONNECTION_STRING;
      this.table = connectionString
        ? TableClient.fromConnectionString(connectionString, tableName)
        : new TableClient(
          `https://${options.accountName ?? process.env.AZURE_STORAGE_ACCOUNT_NAME ?? "stwwcachee9219db7"}.table.core.windows.net`,
          tableName,
          new DefaultAzureCredential()
        );
    }
  }

  toPublic(job: OssPreparationJob) {
    return publicJob(job);
  }

  async get(id: string) {
    if (!this.table) return (await this.readLocal()).jobs[id];
    await this.ensureReady();
    try {
      const entity = await this.table.getEntity<Record<string, unknown>>(partitionKey, id);
      return JSON.parse(String(entity.payload)) as OssPreparationJob;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return undefined;
      throw error;
    }
  }

  async findByAssetKey(assetKey: string) {
    return (await this.list(1_000)).find((job) => job.assetKey === assetKey);
  }

  async list(limit = 50) {
    if (!this.table) {
      return Object.values((await this.readLocal()).jobs)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    }
    await this.ensureReady();
    const jobs: OssPreparationJob[] = [];
    const entities = this.table.listEntities<Record<string, unknown>>({
      queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
    });
    for await (const entity of entities) {
      jobs.push(JSON.parse(String(entity.payload)) as OssPreparationJob);
    }
    return jobs
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async put(job: OssPreparationJob) {
    if (!this.table) {
      const mutation = this.localMutationTail.then(async () => {
        const state = await this.readLocal();
        state.jobs[job.id] = job;
        await this.writeLocal(state);
      });
      this.localMutationTail = mutation.catch(() => undefined);
      await mutation;
      return;
    }
    await this.ensureReady();
    await this.table.upsertEntity({
      partitionKey,
      rowKey: job.id,
      assetKey: job.assetKey,
      status: job.status,
      createdAt: job.createdAt,
      ...(job.lastPlayedAt ? { lastPlayedAt: job.lastPlayedAt } : {}),
      ...(job.expiresAt ? { expiresAt: job.expiresAt } : {}),
      ...(job.cleanupClaimedAt ? { cleanupClaimedAt: job.cleanupClaimedAt } : {}),
      ...(job.cleanupClaimToken ? { cleanupClaimToken: job.cleanupClaimToken } : {}),
      payload: JSON.stringify(job)
    }, "Replace");
  }

  async markPlayed(id: string, playedAt: string, expiresAt: string) {
    if (!this.table) {
      let updated: OssPreparationJob | undefined;
      const mutation = this.localMutationTail.then(async () => {
        const state = await this.readLocal();
        const job = state.jobs[id];
        if (!job) return;
        if (job.cleanupClaimedAt) throw new OssPreparationCleanupClaimedError();
        updated = { ...job, lastPlayedAt: playedAt, expiresAt };
        state.jobs[id] = updated;
        await this.writeLocal(state);
      });
      this.localMutationTail = mutation.catch(() => undefined);
      await mutation;
      return updated;
    }

    await this.ensureReady();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let entity;
      try {
        entity = await this.table.getEntity<Record<string, unknown>>(partitionKey, id);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) return undefined;
        throw error;
      }
      const job = JSON.parse(String(entity.payload)) as OssPreparationJob;
      if (job.cleanupClaimedAt) throw new OssPreparationCleanupClaimedError();
      const updated = { ...job, lastPlayedAt: playedAt, expiresAt };
      try {
        await this.table.updateEntity({
          partitionKey,
          rowKey: id,
          assetKey: updated.assetKey,
          status: updated.status,
          createdAt: updated.createdAt,
          lastPlayedAt: playedAt,
          expiresAt,
          payload: JSON.stringify(updated)
        }, "Replace", { etag: entity.etag });
        return updated;
      } catch (error) {
        if (!isPreconditionFailure(error) || attempt === 2) throw error;
      }
    }
    return undefined;
  }

  async delete(id: string) {
    if (!this.table) {
      const mutation = this.localMutationTail.then(async () => {
        const state = await this.readLocal();
        delete state.jobs[id];
        await this.writeLocal(state);
      });
      this.localMutationTail = mutation.catch(() => undefined);
      await mutation;
      return;
    }
    await this.ensureReady();
    await this.table.deleteEntity(partitionKey, id).catch((error) => {
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    });
  }

  private async ensureReady() {
    this.ready ??= this.createTableIfMissing();
    await this.ready;
  }

  private async createTableIfMissing() {
    try {
      await this.table!.createTable();
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 409) throw error;
    }
  }

  private async readLocal(): Promise<LocalState> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8")) as LocalState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { jobs: {} };
      throw error;
    }
  }

  private async writeLocal(state: LocalState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      for (let attempt = 0; ; attempt += 1) {
        try {
          await rename(temporaryPath, this.statePath);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const retryDelay = renameRetryDelaysMs[attempt];
          if (!retryDelay || !["EACCES", "EBUSY", "EPERM"].includes(code ?? "")) throw error;
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export function createOssPreparationStore(options: StoreOptions = {}) {
  return new OssPreparationStore(options);
}
