import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import type { ContainerClient, UserDelegationKey } from "@azure/storage-blob";
import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import {
  durationMs,
  errorLogFields,
  logError,
  logInfo
} from "@wwpdw/shared";
import type {
  CacheAsset,
  CacheJob,
  CacheStatus,
  SearchResult
} from "@wwpdw/shared";
import { addDays, cacheAssetTtlDays, createJob, isFreshReady } from "./jobs.js";
import type { CacheStore, CleanupExpiredResult } from "./types.js";

const terminalStatuses: CacheStatus[] = ["ready", "failed"];
const defaultAccountName = "stwwcachee9219db7";
const defaultContainerName = "cached-videos";
const defaultQueueName = "cache-jobs";
const defaultAssetTableName = "cacheindex";
const defaultJobTableName = "cachejobs";

interface AzureStoreConfig {
  accountName: string;
  connectionString?: string;
  containerName: string;
  queueName: string;
  assetTableName: string;
  jobTableName: string;
  sasMinutes: number;
}

type PayloadEntity = {
  partitionKey: string;
  rowKey: string;
  assetKey?: string;
  jobId?: string;
  status?: string;
  updatedAt?: string;
  payload: string;
};

function readAzureConfig(): AzureStoreConfig {
  return {
    accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName,
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    containerName: process.env.AZURE_STORAGE_BLOB_CONTAINER ?? defaultContainerName,
    queueName: process.env.AZURE_STORAGE_QUEUE_NAME ?? defaultQueueName,
    assetTableName: process.env.AZURE_STORAGE_ASSET_TABLE ?? defaultAssetTableName,
    jobTableName: process.env.AZURE_STORAGE_JOB_TABLE ?? defaultJobTableName,
    sasMinutes: Number(process.env.AZURE_STORAGE_PLAYBACK_SAS_MINUTES ?? 60)
  };
}

function encodeRowKey(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function encodeQueueMessage(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function parseConnectionString(connectionString: string) {
  const parts = Object.fromEntries(
    connectionString
      .split(";")
      .map((part) => part.split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...rest]) => [key, rest.join("=")])
  );

  if (!parts.AccountName || !parts.AccountKey) {
    return undefined;
  }

  return {
    accountName: parts.AccountName,
    accountKey: parts.AccountKey
  };
}

function isConflict(error: unknown) {
  const statusCode = (error as { statusCode?: number }).statusCode;
  return statusCode === 409;
}

function isNotFound(error: unknown) {
  const statusCode = (error as { statusCode?: number }).statusCode;
  const code = (error as { code?: string }).code;
  return statusCode === 404 || code === "ResourceNotFound";
}

function serialize<T>(payload: T) {
  return JSON.stringify(payload);
}

function deserialize<T>(entity: Pick<PayloadEntity, "payload">) {
  return JSON.parse(entity.payload) as T;
}

function mediaExtension(sourceUrl?: string) {
  const fallback = ".mp4";
  if (!sourceUrl) {
    return fallback;
  }

  try {
    const parsed = new URL(sourceUrl);
    const match = parsed.pathname.match(/\.(mp4|m4v|mov|webm)$/i);
    return match ? `.${match[1].toLowerCase()}` : fallback;
  } catch {
    const match = sourceUrl.match(/\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i);
    return match ? `.${match[1].toLowerCase()}` : fallback;
  }
}

function contentTypeFor(sourceUrl?: string, responseContentType?: string | null) {
  if (responseContentType?.startsWith("video/")) {
    return responseContentType;
  }

  const extension = mediaExtension(sourceUrl);
  if (extension === ".webm") {
    return "video/webm";
  }

  if (extension === ".mov") {
    return "video/quicktime";
  }

  return "video/mp4";
}

function blobNameForAsset(assetKey: string, sourceUrl?: string) {
  return `assets/${encodeRowKey(assetKey)}/cached${mediaExtension(sourceUrl)}`;
}

function isExpiredReadyAsset(asset: CacheAsset, now: Date) {
  return asset.status === "ready" &&
    Boolean(asset.expiresAt) &&
    new Date(asset.expiresAt ?? "").getTime() <= now.getTime();
}

export class AzureCacheStore implements CacheStore {
  readonly backend = "azure" as const;
  readonly description: string;

  private readonly config = readAzureConfig();
  private readonly assetTable: TableClient;
  private readonly jobTable: TableClient;
  private readonly queueClient: QueueClient;
  private readonly blobService: BlobServiceClient;
  private readonly containerClient: ContainerClient;
  private readonly sharedKeyCredential?: StorageSharedKeyCredential;
  private readonly credential = new DefaultAzureCredential();
  private ready?: Promise<void>;

  constructor() {
    if (this.config.connectionString) {
      this.blobService = BlobServiceClient.fromConnectionString(this.config.connectionString);
      this.queueClient = QueueServiceClient.fromConnectionString(
        this.config.connectionString
      ).getQueueClient(this.config.queueName);
      this.assetTable = TableClient.fromConnectionString(
        this.config.connectionString,
        this.config.assetTableName
      );
      this.jobTable = TableClient.fromConnectionString(
        this.config.connectionString,
        this.config.jobTableName
      );

      const parsed = parseConnectionString(this.config.connectionString);
      if (parsed) {
        this.sharedKeyCredential = new StorageSharedKeyCredential(
          parsed.accountName,
          parsed.accountKey
        );
      }
    } else {
      this.blobService = new BlobServiceClient(
        `https://${this.config.accountName}.blob.core.windows.net`,
        this.credential
      );
      this.queueClient = new QueueClient(
        `https://${this.config.accountName}.queue.core.windows.net/${this.config.queueName}`,
        this.credential
      );
      this.assetTable = new TableClient(
        `https://${this.config.accountName}.table.core.windows.net`,
        this.config.assetTableName,
        this.credential
      );
      this.jobTable = new TableClient(
        `https://${this.config.accountName}.table.core.windows.net`,
        this.config.jobTableName,
        this.credential
      );
    }

    this.containerClient = this.blobService.getContainerClient(this.config.containerName);
    this.description = `azure:${this.config.accountName}/${this.config.containerName}`;
  }

  async getHealth() {
    await this.ensureReady();
    return {
      backend: this.backend,
      accountName: this.config.accountName,
      containerName: this.config.containerName,
      queueName: this.config.queueName,
      assetTableName: this.config.assetTableName,
      jobTableName: this.config.jobTableName,
      sasMinutes: this.config.sasMinutes
    };
  }

  async listAssets(assetKeys: string[]) {
    await this.ensureReady();
    const entries = await Promise.all(
      assetKeys.map(async (assetKey) => [assetKey, await this.getAsset(assetKey)] as const)
    );

    return Object.fromEntries(
      entries.filter((entry): entry is readonly [string, CacheAsset] => Boolean(entry[1]))
    );
  }

  async getAsset(assetKey: string) {
    await this.ensureReady();
    try {
      const entity = await this.assetTable.getEntity<PayloadEntity>(
        "asset",
        encodeRowKey(assetKey)
      );
      return deserialize<CacheAsset>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async getJob(jobId: string) {
    await this.ensureReady();
    try {
      const entity = await this.jobTable.getEntity<PayloadEntity>("job", jobId);
      return deserialize<CacheJob>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async ensureCache(result: SearchResult) {
    await this.ensureReady();
    const existingAsset = await this.getAsset(result.assetKey);
    const existingJob = existingAsset?.jobId ? await this.getJob(existingAsset.jobId) : undefined;

    if (existingAsset && isFreshReady(existingAsset) && existingJob) {
      existingAsset.lastRequestedAt = new Date().toISOString();
      await this.saveAsset(existingAsset);
      return { asset: existingAsset, job: existingJob };
    }

    if (existingAsset && existingJob && !terminalStatuses.includes(existingJob.status)) {
      existingAsset.lastRequestedAt = new Date().toISOString();
      await this.saveAsset(existingAsset);
      return { asset: existingAsset, job: existingJob };
    }

    const job = createJob({
      assetKey: result.assetKey,
      title: result.title,
      source: result.source,
      sourceUrl: result.sourceUrl
    });
    const asset: CacheAsset = {
      assetKey: result.assetKey,
      title: result.title,
      source: result.source,
      status: "queued",
      jobId: job.id,
      lastRequestedAt: job.createdAt
    };

    await this.saveJob(job);
    await this.saveAsset(asset);
    await this.queueClient.sendMessage(
      encodeQueueMessage({
        jobId: job.id,
        assetKey: job.assetKey
      })
    );

    return { asset, job };
  }

  async syncQueue(maxMessages: number) {
    await this.ensureReady();
    const response = await this.queueClient.receiveMessages({
      numberOfMessages: Math.min(Math.max(maxMessages, 1), 32),
      visibilityTimeout: 30
    });

    await Promise.all(
      response.receivedMessageItems.map((message) =>
        this.queueClient.deleteMessage(message.messageId, message.popReceipt)
      )
    );
  }

  async listActiveJobs(limit: number) {
    await this.ensureReady();
    const activeJobs: CacheJob[] = [];
    const entities = this.jobTable.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'job'"
      }
    });

    for await (const entity of entities) {
      const job = deserialize<CacheJob>(entity);
      if (!terminalStatuses.includes(job.status)) {
        activeJobs.push(job);
      }
    }

    return activeJobs
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async saveJob(job: CacheJob) {
    await this.ensureReady();
    await this.jobTable.upsertEntity<PayloadEntity>(
      {
        partitionKey: "job",
        rowKey: job.id,
        jobId: job.id,
        assetKey: job.assetKey,
        status: job.status,
        updatedAt: job.updatedAt,
        payload: serialize(job)
      },
      "Replace"
    );
  }

  async saveAsset(asset: CacheAsset) {
    await this.ensureReady();
    await this.assetTable.upsertEntity<PayloadEntity>(
      {
        partitionKey: "asset",
        rowKey: encodeRowKey(asset.assetKey),
        assetKey: asset.assetKey,
        status: asset.status,
        updatedAt: new Date().toISOString(),
        payload: serialize(asset)
      },
      "Replace"
    );
  }

  async finalizeReadyAsset(job: CacheJob) {
    await this.ensureReady();
    const startedAt = Date.now();
    const sourceUrl = job.resolve?.url ?? job.sourceUrl;
    if (!sourceUrl) {
      throw new Error("Resolved media URL is missing.");
    }

    const blobName = blobNameForAsset(job.assetKey, sourceUrl);
    const blockBlob = this.containerClient.getBlockBlobClient(blobName);

    logInfo("cache.blob.upload_start", {
      jobId: job.id,
      assetKey: job.assetKey,
      blobName,
      resolverLayer: job.resolve?.layer,
      resolveKind: job.resolve?.kind
    });

    try {
      const sourceResponse = await fetch(sourceUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "wwpdw-cache-worker/0.1"
        }
      });

      if (!sourceResponse.ok || !sourceResponse.body) {
        throw new Error(`Source download failed with HTTP ${sourceResponse.status}.`);
      }

      const contentType = contentTypeFor(sourceUrl, sourceResponse.headers.get("content-type"));
      const sourceContentLength = sourceResponse.headers.get("content-length");
      const stream = Readable.fromWeb(sourceResponse.body as ReadableStream<Uint8Array>);
      await blockBlob.uploadStream(stream, 8 * 1024 * 1024, 4, {
        blobHTTPHeaders: {
          blobContentType: contentType
        },
        metadata: {
          assetkey: encodeRowKey(job.assetKey),
          jobid: job.id,
          resolver: job.resolve?.layer ?? "unknown"
        }
      });

      logInfo("cache.blob.upload_complete", {
        jobId: job.id,
        assetKey: job.assetKey,
        blobName,
        contentType,
        sourceContentLength,
        durationMs: durationMs(startedAt)
      });
    } catch (error) {
      logError("cache.blob.upload_failed", {
        jobId: job.id,
        assetKey: job.assetKey,
        blobName,
        durationMs: durationMs(startedAt),
        ...errorLogFields(error)
      });
      throw error;
    }

    const asset: CacheAsset = {
      assetKey: job.assetKey,
      title: job.title,
      source: job.source,
      status: "ready",
      jobId: job.id,
      playbackUrl: `azure://${this.config.containerName}/${blobName}`,
      expiresAt: addDays(new Date(), cacheAssetTtlDays()).toISOString(),
      lastRequestedAt: job.createdAt
    };

    await this.saveAsset(asset);
    return asset;
  }

  async getPlayback(assetKey: string) {
    await this.ensureReady();
    const asset = await this.getAsset(assetKey);
    if (!isFreshReady(asset) || !asset?.playbackUrl) {
      return undefined;
    }

    const blobName = this.blobNameFromPlaybackUrl(asset.playbackUrl);
    if (!blobName) {
      return undefined;
    }

    const expiresOn = new Date(Date.now() + this.config.sasMinutes * 60 * 1000);
    return {
      assetKey: asset.assetKey,
      title: asset.title,
      playbackUrl: await this.createBlobReadUrl(blobName, expiresOn),
      expiresAt: expiresOn.toISOString()
    };
  }

  async cleanupExpired(now = new Date()): Promise<CleanupExpiredResult> {
    await this.ensureReady();
    const result: CleanupExpiredResult = {
      scannedAssets: 0,
      expiredAssets: 0,
      deletedAssets: 0,
      deletedJobs: 0,
      deletedBlobs: 0,
      errors: []
    };
    const entities = this.assetTable.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'asset'"
      }
    });

    for await (const entity of entities) {
      result.scannedAssets += 1;
      let asset: CacheAsset;
      try {
        asset = deserialize<CacheAsset>(entity);
      } catch (error) {
        result.errors.push(`Could not parse asset ${entity.rowKey}: ${error instanceof Error ? error.message : "unknown error"}`);
        continue;
      }

      if (!isExpiredReadyAsset(asset, now)) {
        continue;
      }

      result.expiredAssets += 1;
      logInfo("cache.cleanup.expired_asset", {
        assetKey: asset.assetKey,
        jobId: asset.jobId,
        expiresAt: asset.expiresAt
      });
      await this.deleteExpiredAsset(asset, entity.rowKey, result);
    }

    return result;
  }

  private async ensureReady() {
    this.ready ??= this.createInfrastructureIfMissing();
    await this.ready;
  }

  private async createInfrastructureIfMissing() {
    await this.containerClient.createIfNotExists();
    await this.queueClient.createIfNotExists();
    await this.createTableIfMissing(this.assetTable);
    await this.createTableIfMissing(this.jobTable);
  }

  private async createTableIfMissing(tableClient: TableClient) {
    try {
      await tableClient.createTable();
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }
    }
  }

  private blobNameFromPlaybackUrl(playbackUrl: string) {
    const prefix = `azure://${this.config.containerName}/`;
    if (!playbackUrl.startsWith(prefix)) {
      return undefined;
    }

    return playbackUrl.slice(prefix.length);
  }

  private async deleteExpiredAsset(
    asset: CacheAsset,
    rowKey: string,
    result: CleanupExpiredResult
  ) {
    const blobName = asset.playbackUrl ? this.blobNameFromPlaybackUrl(asset.playbackUrl) : undefined;
    let blobDeleted = true;

    if (blobName) {
      blobDeleted = false;
      try {
      await this.containerClient.deleteBlob(blobName, {
        deleteSnapshots: "include"
      });
      result.deletedBlobs += 1;
      blobDeleted = true;
      logInfo("cache.cleanup.blob_deleted", {
        assetKey: asset.assetKey,
        jobId: asset.jobId,
        blobName
      });
    } catch (error) {
      if (isNotFound(error)) {
        blobDeleted = true;
        } else {
          result.errors.push(`Could not delete blob for ${asset.assetKey}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    }

    if (!blobDeleted) {
      return;
    }

    try {
      await this.assetTable.deleteEntity("asset", rowKey);
      result.deletedAssets += 1;
      logInfo("cache.cleanup.asset_deleted", {
        assetKey: asset.assetKey,
        jobId: asset.jobId
      });
    } catch (error) {
      if (!isNotFound(error)) {
        result.errors.push(`Could not delete asset ${asset.assetKey}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    if (!asset.jobId) {
      return;
    }

    try {
      await this.jobTable.deleteEntity("job", asset.jobId);
      result.deletedJobs += 1;
      logInfo("cache.cleanup.job_deleted", {
        assetKey: asset.assetKey,
        jobId: asset.jobId
      });
    } catch (error) {
      if (!isNotFound(error)) {
        result.errors.push(`Could not delete job ${asset.jobId}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }

  private async createBlobReadUrl(blobName: string, expiresOn: Date) {
    const blockBlob = this.containerClient.getBlockBlobClient(blobName);
    const startsOn = new Date(Date.now() - 5 * 60 * 1000);

    if (this.sharedKeyCredential) {
      const sas = generateBlobSASQueryParameters(
        {
          containerName: this.config.containerName,
          blobName,
          permissions: BlobSASPermissions.parse("r"),
          startsOn,
          expiresOn,
          protocol: SASProtocol.Https
        },
        this.sharedKeyCredential
      ).toString();
      return `${blockBlob.url}?${sas}`;
    }

    const delegationKey = await this.getUserDelegationKey(startsOn, expiresOn);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.config.containerName,
        blobName,
        permissions: BlobSASPermissions.parse("r"),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https
      },
      delegationKey,
      this.config.accountName
    ).toString();

    return `${blockBlob.url}?${sas}`;
  }

  private async getUserDelegationKey(startsOn: Date, expiresOn: Date): Promise<UserDelegationKey> {
    return this.blobService.getUserDelegationKey(startsOn, expiresOn);
  }
}
