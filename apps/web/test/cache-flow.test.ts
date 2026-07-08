import assert from "node:assert/strict";
import test from "node:test";

import type { CacheAsset, MediaVariant, SearchResult } from "@wwpdw/shared";
import {
  latestVariantAsset,
  mergeCacheAssetIntoResults,
  pendingCacheStatusLabel,
  variantIsPlaybackReady,
  variantToCacheTarget
} from "../src/cinema/cache-flow";

function baseResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    assetKey: "movie",
    title: "测试影片",
    source: "Notion library",
    sourceUrl: "https://example.local/movie",
    durationLabel: "",
    updatedAt: "2026-07-08T00:00:00.000Z",
    summary: "",
    metadata: {
      description: "Movie metadata"
    },
    ...overrides
  };
}

function readyAsset(assetKey: string): CacheAsset {
  return {
    assetKey,
    title: "测试影片 / 版本",
    source: "Notion library",
    status: "ready",
    jobId: "job-1",
    playbackUrl: "azure://cached-videos/test.mp4",
    expiresAt: "2026-07-15T00:00:00.000Z",
    cachedAt: "2026-07-08T00:00:00.000Z",
    lastRequestedAt: "2026-07-08T00:00:00.000Z"
  };
}

test("variantToCacheTarget carries Media Assets block identifiers", () => {
  const variant: MediaVariant = {
    assetKey: "movie-variant",
    label: "字幕 简中 1.16GB",
    sourceUrl: "https://example.local/movie-variant.mp4",
    sourcePageId: "media-page",
    sourceBreadcrumb: ["测试影片", "字幕 简中 1.16GB"],
    kind: "file",
    summary: "Structured Media Assets row.",
    metadata: {
      mediaBlockId: "block-1",
      mediaAssetPageId: "asset-page-1",
      structuredSource: "media_assets"
    }
  };

  const target = variantToCacheTarget(baseResult(), variant);

  assert.equal(target.assetKey, "movie-variant");
  assert.equal(target.sourcePageId, "media-page");
  assert.equal((target.metadata as { mediaBlockId?: string }).mediaBlockId, "block-1");
  assert.equal((target.metadata as { mediaAssetPageId?: string }).mediaAssetPageId, "asset-page-1");
  assert.equal(target.metadata?.description, "Movie metadata");
});

test("mergeCacheAssetIntoResults updates a nested variant cache entry", () => {
  const result = baseResult({
    variants: [
      {
        assetKey: "movie-variant",
        label: "字幕 简中 1.16GB",
        sourceUrl: "https://example.local/movie-variant.mp4",
        kind: "file",
        summary: "Structured Media Assets row.",
        cache: {
          assetKey: "movie-variant",
          title: "测试影片 / 版本",
          source: "Notion library",
          status: "uploading",
          jobId: "job-1",
          lastRequestedAt: "2026-07-08T00:00:00.000Z"
        }
      }
    ]
  });

  const merged = mergeCacheAssetIntoResults([result], readyAsset("movie-variant"));

  assert.equal(merged[0]?.variants?.[0]?.cache?.status, "ready");
  assert.equal(merged[0]?.variants?.[0]?.cache?.playbackUrl, "azure://cached-videos/test.mp4");
  assert.notEqual(merged[0]?.variants?.[0], result.variants?.[0]);
});

test("latestVariantAsset prefers tracked ready assets over stale variant cache", () => {
  const staleVariant: MediaVariant = {
    assetKey: "movie-variant",
    label: "字幕 简中 1.16GB",
    sourceUrl: "https://example.local/movie-variant.mp4",
    kind: "file",
    summary: "Structured Media Assets row.",
    cache: {
      assetKey: "movie-variant",
      title: "测试影片 / 版本",
      source: "Notion library",
      status: "uploading",
      jobId: "job-1",
      lastRequestedAt: "2026-07-08T00:00:00.000Z"
    }
  };
  const tracked = {
    job: {
      id: "job-1",
      assetKey: "movie-variant",
      title: "测试影片 / 版本",
      source: "Notion library",
      status: "ready" as const,
      progress: 100,
      message: "可以播放。",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z"
    },
    asset: readyAsset("movie-variant")
  };

  assert.equal(latestVariantAsset(staleVariant, tracked)?.status, "ready");
  assert.equal(variantIsPlaybackReady(staleVariant, tracked), true);
});

test("pendingCacheStatusLabel shows immediate zero-progress feedback", () => {
  assert.equal(pendingCacheStatusLabel(), "\u6392\u961f\u4e2d 0%");
});
