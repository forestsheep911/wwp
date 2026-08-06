import { randomUUID } from "node:crypto";
import { TableClient, type TableEntityResult } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import OSS from "ali-oss";

const partitionKey = "oss-prepare";
const claimStaleMs = 60 * 60 * 1000;

export interface OssCleanupJob {
  id: string;
  assetKey: string;
  title: string;
  sourceUrl: string;
  objectKey: string;
  taskId: string;
  status: string;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastPlayedAt?: string;
  expiresAt?: string;
  cleanupClaimedAt?: string;
  cleanupClaimToken?: string;
}

export interface OssCleanupResult {
  enabled: boolean;
  dryRun: boolean;
  scannedJobs: number;
  expiredJobs: number;
  untrackedJobs: number;
  backfilledJobs: number;
  claimedJobs: number;
  deletedObjects: number;
  deletedJobs: number;
  skippedRaces: number;
  errors: string[];
}

interface CleanupOptions {
  now?: Date;
  ttlDays?: number;
  dryRun?: boolean;
  table?: TableClient;
  oss?: Pick<OSS, "delete">;
  objectPrefix?: string;
}

function positiveDays(value: unknown, fallback = 7) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function enabled(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function ossIdleReference(job: OssCleanupJob) {
  return job.lastPlayedAt ?? job.completedAt ?? job.createdAt;
}

export function isExpiredOssJob(job: OssCleanupJob, now: Date, ttlDays: number) {
  if (job.status !== "ready") return false;
  if (!job.expiresAt) return false;
  const expiresAtMs = new Date(job.expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime();
}

export function checkedOssObjectKey(objectKey: string, objectPrefix: string) {
  const prefix = `${objectPrefix.replace(/^\/+|\/+$/g, "")}/`;
  const normalized = objectKey.replace(/^\/+/, "");
  if (!prefix || !normalized.startsWith(prefix) || normalized.includes("..")) {
    throw new Error(`Refusing to clean OSS object outside ${prefix}`);
  }
  return normalized;
}

function parseJob(entity: TableEntityResult<Record<string, unknown>>) {
  const job = JSON.parse(String(entity.payload)) as OssCleanupJob;
  if (!job.id || !job.objectKey) throw new Error("OSS preparation row has an invalid payload.");
  return job;
}

function tableEntity(job: OssCleanupJob) {
  return {
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
  };
}

function isPreconditionFailure(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 412;
}

function createTableClient() {
  const tableName = process.env.AZURE_STORAGE_OSS_PREPARATION_TABLE ?? "osspreparejobs";
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) return TableClient.fromConnectionString(connectionString, tableName);
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!accountName) throw new Error("OSS cleanup is missing AZURE_STORAGE_ACCOUNT_NAME.");
  return new TableClient(
    `https://${accountName}.table.core.windows.net`,
    tableName,
    new DefaultAzureCredential()
  );
}

function createOssClient() {
  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  const region = process.env.ALIYUN_OSS_REGION;
  const bucket = process.env.ALIYUN_OSS_BUCKET;
  const missing = [
    !accessKeyId ? "ALIBABA_CLOUD_ACCESS_KEY_ID" : undefined,
    !accessKeySecret ? "ALIBABA_CLOUD_ACCESS_KEY_SECRET" : undefined,
    !region ? "ALIYUN_OSS_REGION" : undefined,
    !bucket ? "ALIYUN_OSS_BUCKET" : undefined
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`OSS cleanup is missing ${missing.join(", ")}.`);
  return new OSS({
    accessKeyId: accessKeyId!,
    accessKeySecret: accessKeySecret!,
    region: region!,
    bucket: bucket!,
    endpoint: process.env.ALIYUN_OSS_ENDPOINT,
    secure: true
  });
}

async function clearClaim(table: TableClient, id: string, token: string) {
  try {
    const entity = await table.getEntity<Record<string, unknown>>(partitionKey, id);
    const job = parseJob(entity);
    if (job.cleanupClaimToken !== token) return;
    const restored = { ...job };
    delete restored.cleanupClaimedAt;
    delete restored.cleanupClaimToken;
    await table.updateEntity(tableEntity(restored), "Replace", { etag: entity.etag });
  } catch {
    // A later run can safely recover an old claim or a row whose object is already absent.
  }
}

export async function cleanupExpiredOssPreparations(options: CleanupOptions = {}): Promise<OssCleanupResult> {
  const cleanupEnabled = options.table !== undefined
    || options.oss !== undefined
    || enabled(process.env.ALIYUN_OSS_CLEANUP_ENABLED);
  const dryRun = options.dryRun ?? enabled(process.env.ALIYUN_OSS_CLEANUP_DRY_RUN, true);
  const result: OssCleanupResult = {
    enabled: cleanupEnabled,
    dryRun,
    scannedJobs: 0,
    expiredJobs: 0,
    untrackedJobs: 0,
    backfilledJobs: 0,
    claimedJobs: 0,
    deletedObjects: 0,
    deletedJobs: 0,
    skippedRaces: 0,
    errors: []
  };
  if (!cleanupEnabled) return result;

  const now = options.now ?? new Date();
  const ttlDays = positiveDays(options.ttlDays ?? process.env.ALIYUN_OSS_CLEANUP_IDLE_TTL_DAYS);
  const objectPrefix = options.objectPrefix ?? process.env.ALIYUN_OSS_OBJECT_PREFIX ?? "wwpdw/prepared";
  const table = options.table ?? createTableClient();
  const oss = options.oss ?? createOssClient();
  const entities = table.listEntities<Record<string, unknown>>({
    queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
  });

  for await (const entity of entities) {
    result.scannedJobs += 1;
    let job: OssCleanupJob;
    try {
      job = parseJob(entity);
      if (job.status === "ready" && !job.expiresAt) {
        result.untrackedJobs += 1;
        if (!dryRun) {
          const expiresAt = new Date(now);
          expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);
          const backfilled = { ...job, expiresAt: expiresAt.toISOString() };
          try {
            await table.updateEntity(tableEntity(backfilled), "Replace", { etag: entity.etag });
            result.backfilledJobs += 1;
          } catch (error) {
            if (isPreconditionFailure(error)) result.skippedRaces += 1;
            else throw error;
          }
        }
        continue;
      }
      if (!isExpiredOssJob(job, now, ttlDays)) continue;
      checkedOssObjectKey(job.objectKey, objectPrefix);
      const claimedMs = job.cleanupClaimedAt ? new Date(job.cleanupClaimedAt).getTime() : 0;
      if (claimedMs && now.getTime() - claimedMs < claimStaleMs) {
        result.skippedRaces += 1;
        continue;
      }
      result.expiredJobs += 1;
      if (dryRun) continue;

      const claimToken = randomUUID();
      const claimedJob = {
        ...job,
        cleanupClaimedAt: now.toISOString(),
        cleanupClaimToken: claimToken
      };
      try {
        await table.updateEntity(tableEntity(claimedJob), "Replace", { etag: entity.etag });
      } catch (error) {
        if (isPreconditionFailure(error)) {
          result.skippedRaces += 1;
          continue;
        }
        throw error;
      }
      result.claimedJobs += 1;

      const confirmed = await table.getEntity<Record<string, unknown>>(partitionKey, job.id);
      const confirmedJob = parseJob(confirmed);
      if (confirmedJob.cleanupClaimToken !== claimToken) {
        result.skippedRaces += 1;
        continue;
      }

      try {
        await oss.delete(checkedOssObjectKey(job.objectKey, objectPrefix));
        result.deletedObjects += 1;
      } catch (error) {
        const status = (error as { status?: number; statusCode?: number }).status
          ?? (error as { statusCode?: number }).statusCode;
        if (status !== 404) {
          await clearClaim(table, job.id, claimToken);
          throw error;
        }
      }
      await table.deleteEntity(partitionKey, job.id, { etag: confirmed.etag });
      result.deletedJobs += 1;
    } catch (error) {
      result.errors.push(`${entity.rowKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
