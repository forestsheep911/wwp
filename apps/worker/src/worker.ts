import {
  type CacheAsset,
  type CacheJob,
  type CacheStatus,
  type LocalCacheState
} from "@wwpdw/shared";
import { getStatePath, readState, writeState } from "./localState.js";

const pollMs = Number(process.env.WORKER_POLL_MS ?? 900);
const maxConcurrent = Number(process.env.WORKER_MAX_CONCURRENT ?? 2);

const terminalStatuses: CacheStatus[] = ["ready", "failed"];

const stages: Array<{
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
    to: "downloading",
    delayMs: 1400,
    progress: 30,
    message: "Copying the source video into the cache lane."
  },
  {
    from: "downloading",
    to: "processing",
    delayMs: 2400,
    progress: 62,
    message: "Preparing the playable rendition."
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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function ensureAsset(state: LocalCacheState, job: CacheJob): CacheAsset {
  state.assets[job.assetKey] ??= {
    assetKey: job.assetKey,
    title: job.title,
    source: job.source,
    status: job.status,
    jobId: job.id,
    lastRequestedAt: job.createdAt
  };

  return state.assets[job.assetKey];
}

function syncAsset(asset: CacheAsset, job: CacheJob) {
  asset.status = job.status;
  asset.jobId = job.id;

  if (job.status === "ready") {
    const now = new Date();
    asset.playbackUrl = `mock://cached-videos/${encodeURIComponent(job.assetKey)}`;
    asset.expiresAt = addDays(now, 30).toISOString();
  }
}

function advanceJob(state: LocalCacheState, job: CacheJob, now: Date) {
  const stage = stages.find((item) => item.from === job.status);
  if (!stage) {
    return false;
  }

  const elapsed = now.getTime() - new Date(job.updatedAt).getTime();
  if (elapsed < stage.delayMs) {
    return false;
  }

  job.status = stage.to;
  job.progress = stage.progress;
  job.message = stage.message;
  job.updatedAt = now.toISOString();

  if (job.status === "ready") {
    job.completedAt = job.updatedAt;
  }

  const asset = ensureAsset(state, job);
  syncAsset(asset, job);

  console.log(`[worker] ${job.id} -> ${job.status} (${job.progress}%)`);
  return true;
}

async function tick() {
  const state = await readState();
  const now = new Date();
  const activeJobs = Object.values(state.jobs)
    .filter((job) => !terminalStatuses.includes(job.status))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, maxConcurrent);

  let changed = false;
  for (const job of activeJobs) {
    changed = advanceJob(state, job, now) || changed;
  }

  if (changed) {
    await writeState(state);
  }
}

console.log(`WWPDW worker watching ${getStatePath()}`);
console.log(`Worker concurrency: ${maxConcurrent}`);

tick().catch((error) => {
  console.error("[worker] initial tick failed", error);
});

setInterval(() => {
  tick().catch((error) => {
    console.error("[worker] tick failed", error);
  });
}, pollMs);
