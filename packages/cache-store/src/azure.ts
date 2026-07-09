import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import type { BlockBlobClient, ContainerClient, UserDelegationKey } from "@azure/storage-blob";
import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import {
  durationMs,
  errorLogFields,
  logError,
  logInfo,
  logWarn
} from "@wwpdw/shared";
import type {
  CacheAsset,
  CacheJob,
  CacheStatus,
  MediaDiagnostics,
  MoviePoster,
  Mp4Diagnostics,
  SearchResult
} from "@wwpdw/shared";
import {
  addDays,
  cacheAssetIdleTtlDays,
  createJob,
  isFreshReady,
  isIdleReadyAsset,
  readyAssetIdleReference,
  sourceTraceFromResult
} from "./jobs.js";
import { posterDownloadCandidates, posterRequestHeaders } from "./poster-cache.js";
import type {
  CacheMoviePostersOptions,
  CacheStore,
  CleanupExpiredResult,
  DeleteCacheEntryInput,
  DeleteCacheEntryResult,
  GetAssetOptions
} from "./types.js";

const terminalStatuses: CacheStatus[] = ["ready", "failed"];
const defaultAccountName = "stwwcachee9219db7";
const defaultContainerName = "cached-videos";
const defaultQueueName = "cache-jobs";
const defaultAssetTableName = "cacheindex";
const defaultJobTableName = "cachejobs";
const defaultMp4ProbeBytes = 4 * 1024 * 1024;
const defaultUploadBlockBytes = 8 * 1024 * 1024;
const uploadProgressStart = 24;
const uploadProgressEnd = 90;
const playbackCheckProgress = 96;
const assetLookupCacheTtlMs = Math.max(
  0,
  Number(process.env.CACHE_ASSET_LOOKUP_CACHE_TTL_SECONDS ?? 30)
) * 1000;

interface AzureStoreConfig {
  accountName: string;
  connectionString?: string;
  containerName: string;
  queueName: string;
  assetTableName: string;
  jobTableName: string;
  sasMinutes: number;
  posterSasMinutes: number;
  posterMaxBytes: number;
  posterMaxPerMovie: number;
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
    sasMinutes: Number(process.env.AZURE_STORAGE_PLAYBACK_SAS_MINUTES ?? 720),
    posterSasMinutes: Number(process.env.AZURE_STORAGE_POSTER_SAS_MINUTES ?? 24 * 60),
    posterMaxBytes: Number(process.env.POSTER_CACHE_MAX_BYTES ?? 8 * 1024 * 1024),
    posterMaxPerMovie: Number(process.env.POSTER_CACHE_MAX_PER_MOVIE ?? 0)
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

function cloneAsset(asset: CacheAsset) {
  return JSON.parse(JSON.stringify(asset)) as CacheAsset;
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

function posterExtension(sourceUrl?: string, responseContentType?: string | null) {
  if (responseContentType?.includes("webp")) {
    return ".webp";
  }
  if (responseContentType?.includes("png")) {
    return ".png";
  }
  if (responseContentType?.includes("gif")) {
    return ".gif";
  }
  if (responseContentType?.includes("avif")) {
    return ".avif";
  }
  if (responseContentType?.includes("jpeg") || responseContentType?.includes("jpg")) {
    return ".jpg";
  }

  if (!sourceUrl) {
    return ".jpg";
  }

  try {
    const parsed = new URL(sourceUrl);
    const match = parsed.pathname.match(/\.(webp|png|jpe?g|gif|avif)$/i);
    return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
  } catch {
    const match = sourceUrl.match(/\.(webp|png|jpe?g|gif|avif)(?:[?#].*)?$/i);
    return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
  }
}

function posterContentType(sourceUrl?: string, responseContentType?: string | null) {
  if (responseContentType?.startsWith("image/")) {
    return responseContentType.split(";")[0] ?? responseContentType;
  }

  const extension = posterExtension(sourceUrl, responseContentType);
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".avif") {
    return "image/avif";
  }
  return "image/jpeg";
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

function blobNameForPoster(assetKey: string, index: number, sourceUrl?: string, contentType?: string | null) {
  return `posters/${encodeRowKey(assetKey)}/${String(index + 1).padStart(2, "0")}${posterExtension(sourceUrl, contentType)}`;
}

function isAzureBlobUrl(url: string) {
  return /^https:\/\/[^/?#]+\.blob\.core\.windows\.net\//i.test(url);
}

function firstBlobPosterUrl(posters: MoviePoster[]) {
  return posters.find((poster) => isAzureBlobUrl(poster.url))?.url;
}

function moviePosterCandidates(result: SearchResult) {
  return [
    ...(result.metadata?.posters ?? []),
    ...(result.metadata?.work?.media?.posters ?? [])
  ];
}

function parseHeaderNumber(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function mp4ProbeBytes() {
  const configured = Number(process.env.CACHE_MP4_PROBE_BYTES ?? defaultMp4ProbeBytes);
  if (!Number.isFinite(configured) || configured <= 0) {
    return defaultMp4ProbeBytes;
  }

  return Math.min(Math.max(Math.floor(configured), 64 * 1024), 16 * 1024 * 1024);
}

function uploadBlockBytes() {
  const configured = Number(process.env.CACHE_UPLOAD_BLOCK_BYTES ?? defaultUploadBlockBytes);
  if (!Number.isFinite(configured) || configured <= 0) {
    return defaultUploadBlockBytes;
  }

  return Math.min(Math.max(Math.floor(configured), 1024 * 1024), 64 * 1024 * 1024);
}

function isMp4Like(contentType?: string, blobName?: string) {
  const normalizedType = contentType?.toLowerCase() ?? "";
  return normalizedType.includes("mp4") ||
    normalizedType.includes("quicktime") ||
    /\.(mp4|m4v|mov)$/i.test(blobName ?? "");
}

function isPlausibleBoxType(type: string) {
  return /^[a-zA-Z0-9 ]{4}$/.test(type);
}

function readLargeBoxSize(buffer: Buffer, offset: number) {
  const value = buffer.readBigUInt64BE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }

  return Number(value);
}

function inspectMp4Probe(input: {
  buffer: Buffer;
  contentType?: string;
  blobName?: string;
}): Mp4Diagnostics {
  const { buffer, contentType, blobName } = input;
  const inspectedBytes = buffer.length;
  let offset = 0;
  let moovOffset: number | undefined;
  let mdatOffset: number | undefined;
  let sawMp4Box = false;

  while (offset + 8 <= buffer.length) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);

    if (!isPlausibleBoxType(type)) {
      break;
    }

    let headerSize = 8;
    let boxSize = size32;
    if (size32 === 1) {
      if (offset + 16 > buffer.length) {
        break;
      }
      const largeSize = readLargeBoxSize(buffer, offset + 8);
      if (!largeSize) {
        break;
      }
      headerSize = 16;
      boxSize = largeSize;
    } else if (size32 === 0) {
      boxSize = buffer.length - offset;
    }

    if (boxSize < headerSize) {
      break;
    }

    if (["ftyp", "moov", "mdat", "free", "wide", "uuid"].includes(type)) {
      sawMp4Box = true;
    }

    if (type === "moov") {
      moovOffset = offset;
    }

    if (type === "mdat") {
      mdatOffset = offset;
    }

    if (moovOffset !== undefined && mdatOffset !== undefined) {
      break;
    }

    if (offset + boxSize > buffer.length) {
      break;
    }

    offset += boxSize;
  }

  const maybeMp4 = sawMp4Box || isMp4Like(contentType, blobName);
  if (!maybeMp4) {
    return {
      status: "not_mp4",
      inspectedBytes,
      notes: "The cached blob does not look like an MP4/MOV container."
    };
  }

  if (moovOffset !== undefined && mdatOffset !== undefined) {
    return {
      status: moovOffset < mdatOffset ? "faststart" : "late_moov",
      inspectedBytes,
      moovOffset,
      mdatOffset
    };
  }

  if (moovOffset !== undefined) {
    return {
      status: "faststart",
      inspectedBytes,
      moovOffset,
      notes: "The moov box was found in the probe window before any mdat box."
    };
  }

  if (mdatOffset !== undefined) {
    return {
      status: "late_moov",
      inspectedBytes,
      mdatOffset,
      notes: "The mdat box was found before any moov box in the probe window."
    };
  }

  return {
    status: "unknown",
    inspectedBytes,
    notes: "No top-level moov/mdat boxes were found in the probe window."
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream | undefined) {
  if (!stream) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function cacheRemovalReason(asset: CacheAsset, now: Date) {
  if (isIdleReadyAsset(asset, now)) {
    return "idle";
  }

  return undefined;
}

function jobActivityTime(job: CacheJob) {
  return job.lastRequestedAt ?? job.updatedAt ?? job.createdAt;
}

function cacheAssetActivityTime(asset: CacheAsset) {
  return asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt;
}

function uploadProgress(bytesUploaded: number, contentLength?: number) {
  if (!contentLength || contentLength <= 0) {
    const estimated = uploadProgressStart + Math.floor(bytesUploaded / (64 * 1024 * 1024));
    return Math.min(uploadProgressEnd, estimated);
  }

  const span = uploadProgressEnd - uploadProgressStart;
  return Math.min(
    uploadProgressEnd,
    uploadProgressStart + Math.floor((bytesUploaded / contentLength) * span)
  );
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
  private readonly assetLookupCache = new Map<string, { expiresAt: number; asset?: CacheAsset }>();
  private userDelegationKeyCache?: {
    key: UserDelegationKey;
    startsOn: Date;
    expiresOn: Date;
  };

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

  async listCachedAssets(limit: number) {
    await this.ensureReady();
    const assets: CacheAsset[] = [];
    const entities = this.assetTable.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'asset'"
      }
    });

    for await (const entity of entities) {
      const asset = deserialize<CacheAsset>(entity);
      if (isFreshReady(asset)) {
        assets.push(asset);
      }
    }

    return assets
      .sort((left, right) => cacheAssetActivityTime(right).localeCompare(cacheAssetActivityTime(left)))
      .slice(0, limit);
  }

  async getAsset(assetKey: string, options: GetAssetOptions = {}) {
    await this.ensureReady();
    if (!options.fresh) {
      const cached = this.assetLookupCache.get(assetKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.asset ? cloneAsset(cached.asset) : undefined;
      }
    }

    try {
      const entity = await this.assetTable.getEntity<PayloadEntity>(
        "asset",
        encodeRowKey(assetKey)
      );
      const asset = deserialize<CacheAsset>(entity);
      this.cacheAssetLookup(assetKey, asset);
      return cloneAsset(asset);
    } catch (error) {
      if (isNotFound(error)) {
        this.cacheAssetLookup(assetKey, undefined);
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
    const existingAsset = await this.getAsset(result.assetKey, { fresh: true });
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
      sourceUrl: result.sourceUrl,
      sourcePageId: result.sourcePageId,
      sourceBreadcrumb: result.sourceBreadcrumb,
      ...sourceTraceFromResult(result)
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

  async listRecentJobs(limit: number) {
    await this.ensureReady();
    const jobs: CacheJob[] = [];
    const entities = this.jobTable.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'job'"
      }
    });

    for await (const entity of entities) {
      jobs.push(deserialize<CacheJob>(entity));
    }

    return jobs
      .sort((left, right) => jobActivityTime(right).localeCompare(jobActivityTime(left)))
      .slice(0, limit);
  }

  async retryJob(jobId: string, refreshedResult?: SearchResult) {
    await this.ensureReady();
    const job = await this.getJob(jobId);
    if (!job || job.status !== "failed") {
      return undefined;
    }

    const now = new Date().toISOString();
    const refreshedTrace = refreshedResult ? sourceTraceFromResult(refreshedResult) : undefined;
    const nextJob: CacheJob = {
      ...job,
      title: refreshedResult?.title ?? job.title,
      source: refreshedResult?.source ?? job.source,
      sourceUrl: refreshedResult?.sourceUrl ?? job.sourceUrl,
      sourcePageId: refreshedResult?.sourcePageId ?? job.sourcePageId,
      sourceBreadcrumb: refreshedResult?.sourceBreadcrumb ?? job.sourceBreadcrumb,
      sourceMediaBlockId: refreshedTrace?.sourceMediaBlockId ?? job.sourceMediaBlockId,
      sourceMediaAssetPageId: refreshedTrace?.sourceMediaAssetPageId ?? job.sourceMediaAssetPageId,
      status: "queued",
      progress: 0,
      message: "Waiting for a cache worker.",
      updatedAt: now,
      lastRequestedAt: now,
      completedAt: undefined,
      error: undefined,
      resolve: undefined
    };
    const asset: CacheAsset = {
      assetKey: nextJob.assetKey,
      title: nextJob.title,
      source: nextJob.source,
      status: "queued",
      jobId: nextJob.id,
      lastRequestedAt: now
    };

    await this.saveJob(nextJob);
    await this.saveAsset(asset);
    await this.queueClient.sendMessage(
      encodeQueueMessage({
        jobId: nextJob.id,
        assetKey: nextJob.assetKey
      })
    );

    return { job: nextJob, asset };
  }

  async deleteCacheEntry(input: DeleteCacheEntryInput): Promise<DeleteCacheEntryResult> {
    await this.ensureReady();
    const job = input.jobId ? await this.getJob(input.jobId) : undefined;
    const assetKey = input.assetKey ?? job?.assetKey;
    const asset = assetKey ? await this.getAsset(assetKey) : undefined;
    const jobId = input.jobId ?? asset?.jobId;
    const result: DeleteCacheEntryResult = {
      assetKey,
      jobId,
      deletedAsset: false,
      deletedJob: false,
      deletedBlob: false,
      errors: []
    };

    if (asset && (!input.jobId || asset.jobId === input.jobId)) {
      const deletion = await this.deleteAssetAndLinkedJob(asset, encodeRowKey(asset.assetKey), "admin");
      result.deletedAsset = deletion.deletedAsset;
      result.deletedBlob = deletion.deletedBlob;
      result.deletedJob = deletion.deletedJob;
      result.errors.push(...deletion.errors);
    }

    if (jobId && !result.deletedJob) {
      result.deletedJob = await this.deleteJobRecord(jobId, assetKey);
    }

    return result;
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
    this.cacheAssetLookup(asset.assetKey, asset);
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
    let media: MediaDiagnostics | undefined;

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

      const sourceContentType = sourceResponse.headers.get("content-type");
      const sourceContentLength = parseHeaderNumber(sourceResponse.headers.get("content-length"));
      const sourceAcceptRanges = sourceResponse.headers.get("accept-ranges") ?? undefined;
      const contentType = contentTypeFor(sourceUrl, sourceContentType);
      const upload = await this.uploadSourceToBlockBlob(blockBlob, {
        job,
        body: sourceResponse.body as ReadableStream<Uint8Array>,
        contentType,
        sourceContentLength,
        metadata: {
          assetkey: encodeRowKey(job.assetKey),
          jobid: job.id,
          resolver: job.resolve?.layer ?? "unknown"
        }
      });

      job.status = "processing";
      job.progress = Math.max(job.progress, playbackCheckProgress);
      job.message = "正在检查播放状态。";
      job.updatedAt = new Date().toISOString();
      await this.saveJob(job);

      media = await this.inspectCachedBlob(blockBlob, {
        job,
        blobName,
        contentType,
        sourceContentType: sourceContentType ?? undefined,
        sourceContentLength,
        sourceAcceptRanges
      });

      logInfo("cache.blob.upload_complete", {
        jobId: job.id,
        assetKey: job.assetKey,
        blobName,
        contentType: media?.contentType ?? contentType,
        contentLength: media?.contentLength,
        uploadedBytes: upload.bytesUploaded,
        blockCount: upload.blockCount,
        sourceContentLength,
        rangeSupported: media?.rangeSupported,
        mp4Status: media?.mp4?.status,
        moovOffset: media?.mp4?.moovOffset,
        mdatOffset: media?.mp4?.mdatOffset,
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

    const existingAsset = await this.getAsset(job.assetKey);
    const cachedAt = new Date();
    const asset: CacheAsset = {
      assetKey: job.assetKey,
      title: job.title,
      source: job.source,
      status: "ready",
      jobId: job.id,
      playbackUrl: `azure://${this.config.containerName}/${blobName}`,
      expiresAt: addDays(cachedAt, cacheAssetIdleTtlDays()).toISOString(),
      cachedAt: cachedAt.toISOString(),
      lastRequestedAt: job.createdAt,
      requestedByMemberId: existingAsset?.requestedByMemberId,
      requestedByMemberName: existingAsset?.requestedByMemberName,
      media
    };

    await this.saveAsset(asset);
    return asset;
  }

  async cacheMoviePosters(result: SearchResult, options: CacheMoviePostersOptions = {}) {
    await this.ensureReady();
    const metadata = result.metadata;
    const posters = moviePosterCandidates(result);
    if (!metadata || posters.length === 0) {
      return result;
    }

    const maxPosters = Math.max(0, Math.floor(this.config.posterMaxPerMovie));
    const visiblePosters = maxPosters > 0 ? posters.slice(0, maxPosters) : posters;
    let refreshedPosters: Promise<MoviePoster[] | undefined> | undefined;
    const refreshPosterSource = options.refreshPosters;
    const refreshPosters = refreshPosterSource
      ? () => {
        refreshedPosters ??= refreshPosterSource();
        return refreshedPosters;
      }
      : undefined;
    const cachedPosters = await Promise.all(
      visiblePosters.map((poster, index) => this.cacheMoviePoster(result.assetKey, poster, index, posters, refreshPosters))
    );
    await this.deleteStalePosterBlobs(
      result.assetKey,
      new Set(cachedPosters.map((poster) => poster.blobName).filter((blobName): blobName is string => Boolean(blobName)))
    );

    return {
      ...result,
      metadata: {
        ...metadata,
        posterUrl: firstBlobPosterUrl(cachedPosters),
        posters: cachedPosters
      }
    };
  }

  async hydrateMoviePosterUrls(result: SearchResult) {
    await this.ensureReady();
    const metadata = result.metadata;
    const posters = moviePosterCandidates(result);
    if (!metadata || posters.length === 0) {
      return result;
    }

    const expiresOn = new Date(Date.now() + this.config.posterSasMinutes * 60 * 1000);
    const hydratedPosters = await Promise.all(
      posters.map(async (poster) => {
        if (!poster.blobName) {
          return poster;
        }

        return {
          ...poster,
          source: "blob" as const,
          url: await this.createBlobReadUrl(poster.blobName, expiresOn)
        };
      })
    );

    return {
      ...result,
      metadata: {
        ...metadata,
        posterUrl: firstBlobPosterUrl(hydratedPosters),
        posters: hydratedPosters
      }
    };
  }

  private async cacheMoviePoster(
    assetKey: string,
    poster: MoviePoster,
    index: number,
    posters: MoviePoster[],
    refreshPosters?: () => Promise<MoviePoster[] | undefined>
  ): Promise<MoviePoster> {
    if (poster.blobName) {
      return poster;
    }

    const candidates = await posterDownloadCandidates({
      poster,
      index,
      posters
    });

    if (candidates.length === 0) {
      return poster;
    }

    let lastError: unknown;
    const triedUrls = new Set<string>();
    for (const candidate of candidates) {
      triedUrls.add(candidate.url);
      try {
        return await this.cacheMoviePosterFromUrl(assetKey, candidate.poster, index, candidate.url);
      } catch (error) {
        lastError = error;
      }
    }

    if (refreshPosters) {
      const refreshedCandidates = await posterDownloadCandidates({
        poster,
        index,
        posters,
        refreshPosters
      });

      for (const candidate of refreshedCandidates.filter((item) => !triedUrls.has(item.url))) {
        try {
          return await this.cacheMoviePosterFromUrl(assetKey, candidate.poster, index, candidate.url);
        } catch (error) {
          lastError = error;
        }
      }
    }

    logWarn("cache.poster.upload_failed", {
      assetKey,
      index,
      source: poster.source,
      ...errorLogFields(lastError)
    });
    return poster;
  }

  private async cacheMoviePosterFromUrl(
    assetKey: string,
    poster: MoviePoster,
    index: number,
    sourceUrl: string
  ): Promise<MoviePoster> {
    try {
      const response = await fetch(sourceUrl, {
        redirect: "follow",
        headers: posterRequestHeaders(sourceUrl)
      });

      if (!response.ok) {
        throw new Error(`Poster download failed with HTTP ${response.status}.`);
      }

      const sourceContentLength = parseHeaderNumber(response.headers.get("content-length"));
      if (sourceContentLength && sourceContentLength > this.config.posterMaxBytes) {
        throw new Error(`Poster is too large (${sourceContentLength} bytes).`);
      }

      const contentType = posterContentType(sourceUrl, response.headers.get("content-type"));
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length <= 0) {
        throw new Error("Poster download returned an empty file.");
      }
      if (buffer.length > this.config.posterMaxBytes) {
        throw new Error(`Poster is too large (${buffer.length} bytes).`);
      }

      const blobName = blobNameForPoster(assetKey, index, sourceUrl, contentType);
      const blockBlob = this.containerClient.getBlockBlobClient(blobName);
      await blockBlob.uploadData(buffer, {
        blobHTTPHeaders: {
          blobContentType: contentType
        },
        metadata: {
          assetkey: encodeRowKey(assetKey),
          posterindex: String(index + 1),
          source: poster.source
        }
      });

      return {
        ...poster,
        source: "blob",
        originalUrl: sourceUrl,
        url: sourceUrl,
        blobName,
        contentType,
        cachedAt: new Date().toISOString()
      };
    } catch (error) {
      throw error;
    }
  }

  private async deleteStalePosterBlobs(assetKey: string, currentBlobNames: Set<string>) {
    const prefix = `posters/${encodeRowKey(assetKey)}/`;
    for await (const blob of this.containerClient.listBlobsFlat({ prefix })) {
      if (currentBlobNames.has(blob.name)) {
        continue;
      }

      try {
        await this.containerClient.deleteBlob(blob.name, {
          deleteSnapshots: "include"
        });
        logInfo("cache.poster.stale_deleted", {
          assetKey,
          blobName: blob.name
        });
      } catch (error) {
        if (!isNotFound(error)) {
          logWarn("cache.poster.stale_delete_failed", {
            assetKey,
            blobName: blob.name,
            ...errorLogFields(error)
          });
        }
      }
    }
  }

  private async uploadSourceToBlockBlob(
    blockBlob: BlockBlobClient,
    input: {
      job: CacheJob;
      body: ReadableStream<Uint8Array>;
      contentType: string;
      sourceContentLength?: number;
      metadata: Record<string, string>;
    }
  ) {
    const blockSize = uploadBlockBytes();
    let bytesUploaded = 0;
    let lastSavedProgress = input.job.progress;
    let progressSave = Promise.resolve();

    const saveUploadProgress = async (force = false) => {
      const nextProgress = Math.max(
        input.job.progress,
        uploadProgress(bytesUploaded, input.sourceContentLength)
      );

      if (!force && nextProgress <= lastSavedProgress) {
        return;
      }

      input.job.status = "uploading";
      input.job.progress = nextProgress;
      input.job.message = "正在建立播放缓存。";
      input.job.updatedAt = new Date().toISOString();
      lastSavedProgress = nextProgress;
      await this.saveJob(input.job);
    };

    const queueProgressSave = (force = false) => {
      progressSave = progressSave.then(() => saveUploadProgress(force));
      return progressSave;
    };

    const progressTimer = setInterval(() => {
      void queueProgressSave();
    }, 3000);

    try {
      const sourceStream = Readable.fromWeb(input.body);
      await blockBlob.uploadStream(sourceStream, blockSize, 1, {
        blobHTTPHeaders: {
          blobContentType: input.contentType
        },
        metadata: input.metadata,
        onProgress: (event) => {
          bytesUploaded = event.loadedBytes;
        }
      });
    } finally {
      clearInterval(progressTimer);
      await queueProgressSave(true);
    }

    if (bytesUploaded <= 0) {
      throw new Error("Source returned an empty media file.");
    }

    return {
      bytesUploaded,
      blockCount: Math.ceil(bytesUploaded / blockSize)
    };
  }

  async getPlayback(assetKey: string) {
    await this.ensureReady();
    const asset = await this.getAsset(assetKey, { fresh: true });
    if (!isFreshReady(asset) || !asset?.playbackUrl) {
      return undefined;
    }

    const blobName = this.blobNameFromPlaybackUrl(asset.playbackUrl);
    if (!blobName) {
      return undefined;
    }

    if (!asset.media?.contentLength || asset.media.contentLength <= 0) {
      const blockBlob = this.containerClient.getBlockBlobClient(blobName);
      const job = asset.jobId ? await this.getJob(asset.jobId) : undefined;
      asset.media = await this.inspectCachedBlob(blockBlob, {
        job,
        blobName,
        contentType: asset.media?.contentType,
        sourceContentType: asset.media?.sourceContentType,
        sourceContentLength: asset.media?.sourceContentLength,
        sourceAcceptRanges: asset.media?.sourceAcceptRanges
      });
    }

    const playedAt = new Date();
    asset.lastPlayedAt = playedAt.toISOString();
    asset.expiresAt = addDays(playedAt, cacheAssetIdleTtlDays()).toISOString();
    await this.saveAsset(asset);

    const expiresOn = new Date(Date.now() + this.config.sasMinutes * 60 * 1000);
    return {
      assetKey: asset.assetKey,
      title: asset.title,
      playbackUrl: await this.createBlobReadUrl(blobName, expiresOn),
      expiresAt: expiresOn.toISOString(),
      media: asset.media
    };
  }

  async cleanupExpired(now = new Date()): Promise<CleanupExpiredResult> {
    await this.ensureReady();
    const result: CleanupExpiredResult = {
      scannedAssets: 0,
      expiredAssets: 0,
      idleExpiredAssets: 0,
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

      const removalReason = cacheRemovalReason(asset, now);
      if (!removalReason) {
        continue;
      }

      result.expiredAssets += 1;
      if (removalReason === "idle") {
        result.idleExpiredAssets += 1;
      }
      logInfo("cache.cleanup.expired_asset", {
        assetKey: asset.assetKey,
        jobId: asset.jobId,
        reason: removalReason,
        expiresAt: asset.expiresAt,
        idleReferenceAt: readyAssetIdleReference(asset)
      });
      const deletion = await this.deleteAssetAndLinkedJob(asset, entity.rowKey, "cleanup");
      result.deletedAssets += deletion.deletedAsset ? 1 : 0;
      result.deletedJobs += deletion.deletedJob ? 1 : 0;
      result.deletedBlobs += deletion.deletedBlob ? 1 : 0;
      result.errors.push(...deletion.errors);
    }

    return result;
  }

  private async inspectCachedBlob(
    blockBlob: BlockBlobClient,
    input: {
      job?: Pick<CacheJob, "id" | "assetKey">;
      blobName: string;
      contentType?: string;
      sourceContentType?: string;
      sourceContentLength?: number;
      sourceAcceptRanges?: string;
    }
  ): Promise<MediaDiagnostics> {
    const base: MediaDiagnostics = {
      checkedAt: new Date().toISOString(),
      blobName: input.blobName,
      contentType: input.contentType,
      sourceContentType: input.sourceContentType,
      sourceContentLength: input.sourceContentLength,
      sourceAcceptRanges: input.sourceAcceptRanges
    };

    try {
      const properties = await blockBlob.getProperties();
      const contentType = properties.contentType ?? input.contentType;
      const contentLength = properties.contentLength;
      const diagnostics: MediaDiagnostics = {
        ...base,
        contentType,
        contentLength
      };

      if (!contentLength || contentLength <= 0) {
        diagnostics.rangeSupported = false;
        diagnostics.mp4 = isMp4Like(contentType, input.blobName)
          ? {
            status: "unknown",
            inspectedBytes: 0,
            notes: "The cached blob is empty or did not report a content length."
          }
          : undefined;
        return diagnostics;
      }

      try {
        const probeLength = Math.min(mp4ProbeBytes(), contentLength);
        const probe = await blockBlob.download(0, probeLength);
        const buffer = await streamToBuffer(probe.readableStreamBody);
        diagnostics.rangeSupported = buffer.length > 0;
        diagnostics.mp4 = inspectMp4Probe({
          buffer,
          contentType,
          blobName: input.blobName
        });
      } catch (error) {
        diagnostics.rangeSupported = false;
        diagnostics.mp4 = isMp4Like(contentType, input.blobName)
          ? {
            status: "unknown",
            inspectedBytes: 0,
            notes: "The range probe failed before MP4 boxes could be inspected."
          }
          : undefined;
        logWarn("cache.blob.range_probe_failed", {
          jobId: input.job?.id,
          assetKey: input.job?.assetKey,
          blobName: input.blobName,
          ...errorLogFields(error)
        });
      }

      return diagnostics;
    } catch (error) {
      logWarn("cache.blob.diagnostics_failed", {
        jobId: input.job?.id,
        assetKey: input.job?.assetKey,
        blobName: input.blobName,
        ...errorLogFields(error)
      });
      return base;
    }
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

  private async deleteAssetAndLinkedJob(
    asset: CacheAsset,
    rowKey: string,
    reason: "admin" | "cleanup"
  ): Promise<DeleteCacheEntryResult> {
    const result: DeleteCacheEntryResult = {
      assetKey: asset.assetKey,
      jobId: asset.jobId,
      deletedAsset: false,
      deletedJob: false,
      deletedBlob: false,
      errors: []
    };
    const blobName = asset.playbackUrl ? this.blobNameFromPlaybackUrl(asset.playbackUrl) : undefined;
    let blobDeleted = true;

    if (blobName) {
      blobDeleted = false;
      try {
        await this.containerClient.deleteBlob(blobName, {
          deleteSnapshots: "include"
        });
        result.deletedBlob = true;
        blobDeleted = true;
        logInfo("cache.delete.blob_deleted", {
          assetKey: asset.assetKey,
          jobId: asset.jobId,
          blobName,
          reason
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
      return result;
    }

    try {
      await this.assetTable.deleteEntity("asset", rowKey);
      this.assetLookupCache.delete(asset.assetKey);
      result.deletedAsset = true;
      logInfo("cache.delete.asset_deleted", {
        assetKey: asset.assetKey,
        jobId: asset.jobId,
        reason
      });
    } catch (error) {
      if (!isNotFound(error)) {
        result.errors.push(`Could not delete asset ${asset.assetKey}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    if (!asset.jobId) {
      return result;
    }

    try {
      result.deletedJob = await this.deleteJobRecord(asset.jobId, asset.assetKey, reason);
    } catch (error) {
      result.errors.push(`Could not delete job ${asset.jobId}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    return result;
  }

  private async deleteJobRecord(jobId: string, assetKey?: string, reason: "admin" | "cleanup" = "admin") {
    try {
      await this.jobTable.deleteEntity("job", jobId);
      logInfo("cache.delete.job_deleted", {
        assetKey,
        jobId,
        reason
      });
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }

      throw error;
    }
  }

  private cacheAssetLookup(assetKey: string, asset: CacheAsset | undefined) {
    if (assetLookupCacheTtlMs <= 0 || !asset || asset.status !== "ready") {
      this.assetLookupCache.delete(assetKey);
      return;
    }

    this.assetLookupCache.set(assetKey, {
      expiresAt: Date.now() + assetLookupCacheTtlMs,
      asset: cloneAsset(asset)
    });
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
    const cached = this.userDelegationKeyCache;
    const refreshBeforeMs = 5 * 60 * 1000;
    if (
      cached &&
      cached.startsOn.getTime() <= startsOn.getTime() &&
      cached.expiresOn.getTime() >= expiresOn.getTime() + refreshBeforeMs
    ) {
      return cached.key;
    }

    const now = Date.now();
    const keyStartsOn = new Date(now - 5 * 60 * 1000);
    const minimumKeyExpiry = new Date(now + 25 * 60 * 60 * 1000);
    const keyExpiresOn = expiresOn.getTime() > minimumKeyExpiry.getTime()
      ? expiresOn
      : minimumKeyExpiry;
    const key = await this.blobService.getUserDelegationKey(keyStartsOn, keyExpiresOn);
    this.userDelegationKeyCache = {
      key,
      startsOn: keyStartsOn,
      expiresOn: keyExpiresOn
    };
    return key;
  }
}
