import assert from "node:assert/strict";
import test from "node:test";

import { createJob, sourceTraceFromResult } from "./jobs.js";

test("sourceTraceFromResult extracts Media Assets block identifiers", () => {
  const trace = sourceTraceFromResult({
    metadata: {
      mediaBlockId: "block-1",
      mediaAssetPageId: "asset-page-1"
    } as never
  });

  assert.deepEqual(trace, {
    sourceMediaBlockId: "block-1",
    sourceMediaAssetPageId: "asset-page-1"
  });
});

test("createJob stores Media Assets block identifiers for retries", () => {
  const job = createJob({
    assetKey: "asset-1",
    title: "Movie / Variant",
    source: "Notion library",
    sourceUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/file.mp4",
    sourcePageId: "page-1",
    sourceMediaBlockId: "block-1",
    sourceMediaAssetPageId: "asset-page-1"
  });

  assert.equal(job.sourceMediaBlockId, "block-1");
  assert.equal(job.sourceMediaAssetPageId, "asset-page-1");
});
