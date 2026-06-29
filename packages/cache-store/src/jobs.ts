import type { CacheJob } from "@wwpdw/shared";

export function createJob(input: {
  assetKey: string;
  title: string;
  source: string;
  sourceUrl?: string;
}): CacheJob {
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 8);

  return {
    id: `job_${Date.now()}_${suffix}`,
    assetKey: input.assetKey,
    title: input.title,
    source: input.source,
    sourceUrl: input.sourceUrl,
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
}) {
  if (!asset || asset.status !== "ready" || !asset.expiresAt) {
    return false;
  }

  if (asset.playbackUrl?.endsWith("/mock-cache.txt")) {
    return false;
  }

  return new Date(asset.expiresAt).getTime() > Date.now();
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function cacheAssetTtlDays() {
  const value = Number(process.env.CACHE_ASSET_TTL_DAYS ?? 30);
  return Number.isFinite(value) && value > 0 ? value : 30;
}
