import assert from "node:assert/strict";
import test from "node:test";

import {
  checkedOssObjectKey,
  isExpiredOssJob,
  ossIdleReference,
  type OssCleanupJob
} from "./oss-cleanup.js";

function job(overrides: Partial<OssCleanupJob> = {}): OssCleanupJob {
  return {
    id: "job-1",
    assetKey: "asset-1",
    title: "Movie",
    sourceUrl: "https://private.example/source",
    objectKey: "wwpdw/prepared/a.mp4",
    taskId: "task-1",
    status: "ready",
    progress: 100,
    message: "准备完成",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-02T00:00:00.000Z",
    ...overrides
  };
}

test("OSS cleanup uses last playback before completion and creation times", () => {
  const candidate = job({
    lastPlayedAt: "2026-01-05T00:00:00.000Z",
    expiresAt: "2026-01-12T00:00:00.000Z"
  });
  assert.equal(ossIdleReference(candidate), "2026-01-05T00:00:00.000Z");
  assert.equal(isExpiredOssJob(candidate, new Date("2026-01-11T23:59:59.000Z"), 7), false);
  assert.equal(isExpiredOssJob(candidate, new Date("2026-01-12T00:00:00.000Z"), 7), true);
});

test("OSS cleanup ignores non-ready and recently completed jobs", () => {
  assert.equal(isExpiredOssJob(job({ status: "running", expiresAt: "2026-01-03T00:00:00.000Z" }), new Date("2026-02-01T00:00:00.000Z"), 7), false);
  assert.equal(isExpiredOssJob(job({ expiresAt: "2026-01-09T00:00:00.000Z" }), new Date("2026-01-08T23:59:59.000Z"), 7), false);
  assert.equal(isExpiredOssJob(job(), new Date("2026-02-01T00:00:00.000Z"), 7), false);
});

test("OSS cleanup refuses keys outside the configured prefix", () => {
  assert.equal(checkedOssObjectKey("wwpdw/prepared/a.mp4", "wwpdw/prepared"), "wwpdw/prepared/a.mp4");
  assert.throws(() => checkedOssObjectKey("wwpdw/poc/a.mp4", "wwpdw/prepared"), /Refusing/);
  assert.throws(() => checkedOssObjectKey("wwpdw/prepared/../secret", "wwpdw/prepared"), /Refusing/);
});
