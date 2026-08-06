import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OssPreparationCleanupClaimedError,
  OssPreparationStore,
  type OssPreparationJob
} from "./oss-preparation-store.js";

test("local OSS preparation store persists jobs without exposing the source URL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wwpdw-oss-store-"));
  try {
    const store = new OssPreparationStore({ backend: "local", localDataDir: directory });
    const job: OssPreparationJob = {
      id: "job-1",
      assetKey: "asset-1",
      title: "Movie",
      sourceUrl: "https://signed.example/private",
      objectKey: "wwpdw/prepared/a.mp4",
      taskId: "wwpdw-job-1",
      status: "queued",
      progress: 5,
      message: "正在排队",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    await store.put(job);
    assert.equal((await store.get("job-1"))?.sourceUrl, job.sourceUrl);
    assert.equal("sourceUrl" in store.toPublic(job), false);
    const played = await store.markPlayed(
      "job-1",
      "2026-01-02T00:00:00.000Z",
      "2026-01-09T00:00:00.000Z"
    );
    assert.equal(played?.lastPlayedAt, "2026-01-02T00:00:00.000Z");
    assert.equal(played?.expiresAt, "2026-01-09T00:00:00.000Z");
    assert.equal((await store.list())[0].assetKey, "asset-1");
    await store.delete("job-1");
    assert.equal(await store.get("job-1"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("OSS preparation playback cannot race a cleanup claim", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wwpdw-oss-store-"));
  try {
    const store = new OssPreparationStore({ backend: "local", localDataDir: directory });
    await store.put({
      id: "job-claimed",
      assetKey: "asset-claimed",
      title: "Movie",
      sourceUrl: "https://signed.example/private",
      objectKey: "wwpdw/prepared/claimed.mp4",
      taskId: "wwpdw-job-claimed",
      status: "ready",
      progress: 100,
      message: "准备完成",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.000Z",
      cleanupClaimedAt: "2026-01-10T00:00:00.000Z"
    });
    await assert.rejects(
      store.markPlayed("job-claimed", "2026-01-10T00:00:01.000Z", "2026-01-17T00:00:01.000Z"),
      OssPreparationCleanupClaimedError
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
