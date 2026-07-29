import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OssPreparationStore, type OssPreparationJob } from "./oss-preparation-store.js";

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
    assert.equal((await store.list())[0].assetKey, "asset-1");
    await store.delete("job-1");
    assert.equal(await store.get("job-1"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
