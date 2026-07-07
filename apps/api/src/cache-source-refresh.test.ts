import assert from "node:assert/strict";
import test from "node:test";

import {
  refreshAssetInputFromJob,
  refreshAssetInputFromResult
} from "./cache-source-refresh.js";

test("refreshAssetInputFromResult carries Media Assets block identifiers", () => {
  const input = refreshAssetInputFromResult({
    assetKey: "asset-1",
    title: "Movie / Variant",
    source: "Notion library",
    sourceUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/old.mp4",
    sourcePageId: "page-1",
    sourceBreadcrumb: ["Movie", "Variant"],
    durationLabel: "--",
    updatedAt: "2026-07-07T00:00:00.000Z",
    summary: "Structured Media Assets row.",
    metadata: {
      mediaBlockId: "block-1",
      mediaAssetPageId: "asset-page-1"
    } as never
  });

  assert.deepEqual(input, {
    assetKey: "asset-1",
    sourcePageId: "page-1",
    title: "Movie / Variant",
    sourceBreadcrumb: ["Movie", "Variant"],
    mediaBlockId: "block-1",
    mediaAssetPageId: "asset-page-1"
  });
});

test("refreshAssetInputFromJob uses stored block identifiers and result hints", () => {
  const input = refreshAssetInputFromJob(
    {
      id: "job-1",
      assetKey: "asset-1",
      title: "Movie / Variant",
      source: "Notion library",
      sourceUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/old.mp4",
      sourcePageId: "page-1",
      sourceBreadcrumb: ["Movie", "Variant"],
      sourceMediaBlockId: "block-from-job",
      status: "failed",
      progress: 24,
      message: "failed",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z"
    },
    {
      assetKey: "asset-1",
      title: "Movie / Variant",
      source: "Notion library",
      sourceUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/old.mp4",
      sourcePageId: "page-1",
      sourceBreadcrumb: ["Movie", "Variant"],
      durationLabel: "--",
      updatedAt: "2026-07-07T00:00:00.000Z",
      summary: "Structured Media Assets row.",
      metadata: {
        mediaBlockId: "block-from-result",
        mediaAssetPageId: "asset-page-from-result"
      } as never
    }
  );

  assert.equal(input.mediaBlockId, "block-from-job");
  assert.equal(input.mediaAssetPageId, "asset-page-from-result");
});
