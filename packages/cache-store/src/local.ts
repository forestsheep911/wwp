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
import { addDays, cacheAssetTtlDays, createJob, isFreshReady } from "./jobs.js";
import type { CacheStore, CleanupExpiredResult } from "./types.js";

const terminalStatuses: CacheStatus[] = ["ready", "failed"];

function isExpiredReadyAsset(asset: CacheAsset, now: Date) {
  return asset.status === "ready" &&
    Boolean(asset.expiresAt) &&
    new Date(asset.expiresAt ?? "").getTime() <= now.getTime();
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
    const asset: CacheAsset = {
      assetKey: job.assetKey,
      title: job.title,
      source: job.source,
      status: "ready",
      jobId: job.id,
      playbackUrl: `mock://cached-videos/${encodeURIComponent(job.assetKey)}`,
      expiresAt: addDays(new Date(), cacheAssetTtlDays()).toISOString(),
      lastRequestedAt: job.createdAt,
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

  async getPlayback(assetKey: string) {
    const asset = await this.getAsset(assetKey);
    if (!isFreshReady(asset) || !asset?.playbackUrl || !asset.expiresAt) {
      return undefined;
    }

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
        deletedAssets: 0,
        deletedJobs: 0,
        deletedBlobs: 0,
        errors: []
      };

      for (const [assetKey, asset] of Object.entries(state.assets)) {
        result.scannedAssets += 1;
        if (!isExpiredReadyAsset(asset, now)) {
          continue;
        }

        result.expiredAssets += 1;
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
