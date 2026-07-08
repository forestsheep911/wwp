import type { CacheAsset, MediaVariant, SearchResult } from "@wwpdw/shared";
import { copy } from "./i18n";
import type { ResultWithCache, TrackedCacheItem } from "./types";

type CacheTraceMetadata = {
  mediaBlockId?: string;
  mediaAssetPageId?: string;
};

function variantCacheTrace(variant: MediaVariant): CacheTraceMetadata {
  return {
    mediaBlockId: variant.metadata?.mediaBlockId,
    mediaAssetPageId: variant.metadata?.mediaAssetPageId
  };
}

function metadataWithVariantTrace(result: SearchResult, variant: MediaVariant) {
  const trace = variantCacheTrace(variant);
  if (!trace.mediaBlockId && !trace.mediaAssetPageId) {
    return result.metadata;
  }

  return {
    ...result.metadata,
    ...trace
  };
}

export function variantToCacheTarget(result: SearchResult, variant: MediaVariant): SearchResult {
  return {
    assetKey: variant.assetKey,
    title: `${result.title} / ${variant.label}`,
    source: result.source,
    sourceUrl: variant.sourceUrl,
    sourcePageId: variant.sourcePageId ?? result.sourcePageId,
    sourceBreadcrumb: variant.sourceBreadcrumb ?? result.sourceBreadcrumb,
    durationLabel: result.durationLabel,
    updatedAt: result.updatedAt,
    summary: variant.summary,
    metadata: metadataWithVariantTrace(result, variant)
  };
}

export function latestVariantAsset(variant: MediaVariant, tracked?: TrackedCacheItem) {
  return tracked?.asset ?? variant.cache;
}

export function variantIsPlaybackReady(variant: MediaVariant, tracked?: TrackedCacheItem) {
  return latestVariantAsset(variant, tracked)?.status === "ready";
}

export function trackedCacheNeedsStatusRefresh(item?: TrackedCacheItem) {
  if (!item || item.job.status === "failed") {
    return false;
  }

  if (item.job.status === "ready") {
    return item.asset?.status !== "ready";
  }

  return true;
}

export function pendingCacheStatusLabel() {
  return `${copy.cache.status.queued} 0%`;
}

export function mergeCacheAssetIntoResults<T extends ResultWithCache>(results: T[], asset?: CacheAsset): T[] {
  if (!asset) {
    return results;
  }

  let changed = false;
  const nextResults = results.map((result) => {
    const nextVariants = result.variants?.map((variant) => {
      if (variant.assetKey !== asset.assetKey) {
        return variant;
      }

      changed = true;
      return {
        ...variant,
        cache: asset
      };
    });

    if (result.assetKey === asset.assetKey) {
      changed = true;
      return {
        ...result,
        cache: asset,
        variants: nextVariants
      };
    }

    if (nextVariants && nextVariants !== result.variants) {
      return {
        ...result,
        variants: nextVariants
      };
    }

    return result;
  });

  return changed ? nextResults : results;
}
