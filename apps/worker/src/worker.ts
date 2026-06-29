import { randomUUID } from "node:crypto";
import {
  durationMs,
  errorLogFields,
  logError,
  logInfo,
  type CacheAsset,
  type CacheJob,
  type CacheStatus
} from "@wwpdw/shared";
import { createCacheStore } from "@wwpdw/cache-store";
import { resolveJobSource } from "./resolver.js";

const pollMs = Number(process.env.WORKER_POLL_MS ?? 900);
const maxConcurrent = Number(process.env.WORKER_MAX_CONCURRENT ?? 2);
const workerMode = process.env.WORKER_MODE ?? "daemon";
const oneShotMaxTicks = Number(process.env.WORKER_ONESHOT_MAX_TICKS ?? 30);
const store = createCacheStore();
const workerRunId = randomUUID();

const terminalStatuses: CacheStatus[] = ["ready", "failed"];

const timedStages: Array<{
  from: CacheStatus;
  to: CacheStatus;
  delayMs: number;
  progress: number;
  message: string;
}> = [
  {
    from: "queued",
    to: "fetching",
    delayMs: 500,
    progress: 10,
    message: "Fetching source metadata."
  },
  {
    from: "fetching",
    to: "fetching",
    delayMs: 900,
    progress: 18,
    message: "Resolving the media source."
  },
  {
    from: "downloading",
    to: "processing",
    delayMs: 2400,
    progress: 62,
    message: "Copying the resolved media into the cache lane."
  },
  {
    from: "processing",
    to: "uploading",
    delayMs: 1800,
    progress: 84,
    message: "Publishing the cached asset."
  },
  {
    from: "uploading",
    to: "ready",
    delayMs: 1200,
    progress: 100,
    message: "Ready for playback."
  }
];

async function getOrCreateAsset(job: CacheJob): Promise<CacheAsset> {
  const existing = await store.getAsset(job.assetKey);
  return existing ?? {
    assetKey: job.assetKey,
    title: job.title,
    source: job.source,
    status: job.status,
    jobId: job.id,
    lastRequestedAt: job.createdAt
  };
}

async function syncAsset(job: CacheJob) {
  const asset = await getOrCreateAsset(job);
  asset.status = job.status;
  asset.jobId = job.id;

  if (job.status === "failed") {
    asset.playbackUrl = undefined;
    asset.expiresAt = undefined;
  }

  await store.saveAsset(asset);
}

async function persistJob(job: CacheJob) {
  await store.saveJob(job);
  await syncAsset(job);
}

async function completeReadyJob(job: CacheJob, now: Date) {
  const startedAt = Date.now();
  job.progress = Math.max(job.progress, 92);
  job.message = "Uploading the resolved media into Blob cache.";
  job.updatedAt = now.toISOString();
  await persistJob(job);

  logInfo("worker.job.upload_start", {
    workerRunId,
    jobId: job.id,
    assetKey: job.assetKey,
    status: job.status,
    progress: job.progress,
    resolverLayer: job.resolve?.layer,
    resolveKind: job.resolve?.kind
  });

  try {
    await store.finalizeReadyAsset(job);

    const completedAt = new Date().toISOString();
    job.status = "ready";
    job.progress = 100;
    job.message = "Ready for playback.";
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    job.error = undefined;
    await store.saveJob(job);

    logInfo("worker.job.ready", {
      workerRunId,
      jobId: job.id,
      assetKey: job.assetKey,
      status: job.status,
      progress: job.progress,
      durationMs: durationMs(startedAt)
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    job.status = "failed";
    job.progress = Math.max(job.progress, 92);
    job.message = error instanceof Error ? error.message : "Failed to cache the resolved media.";
    job.error = job.message;
    job.updatedAt = failedAt;
    job.completedAt = failedAt;
    await persistJob(job);

    logError("worker.job.failed", {
      workerRunId,
      jobId: job.id,
      assetKey: job.assetKey,
      status: job.status,
      progress: job.progress,
      durationMs: durationMs(startedAt),
      ...errorLogFields(error)
    });
  }

  return true;
}

async function resolveJob(job: CacheJob, now: Date) {
  const startedAt = Date.now();
  const resolve = await resolveJobSource({
    assetKey: job.assetKey,
    sourceUrl: job.sourceUrl
  });
  job.resolve = resolve;
  job.updatedAt = now.toISOString();

  if (resolve.kind === "direct_file" && resolve.url) {
    job.status = "downloading";
    job.progress = 30;
    job.message = `Resolved by ${resolve.layer} resolver.`;
  } else {
    job.status = "failed";
    job.progress = Math.max(job.progress, 18);
    job.error = resolve.reason ?? "The source could not be resolved into a media file.";
    job.message = job.error;
    job.completedAt = job.updatedAt;
  }

  await persistJob(job);
  logInfo("worker.job.resolve", {
    workerRunId,
    jobId: job.id,
    assetKey: job.assetKey,
    status: job.status,
    progress: job.progress,
    resolverLayer: resolve.layer,
    resolveKind: resolve.kind,
    confidence: resolve.confidence,
    reason: resolve.reason,
    durationMs: durationMs(startedAt)
  });
  return true;
}

async function advanceJob(job: CacheJob, now: Date) {
  const stage = timedStages.find((item) => item.from === job.status);
  if (!stage) {
    return false;
  }

  const elapsed = now.getTime() - new Date(job.updatedAt).getTime();
  if (elapsed < stage.delayMs) {
    return false;
  }

  if (job.status === "fetching") {
    return resolveJob(job, now);
  }

  if (stage.to === "ready") {
    return completeReadyJob(job, now);
  }

  job.status = stage.to;
  job.progress = stage.progress;
  job.message = stage.message;
  job.updatedAt = now.toISOString();

  await persistJob(job);

  logInfo("worker.job.stage", {
    workerRunId,
    jobId: job.id,
    assetKey: job.assetKey,
    status: job.status,
    progress: job.progress
  });
  return true;
}

async function tick() {
  const now = new Date();
  await store.syncQueue(maxConcurrent);
  const activeJobs = await store.listActiveJobs(maxConcurrent);

  let changed = false;
  for (const job of activeJobs) {
    if (!terminalStatuses.includes(job.status)) {
      changed = (await advanceJob(job, now)) || changed;
    }
  }

  return {
    activeCount: activeJobs.length,
    changed
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runOneShot() {
  logInfo("worker.oneshot.start", {
    workerRunId,
    oneShotMaxTicks
  });

  for (let tickIndex = 0; tickIndex < oneShotMaxTicks; tickIndex += 1) {
    const result = await tick();
    if (result.activeCount > 0 || result.changed) {
      logInfo("worker.tick", {
        workerRunId,
        tickIndex,
        activeCount: result.activeCount,
        changed: result.changed
      });
    }
    if (result.activeCount === 0) {
      logInfo("worker.oneshot.idle_exit", {
        workerRunId,
        tickIndex
      });
      return;
    }
    await sleep(pollMs);
  }

  logInfo("worker.oneshot.tick_limit_exit", {
    workerRunId,
    oneShotMaxTicks
  });
}

async function runDaemon() {
  logInfo("worker.daemon.start", {
    workerRunId
  });

  tick().catch((error) => {
    logError("worker.tick.failed", {
      workerRunId,
      phase: "initial",
      ...errorLogFields(error)
    });
  });

  setInterval(() => {
    tick().catch((error) => {
      logError("worker.tick.failed", {
        workerRunId,
        phase: "interval",
        ...errorLogFields(error)
      });
    });
  }, pollMs);
}

async function runCleanup() {
  const startedAt = Date.now();
  logInfo("worker.cleanup.start", {
    workerRunId
  });
  const result = await store.cleanupExpired();
  logInfo("worker.cleanup.summary", {
    workerRunId,
    scannedAssets: result.scannedAssets,
    expiredAssets: result.expiredAssets,
    deletedAssets: result.deletedAssets,
    deletedBlobs: result.deletedBlobs,
    deletedJobs: result.deletedJobs,
    errorCount: result.errors.length,
    durationMs: durationMs(startedAt)
  });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      logError("worker.cleanup.error", {
        workerRunId,
        errorMessage: error
      });
    }
    throw new Error(`Cleanup completed with ${result.errors.length} error(s).`);
  }
}

logInfo("worker.start", {
  workerRunId,
  mode: workerMode,
  store: store.description,
  maxConcurrent
});

if (workerMode === "cleanup") {
  try {
    await runCleanup();
    process.exit(0);
  } catch (error) {
    logError("worker.cleanup.failed", {
      workerRunId,
      ...errorLogFields(error)
    });
    process.exit(1);
  }
} else if (workerMode === "oneshot") {
  try {
    await runOneShot();
    process.exit(0);
  } catch (error) {
    logError("worker.oneshot.failed", {
      workerRunId,
      ...errorLogFields(error)
    });
    process.exit(1);
  }
} else {
  void runDaemon();
}
