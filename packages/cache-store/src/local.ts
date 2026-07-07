import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type CacheAsset,
  type CacheJob,
  type CacheStatus,
  type LocalCacheState,
  type SearchResult,
  emptyCacheState
} from "@wwpdw/shared";
import {
  addDays,
  cacheAssetIdleTtlDays,
  createJob,
  isFreshReady,
  isIdleReadyAsset,
  sourceTraceFromResult
} from "./jobs.js";
import type { CacheStore, CleanupExpiredResult, DeleteCacheEntryInput, DeleteCacheEntryResult } from "./types.js";

const terminalStatuses: CacheStatus[] = ["ready", "failed"];

function jobActivityTime(job: CacheJob) {
  return job.lastRequestedAt ?? job.updatedAt ?? job.createdAt;
}

function cacheAssetActivityTime(asset: CacheAsset) {
  return asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt;
}

function cacheRemovalReason(asset: CacheAsset, now: Date) {
  if (isIdleReadyAsset(asset, now)) {
    return "idle";
  }

  return undefined;
}

export class LocalCacheStore implements CacheStore {
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

  async listAssets(assetKeys: string[]) {
    const state = await this.readState();
    return Object.fromEntries(
      assetKeys
        .map((assetKey) => [assetKey, state.assets[assetKey]] as const)
        .filter((entry): entry is readonly [string, CacheAsset] => Boolean(entry[1]))
    );
  }

  async listCachedAssets(limit: number) {
    const state = await this.readState();
    return Object.values(state.assets)
      .filter((asset) => isFreshReady(asset))
      .sort((left, right) => cacheAssetActivityTime(right).localeCompare(cacheAssetActivityTime(left)))
      .slice(0, limit);
  }

  async getAsset(assetKey: string) {
    const state = await this.readState();
    return state.assets[assetKey];
  }

  async getJob(jobId: string) {
    const state = await this.readState();
    return state.jobs[jobId];
  }

  async ensureCache(result: SearchResult) {
    return this.updateState((state) => {
      const existingAsset = state.assets[result.assetKey];
      const existingJob = existingAsset?.jobId ? state.jobs[existingAsset.jobId] : undefined;

      if (isFreshReady(existingAsset) && existingJob) {
        existingAsset.lastRequestedAt = new Date().toISOString();
        return { asset: existingAsset, job: existingJob };
      }

      if (existingAsset && existingJob && !terminalStatuses.includes(existingJob.status)) {
        existingAsset.lastRequestedAt = new Date().toISOString();
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

      state.jobs[job.id] = job;
      state.assets[result.assetKey] = asset;

      return { asset, job };
    });
  }

  async syncQueue() {
    return;
  }

  async listActiveJobs(limit: number) {
    const state = await this.readState();
    return Object.values(state.jobs)
      .filter((job) => !terminalStatuses.includes(job.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async listRecentJobs(limit: number) {
    const state = await this.readState();
    return Object.values(state.jobs)
      .sort((left, right) => jobActivityTime(right).localeCompare(jobActivityTime(left)))
      .slice(0, limit);
  }

  async retryJob(jobId: string, refreshedResult?: SearchResult) {
    return this.updateState((state) => {
      const job = state.jobs[jobId];
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

      state.jobs[nextJob.id] = nextJob;
      state.assets[nextJob.assetKey] = asset;
      return { job: nextJob, asset };
    });
  }

  async deleteCacheEntry(input: DeleteCacheEntryInput): Promise<DeleteCacheEntryResult> {
    return this.updateState((state) => {
      const job = input.jobId ? state.jobs[input.jobId] : undefined;
      const assetKey = input.assetKey ?? job?.assetKey;
      const asset = assetKey ? state.assets[assetKey] : undefined;
      const jobId = input.jobId ?? asset?.jobId;
      const result: DeleteCacheEntryResult = {
        assetKey,
        jobId,
        deletedAsset: false,
        deletedJob: false,
        deletedBlob: false,
        errors: []
      };

      if (assetKey && asset && (!input.jobId || asset.jobId === input.jobId)) {
        delete state.assets[assetKey];
        result.deletedAsset = true;
      }

      if (jobId && state.jobs[jobId]) {
        delete state.jobs[jobId];
        result.deletedJob = true;
      }

      return result;
    });
  }

  async saveJob(job: CacheJob) {
    await this.updateState((state) => {
      state.jobs[job.id] = job;
    });
  }

  async saveAsset(asset: CacheAsset) {
    await this.updateState((state) => {
      state.assets[asset.assetKey] = asset;
    });
  }

  async finalizeReadyAsset(job: CacheJob) {
    const existingAsset = await this.getAsset(job.assetKey);
    const cachedAt = new Date().toISOString();
    const asset: CacheAsset = {
      assetKey: job.assetKey,
      title: job.title,
      source: job.source,
      status: "ready",
      jobId: job.id,
      playbackUrl: `mock://cached-videos/${encodeURIComponent(job.assetKey)}`,
      expiresAt: addDays(new Date(cachedAt), cacheAssetIdleTtlDays()).toISOString(),
      cachedAt,
      lastRequestedAt: job.createdAt,
      requestedByMemberId: existingAsset?.requestedByMemberId,
      requestedByMemberName: existingAsset?.requestedByMemberName,
      media: {
        checkedAt: new Date().toISOString(),
        contentType: "application/x-wwpdw-mock",
        blobName: `mock://cached-videos/${encodeURIComponent(job.assetKey)}`,
        rangeSupported: false,
        mp4: {
          status: "not_mp4",
          inspectedBytes: 0,
          notes: "Local mock playback does not create a real media blob."
        }
      }
    };

    await this.saveAsset(asset);
    return asset;
  }

  async cacheMoviePosters(result: SearchResult) {
    return result;
  }

  async hydrateMoviePosterUrls(result: SearchResult) {
    return result;
  }

  async getPlayback(assetKey: string) {
    const asset = await this.getAsset(assetKey);
    if (!isFreshReady(asset) || !asset?.playbackUrl) {
      return undefined;
    }

    const playedAt = new Date();
    asset.lastPlayedAt = playedAt.toISOString();
    asset.expiresAt = addDays(playedAt, cacheAssetIdleTtlDays()).toISOString();
    await this.saveAsset(asset);

    return {
      assetKey: asset.assetKey,
      title: asset.title,
      playbackUrl: asset.playbackUrl,
      expiresAt: asset.expiresAt,
      media: asset.media
    };
  }

  async cleanupExpired(now = new Date()): Promise<CleanupExpiredResult> {
    return this.updateState((state) => {
      const result: CleanupExpiredResult = {
        scannedAssets: 0,
        expiredAssets: 0,
        idleExpiredAssets: 0,
        deletedAssets: 0,
        deletedJobs: 0,
        deletedBlobs: 0,
        errors: []
      };

      for (const [assetKey, asset] of Object.entries(state.assets)) {
        result.scannedAssets += 1;
        const removalReason = cacheRemovalReason(asset, now);
        if (!removalReason) {
          continue;
        }

        result.expiredAssets += 1;
        if (removalReason === "idle") {
          result.idleExpiredAssets += 1;
        }
        delete state.assets[assetKey];
        result.deletedAssets += 1;

        if (asset.jobId && state.jobs[asset.jobId]) {
          delete state.jobs[asset.jobId];
          result.deletedJobs += 1;
        }
      }

      return result;
    });
  }

  private async readState(): Promise<LocalCacheState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as LocalCacheState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return emptyCacheState();
      }
      throw error;
    }
  }

  private async writeState(state: LocalCacheState): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }

  private async updateState<T>(mutator: (state: LocalCacheState) => T | Promise<T>) {
    const state = await this.readState();
    const result = await mutator(state);
    await this.writeState(state);
    return result;
  }
}
