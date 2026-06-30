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
const runningJobIds = new Set<string>();
let tickInFlight = false;

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
    delayMs: 300,
    progress: 8,
    message: "正在准备片源。"
  },
  {
    from: "fetching",
    to: "fetching",
    delayMs: 700,
    progress: 16,
    message: "正在确认可播放版本。"
  },
  {
    from: "downloading",
    to: "uploading",
    delayMs: 0,
    progress: 24,
    message: "正在建立播放缓存。"
  },
  {
    from: "uploading",
    to: "ready",
    delayMs: 0,
    progress: 100,
    message: "可以播放。"
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
    asset.media = undefined;
  }

  await store.saveAsset(asset);
}

async function persistJob(job: CacheJob) {
  await store.saveJob(job);
  await syncAsset(job);
}

async function completeReadyJob(job: CacheJob, now: Date) {
  const startedAt = Date.now();
  job.status = "uploading";
  job.progress = Math.max(job.progress, 24);
  job.message = "正在建立播放缓存。";
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
    const asset = await store.finalizeReadyAsset(job);

    const completedAt = new Date().toISOString();
    job.status = "ready";
    job.progress = 100;
    job.message = "可以播放。";
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
      contentType: asset.media?.contentType,
      contentLength: asset.media?.contentLength,
      rangeSupported: asset.media?.rangeSupported,
      mp4Status: asset.media?.mp4?.status,
      moovOffset: asset.media?.mp4?.moovOffset,
      durationMs: durationMs(startedAt)
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    job.status = "failed";
    job.progress = Math.max(job.progress, 24);
    job.error = error instanceof Error ? error.message : "Failed to cache the resolved media.";
    job.message = "准备失败。";
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
    job.status = "uploading";
    job.progress = 24;
    job.message = "正在建立播放缓存。";
  } else {
    job.status = "failed";
    job.progress = Math.max(job.progress, 18);
    job.error = resolve.reason ?? "The source could not be resolved into a media file.";
    job.message = "未能确认可播放片源。";
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

async function advanceJobOnce(job: CacheJob, now: Date) {
  if (runningJobIds.has(job.id)) {
    return false;
  }

  runningJobIds.add(job.id);
  try {
    return await advanceJob(job, now);
  } finally {
    runningJobIds.delete(job.id);
  }
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

  const changes = await Promise.all(
    activeJobs.map((job) =>
      terminalStatuses.includes(job.status)
        ? Promise.resolve(false)
        : advanceJobOnce(job, now)
    )
  );

  return {
    activeCount: activeJobs.length,
    changed: changes.some(Boolean)
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

  void runTickSafely("initial");

  setInterval(() => {
    void runTickSafely("interval");
  }, pollMs);
}

async function runTickSafely(phase: "initial" | "interval") {
  if (tickInFlight) {
    logInfo("worker.tick.skipped_overlap", {
      workerRunId,
      phase
    });
    return;
  }

  tickInFlight = true;
  try {
    await tick();
  } catch (error) {
    logError("worker.tick.failed", {
      workerRunId,
      phase,
      ...errorLogFields(error)
    });
  } finally {
    tickInFlight = false;
  }
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
    idleExpiredAssets: result.idleExpiredAssets,
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
