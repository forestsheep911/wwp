import type { CacheJob, SearchResult } from "@wwpdw/shared";

type SourceTraceMetadata = {
  mediaBlockId?: string;
  mediaAssetPageId?: string;
};

export function sourceTraceFromResult(result: Pick<SearchResult, "metadata">) {
  const metadata = (result.metadata ?? {}) as SourceTraceMetadata;
  return {
    sourceMediaBlockId: metadata.mediaBlockId,
    sourceMediaAssetPageId: metadata.mediaAssetPageId
  };
}

export function createJob(input: {
  assetKey: string;
  title: string;
  source: string;
  sourceUrl?: string;
  sourcePageId?: string;
  sourceBreadcrumb?: string[];
  sourceMediaBlockId?: string;
  sourceMediaAssetPageId?: string;
}): CacheJob {
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 8);

  return {
    id: `job_${Date.now()}_${suffix}`,
    assetKey: input.assetKey,
    title: input.title,
    source: input.source,
    sourceUrl: input.sourceUrl,
    sourcePageId: input.sourcePageId,
    sourceBreadcrumb: input.sourceBreadcrumb,
    sourceMediaBlockId: input.sourceMediaBlockId,
    sourceMediaAssetPageId: input.sourceMediaAssetPageId,
    status: "queued",
    progress: 0,
    message: "Waiting for a cache worker.",
    createdAt: now,
    updatedAt: now
  };
}

export function isFreshReady(asset?: {
  status: string;
  expiresAt?: string;
  playbackUrl?: string;
  cachedAt?: string;
  lastPlayedAt?: string;
  lastRequestedAt?: string;
}) {
  if (!asset || asset.status !== "ready" || !asset.playbackUrl) {
    return false;
  }

  if (asset.playbackUrl?.endsWith("/mock-cache.txt")) {
    return false;
  }

  return !isIdleReadyAsset(asset, new Date());
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function cacheAssetIdleTtlDays() {
  const value = Number(process.env.CACHE_ASSET_IDLE_TTL_DAYS ?? 7);
  return Number.isFinite(value) && value > 0 ? value : 7;
}

export function readyAssetIdleReference(asset: {
  cachedAt?: string;
  lastPlayedAt?: string;
  lastRequestedAt?: string;
}) {
  return asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt;
}

export function isIdleReadyAsset(
  asset: {
    status: string;
    cachedAt?: string;
    lastPlayedAt?: string;
    lastRequestedAt?: string;
  },
  now: Date
) {
  if (asset.status !== "ready") {
    return false;
  }

  const reference = readyAssetIdleReference(asset);
  if (!reference) {
    return false;
  }

  const referenceTime = new Date(reference).getTime();
  if (Number.isNaN(referenceTime)) {
    return false;
  }

  return now.getTime() - referenceTime >= cacheAssetIdleTtlDays() * 24 * 60 * 60 * 1000;
}

export function readyAssetExpiresAt(asset: {
  cachedAt?: string;
  lastPlayedAt?: string;
  lastRequestedAt?: string;
}) {
  const reference = readyAssetIdleReference(asset);
  if (!reference) {
    return undefined;
  }

  const referenceTime = new Date(reference);
  if (Number.isNaN(referenceTime.getTime())) {
    return undefined;
  }

  return addDays(referenceTime, cacheAssetIdleTtlDays()).toISOString();
}
