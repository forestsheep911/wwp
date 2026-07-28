import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync
} from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import {
  type CacheAsset,
  type CacheJob,
  type CacheStatus,
  type LocalCacheState,
  type MediaDiagnostics,
  type MoviePoster,
  type Mp4Diagnostics,
  type SearchResult,
  emptyCacheState
} from "@wwpdw/shared";
import {
  addDays,
  cacheAssetIdleTtlDays,
  createJob,
  isFreshReady,
  isIdleReadyAsset,
  sourceTraceFromResult
} from "./jobs.js";
import {
  durationMs,
  errorLogFields,
  logError,
  logInfo
} from "@wwpdw/shared";
import { posterDownloadCandidates, posterRequestHeaders } from "./poster-cache.js";
import type {
  CacheMoviePostersOptions,
  CacheStore,
  CleanupExpiredResult,
  DeleteCacheEntryInput,
  DeleteCacheEntryResult,
  LocalMediaFile,
  LocalPosterFile
} from "./types.js";

const terminalStatuses: CacheStatus[] = ["ready", "failed"];
const filesystemPrefix = "filesystem://";
const uploadProgressStart = 24;
const uploadProgressEnd = 90;
const execFileAsync = promisify(execFile);
const hlsSegmentPattern = /^segment-\d{5}\.m4s$/;

type HlsPlaybackBuilder = (sourcePath: string, targetDirectory: string) => Promise<void>;

interface FilesystemCacheStoreOptions {
  hlsPlaybackBuilder?: HlsPlaybackBuilder;
}

async function buildHlsPlayback(sourcePath: string, targetDirectory: string) {
  const startedAt = Date.now();
  const buildingDirectory = `${targetDirectory}-building`;
  const manifestPath = path.join(buildingDirectory, "index.m3u8");
  await rm(buildingDirectory, { recursive: true, force: true });
  await mkdir(buildingDirectory, { recursive: true });

  try {
    const videoCodec = await probeVideoCodecName(sourcePath);
    const codecTagArguments = videoCodec === "hevc" ? ["-tag:v", "hvc1"] : [];
    await execFileAsync(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        ...codecTagArguments,
        "-hls_time",
        "6",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_type",
        "fmp4",
        "-hls_fmp4_init_filename",
        "init.mp4",
        "-hls_segment_filename",
        "segment-%05d.m4s",
        "-hls_flags",
        "independent_segments+temp_file",
        "index.m3u8"
      ],
      {
        cwd: buildingDirectory,
        timeout: Math.max(60_000, configuredBytes("WWPDW_HLS_PREPARE_TIMEOUT_MS", 30 * 60_000)),
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    );

    const [manifest, files, initMetadata] = await Promise.all([
      readFile(manifestPath, "utf8"),
      readdir(buildingDirectory),
      stat(path.join(buildingDirectory, "init.mp4"))
    ]);
    const segments = files.filter((file) => hlsSegmentPattern.test(file));
    if (
      !manifest.startsWith("#EXTM3U")
      || !manifest.includes("#EXT-X-ENDLIST")
      || !initMetadata.isFile()
      || initMetadata.size <= 0
      || segments.length === 0
    ) {
      throw new Error("Generated HLS output did not pass validation.");
    }
    const firstSegment = await stat(path.join(buildingDirectory, segments[0]!));
    if (!firstSegment.isFile() || firstSegment.size <= 0) {
      throw new Error("Generated HLS output contains an empty segment.");
    }

    await rm(targetDirectory, { recursive: true, force: true });
    await rename(buildingDirectory, targetDirectory);
    logInfo("cache.filesystem.hls_ready", {
      segmentCount: segments.length,
      durationMs: durationMs(startedAt)
    });
  } catch (error) {
    await rm(buildingDirectory, { recursive: true, force: true }).catch(() => undefined);
    logError("cache.filesystem.hls_failed", {
      durationMs: durationMs(startedAt),
      ...errorLogFields(error)
    });
    throw new Error("本地播放分段生成失败，请稍后重试。");
  }
}

function configuredBytes(name: string, fallback: number) {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function mediaMaxBytes() {
  return configuredBytes("WWPDW_MEDIA_MAX_BYTES", 0);
}

function mediaMinFreeBytes() {
  return configuredBytes("WWPDW_MEDIA_MIN_FREE_BYTES", 20 * 1024 * 1024 * 1024);
}

async function probeDurationSeconds(filePath: string) {
  try {
    const { stdout } = await execFileAsync(
      process.env.FFPROBE_PATH ?? "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 15_000, windowsHide: true, maxBuffer: 64 * 1024 }
    );
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  } catch {
    return undefined;
  }
}

async function probeVideoCodecName(filePath: string) {
  try {
    const { stdout } = await execFileAsync(
      process.env.FFPROBE_PATH ?? "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 15_000, windowsHide: true, maxBuffer: 64 * 1024 }
    );
    return stdout.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function jobActivityTime(job: CacheJob) {
  return job.lastRequestedAt ?? job.updatedAt ?? job.createdAt;
}

function cacheAssetActivityTime(asset: CacheAsset) {
  return asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt;
}

function mediaExtension(sourceUrl?: string) {
  if (!sourceUrl) return ".mp4";
  try {
    const parsed = new URL(sourceUrl);
    const match = parsed.pathname.match(/\.(mp4|m4v|mov|webm)$/i);
    return match ? `.${match[1].toLowerCase()}` : ".mp4";
  } catch {
    const match = sourceUrl.match(/\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i);
    return match ? `.${match[1].toLowerCase()}` : ".mp4";
  }
}

function contentTypeFor(sourceUrl?: string, responseContentType?: string | null) {
  if (responseContentType?.startsWith("video/")) return responseContentType.split(";")[0] ?? responseContentType;
  const extension = mediaExtension(sourceUrl);
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  return "video/mp4";
}

function sourceIdentity(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return sourceUrl.split(/[?#]/, 1)[0] ?? sourceUrl;
  }
}

function parseContentLength(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseContentRangeTotal(value: string | null) {
  const match = value?.match(/\/(\d+)$/);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function probeBytes() {
  const configured = Number(process.env.CACHE_MP4_PROBE_BYTES ?? 4 * 1024 * 1024);
  return Math.min(Math.max(Number.isFinite(configured) ? Math.floor(configured) : 4 * 1024 * 1024, 64 * 1024), 16 * 1024 * 1024);
}

function inspectMp4(buffer: Buffer, contentType: string, fileName: string): Mp4Diagnostics {
  if (!contentType.includes("mp4") && !contentType.includes("quicktime") && !/\.(mp4|m4v|mov)$/i.test(fileName)) {
    return { status: "not_mp4", inspectedBytes: buffer.length };
  }

  let offset = 0;
  let moovOffset: number | undefined;
  let mdatOffset: number | undefined;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1 && offset + 16 <= buffer.length) {
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerSize || !/^[a-zA-Z0-9 ]{4}$/.test(type)) break;
    if (type === "moov") moovOffset = offset;
    if (type === "mdat") mdatOffset = offset;
    if (moovOffset !== undefined && mdatOffset !== undefined) break;
    if (offset + size > buffer.length) break;
    offset += size;
  }

  if (moovOffset !== undefined && mdatOffset !== undefined) {
    return {
      status: moovOffset < mdatOffset ? "faststart" : "late_moov",
      inspectedBytes: buffer.length,
      moovOffset,
      mdatOffset
    };
  }
  if (mdatOffset !== undefined) {
    return {
      status: "late_moov",
      inspectedBytes: buffer.length,
      mdatOffset,
      notes: "The media data starts before a moov box appears in the probe window."
    };
  }
  return {
    status: "unknown",
    inspectedBytes: buffer.length,
    moovOffset,
    notes: "The probe window did not contain enough top-level MP4 boxes."
  };
}

function assetDirectoryName(assetKey: string) {
  return createHash("sha256").update(assetKey, "utf8").digest("hex").slice(0, 32);
}

export function stablePosterIdentity(poster: MoviePoster) {
  const sourceUrl = poster.originalUrl ?? poster.url;
  if (poster.blobName) {
    return poster.blobName;
  }

  if (/(?:secure\.notion-static\.com|prod-files-secure\.s3\.)/i.test(sourceUrl)) {
    try {
      const parsed = new URL(sourceUrl);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return sourceUrl.split(/[?#]/, 1)[0] ?? sourceUrl;
    }
  }

  return sourceUrl;
}

export class FilesystemCacheStore implements CacheStore {
  readonly backend = "filesystem" as const;
  readonly description: string;
  private readonly root: string;
  private readonly mediaRoot: string;
  private readonly posterRoot: string;
  private readonly tempRoot: string;
  private readonly database: DatabaseSync;
  private readonly hlsPlaybackBuilder: HlsPlaybackBuilder;
  private readonly posterDownloads = new Map<string, Promise<MoviePoster>>();
  private readonly posterContainer = new BlobServiceClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME ?? "stwwcachee9219db7"}.blob.core.windows.net`,
    new DefaultAzureCredential()
  ).getContainerClient(process.env.AZURE_STORAGE_BLOB_CONTAINER ?? "cached-videos");

  constructor(rootDirectory: string, options: FilesystemCacheStoreOptions = {}) {
    this.root = path.resolve(rootDirectory);
    this.mediaRoot = path.join(this.root, "media");
    this.posterRoot = path.join(this.root, "posters");
    this.tempRoot = path.join(this.root, "tmp");
    this.hlsPlaybackBuilder = options.hlsPlaybackBuilder ?? buildHlsPlayback;
    const stateRoot = path.join(this.root, "state");
    mkdirSync(this.mediaRoot, { recursive: true });
    mkdirSync(this.posterRoot, { recursive: true });
    mkdirSync(this.tempRoot, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
    const databasePath = path.join(stateRoot, "cache.sqlite");
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS cache_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.database.prepare(`
      INSERT OR IGNORE INTO cache_state (id, payload, updated_at) VALUES (1, ?, ?)
    `).run(JSON.stringify(emptyCacheState()), new Date().toISOString());
    this.description = `filesystem:${this.root}`;
  }

  close() {
    this.database.close();
  }

  async getHealth() {
    let availableBytes: number | undefined;
    try {
      const { statfs } = await import("node:fs/promises");
      const fileSystem = await statfs(this.root);
      availableBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
    } catch {
      availableBytes = undefined;
    }
    return {
      backend: this.backend,
      root: this.root,
      mediaRoot: this.mediaRoot,
      posterRoot: this.posterRoot,
      mediaBytes: this.cachedMediaBytes(),
      mediaMaxBytes: mediaMaxBytes() || undefined,
      mediaMinFreeBytes: mediaMinFreeBytes(),
      availableBytes
    };
  }

  async listAssets(assetKeys: string[]) {
    const state = this.readState();
    return Object.fromEntries(
      assetKeys
        .map((assetKey) => [assetKey, state.assets[assetKey]] as const)
        .filter((entry): entry is readonly [string, CacheAsset] => Boolean(entry[1]))
    );
  }

  async listCachedAssets(limit: number) {
    return Object.values(this.readState().assets)
      .filter((asset) => isFreshReady(asset))
      .sort((left, right) => cacheAssetActivityTime(right).localeCompare(cacheAssetActivityTime(left)))
      .slice(0, limit);
  }

  async getAsset(assetKey: string) {
    return this.readState().assets[assetKey];
  }

  async getJob(jobId: string) {
    return this.readState().jobs[jobId];
  }

  async ensureCache(result: SearchResult) {
    return this.updateState((state) => {
      const existingAsset = state.assets[result.assetKey];
      const existingJob = existingAsset?.jobId ? state.jobs[existingAsset.jobId] : undefined;
      if (isFreshReady(existingAsset) && existingJob) {
        existingAsset.lastRequestedAt = new Date().toISOString();
        return { asset: existingAsset, job: existingJob };
      }
      if (existingAsset && existingJob && !terminalStatuses.includes(existingJob.status)) {
        existingAsset.lastRequestedAt = new Date().toISOString();
        return { asset: existingAsset, job: existingJob };
      }
      const job = createJob({
        assetKey: result.assetKey,
        title: result.title,
        source: result.source,
        sourceUrl: result.sourceUrl,
        sourcePageId: result.sourcePageId,
        sourceBreadcrumb: result.sourceBreadcrumb,
        ...sourceTraceFromResult(result)
      });
      const asset: CacheAsset = {
        assetKey: result.assetKey,
        title: result.title,
        source: result.source,
        status: "queued",
        jobId: job.id,
        lastRequestedAt: job.createdAt
      };
      state.jobs[job.id] = job;
      state.assets[result.assetKey] = asset;
      return { asset, job };
    });
  }

  async syncQueue() {
    return;
  }

  async listActiveJobs(limit: number) {
    return Object.values(this.readState().jobs)
      .filter((job) => !terminalStatuses.includes(job.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async listRecentJobs(limit: number) {
    return Object.values(this.readState().jobs)
      .sort((left, right) => jobActivityTime(right).localeCompare(jobActivityTime(left)))
      .slice(0, limit);
  }

  async retryJob(jobId: string, refreshedResult?: SearchResult) {
    return this.updateState((state) => {
      const job = state.jobs[jobId];
      if (!job || job.status !== "failed") return undefined;
      const now = new Date().toISOString();
      const refreshedTrace = refreshedResult ? sourceTraceFromResult(refreshedResult) : undefined;
      const nextJob: CacheJob = {
        ...job,
        title: refreshedResult?.title ?? job.title,
        source: refreshedResult?.source ?? job.source,
        sourceUrl: refreshedResult?.sourceUrl ?? job.sourceUrl,
        sourcePageId: refreshedResult?.sourcePageId ?? job.sourcePageId,
        sourceBreadcrumb: refreshedResult?.sourceBreadcrumb ?? job.sourceBreadcrumb,
        sourceMediaBlockId: refreshedTrace?.sourceMediaBlockId ?? job.sourceMediaBlockId,
        sourceMediaAssetPageId: refreshedTrace?.sourceMediaAssetPageId ?? job.sourceMediaAssetPageId,
        status: "queued",
        progress: 0,
        message: "Waiting for a cache worker.",
        updatedAt: now,
        lastRequestedAt: now,
        completedAt: undefined,
        error: undefined,
        resolve: undefined
      };
      const asset: CacheAsset = {
        assetKey: nextJob.assetKey,
        title: nextJob.title,
        source: nextJob.source,
        status: "queued",
        jobId: nextJob.id,
        lastRequestedAt: now
      };
      state.jobs[nextJob.id] = nextJob;
      state.assets[nextJob.assetKey] = asset;
      return { job: nextJob, asset };
    });
  }

  async deleteCacheEntry(input: DeleteCacheEntryInput): Promise<DeleteCacheEntryResult> {
    let mediaPath: string | undefined;
    const result = this.updateState((state) => {
      const job = input.jobId ? state.jobs[input.jobId] : undefined;
      const assetKey = input.assetKey ?? job?.assetKey;
      const asset = assetKey ? state.assets[assetKey] : undefined;
      const jobId = input.jobId ?? asset?.jobId;
      mediaPath = asset?.playbackUrl ? this.absolutePathFromUrl(asset.playbackUrl) : undefined;
      const output: DeleteCacheEntryResult = {
        assetKey,
        jobId,
        deletedAsset: false,
        deletedJob: false,
        deletedBlob: false,
        errors: []
      };
      if (assetKey && asset && (!input.jobId || asset.jobId === input.jobId)) {
        delete state.assets[assetKey];
        output.deletedAsset = true;
      }
      if (jobId && state.jobs[jobId]) {
        delete state.jobs[jobId];
        output.deletedJob = true;
      }
      return output;
    });
    if (mediaPath) {
      try {
        await rm(path.dirname(mediaPath), { recursive: true, force: true });
        result.deletedBlob = true;
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : "Failed to delete local media.");
      }
    }
    return result;
  }

  async saveJob(job: CacheJob) {
    this.updateState((state) => { state.jobs[job.id] = job; });
  }

  async saveAsset(asset: CacheAsset) {
    this.updateState((state) => { state.assets[asset.assetKey] = asset; });
  }

  async finalizeReadyAsset(job: CacheJob) {
    const sourceUrl = job.resolve?.url ?? job.sourceUrl;
    if (!sourceUrl) throw new Error("Resolved media URL is missing.");

    const directoryName = assetDirectoryName(job.assetKey);
    const extension = mediaExtension(sourceUrl);
    const relativePath = path.posix.join("media", directoryName, `cached${extension}`);
    const finalPath = path.join(this.root, ...relativePath.split("/"));
    const partialPath = path.join(this.tempRoot, `${directoryName}${extension}.partial`);
    const identityPath = `${partialPath}.source.json`;
    await mkdir(path.dirname(finalPath), { recursive: true });
    await mkdir(this.tempRoot, { recursive: true });

    const identity = sourceIdentity(sourceUrl);
    let existingIdentity: string | undefined;
    try {
      existingIdentity = JSON.parse(await readFile(identityPath, "utf8")).identity;
    } catch {
      existingIdentity = undefined;
    }
    if (existingIdentity !== identity) {
      await rm(partialPath, { force: true });
      await writeFile(identityPath, `${JSON.stringify({ identity })}\n`, "utf8");
    }

    const download = await this.downloadToPartial(job, sourceUrl, partialPath);
    await rm(finalPath, { force: true });
    await rename(partialPath, finalPath);
    await rm(identityPath, { force: true });

    job.status = "processing";
    job.progress = Math.max(job.progress, 94);
    job.message = "正在检查播放状态。";
    job.updatedAt = new Date().toISOString();
    await this.saveJob(job);

    const handle = await open(finalPath, "r");
    const probeLength = Math.min(download.bytes, probeBytes());
    const probe = Buffer.alloc(probeLength);
    let fingerprint: string;
    try {
      await handle.read(probe, 0, probeLength, 0);
      const fingerprintBytes = Math.min(download.bytes, 1024 * 1024);
      const first = probe.subarray(0, Math.min(probe.length, fingerprintBytes));
      const last = Buffer.alloc(fingerprintBytes);
      await handle.read(last, 0, last.length, Math.max(0, download.bytes - last.length));
      fingerprint = createHash("sha256")
        .update(String(download.bytes))
        .update(first)
        .update(last)
        .digest("hex");
    } finally {
      await handle.close();
    }
    const contentType = contentTypeFor(sourceUrl, download.contentType);
    const durationSeconds = await probeDurationSeconds(finalPath);
    job.progress = Math.max(job.progress, 96);
    job.message = "正在生成流畅播放分段。";
    job.updatedAt = new Date().toISOString();
    await this.saveJob(job);
    await this.hlsPlaybackBuilder(finalPath, path.join(path.dirname(finalPath), "hls"));
    const media: MediaDiagnostics = {
      checkedAt: new Date().toISOString(),
      contentType,
      contentLength: download.bytes,
      durationSeconds,
      fingerprint,
      blobName: relativePath,
      rangeSupported: true,
      sourceContentType: download.contentType,
      sourceContentLength: download.expectedBytes,
      sourceAcceptRanges: download.sourceAcceptRanges,
      mp4: inspectMp4(probe, contentType, finalPath)
    };
    const existingAsset = await this.getAsset(job.assetKey);
    const cachedAt = new Date();
    const asset: CacheAsset = {
      assetKey: job.assetKey,
      title: job.title,
      source: job.source,
      status: "ready",
      jobId: job.id,
      playbackUrl: `${filesystemPrefix}${relativePath}`,
      expiresAt: addDays(cachedAt, cacheAssetIdleTtlDays()).toISOString(),
      cachedAt: cachedAt.toISOString(),
      lastRequestedAt: job.createdAt,
      requestedByMemberId: existingAsset?.requestedByMemberId,
      requestedByMemberName: existingAsset?.requestedByMemberName,
      media
    };
    await this.saveAsset(asset);
    return asset;
  }

  async cacheMoviePosters(result: SearchResult, options: CacheMoviePostersOptions = {}) {
    const posters = result.metadata?.posters ?? [];
    if (posters.length === 0) return result;

    const cachedPosters = await Promise.all(posters.map(async (poster, index) => {
      try {
        return await this.cachePoster(poster, index, posters, options);
      } catch {
        return poster;
      }
    }));
    const localPoster = cachedPosters.find((poster) => poster.url.startsWith("/api/posters/"));
    return {
      ...result,
      metadata: {
        ...result.metadata,
        posterUrl: localPoster?.url ?? result.metadata?.posterUrl,
        posters: cachedPosters
      }
    };
  }

  async hydrateMoviePosterUrls(result: SearchResult) {
    return this.cacheMoviePosters(result);
  }

  async getPlayback(assetKey: string) {
    const asset = await this.getAsset(assetKey);
    if (!isFreshReady(asset) || !asset?.playbackUrl) return undefined;
    const absolutePath = this.absolutePathFromUrl(asset.playbackUrl);
    const hlsReady = absolutePath
      ? await stat(path.join(path.dirname(absolutePath), "hls", "index.m3u8"))
        .then((metadata) => metadata.isFile())
        .catch(() => false)
      : false;
    const playedAt = new Date();
    asset.lastPlayedAt = playedAt.toISOString();
    asset.expiresAt = addDays(playedAt, cacheAssetIdleTtlDays()).toISOString();
    await this.saveAsset(asset);
    return {
      assetKey: asset.assetKey,
      title: asset.title,
      playbackUrl: hlsReady
        ? `/api/hls/${encodeURIComponent(asset.assetKey)}/index.m3u8`
        : `/api/media/${encodeURIComponent(asset.assetKey)}.mp4`,
      expiresAt: asset.expiresAt,
      media: asset.media
    };
  }

  async getMediaFile(assetKey: string): Promise<LocalMediaFile | undefined> {
    const asset = await this.getAsset(assetKey);
    if (!isFreshReady(asset) || !asset?.playbackUrl) return undefined;
    const absolutePath = this.absolutePathFromUrl(asset.playbackUrl);
    if (!absolutePath) return undefined;
    try {
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) return undefined;
      return {
        absolutePath,
        contentLength: metadata.size,
        contentType: asset.media?.contentType ?? contentTypeFor(absolutePath)
      };
    } catch {
      return undefined;
    }
  }

  async getPosterFile(posterKey: string): Promise<LocalPosterFile | undefined> {
    if (!/^[a-f0-9]{32}$/.test(posterKey)) return undefined;
    const filePath = path.join(this.posterRoot, `${posterKey}.bin`);
    const metadataPath = path.join(this.posterRoot, `${posterKey}.json`);
    try {
      const [fileMetadata, storedMetadata] = await Promise.all([
        stat(filePath),
        readFile(metadataPath, "utf8").then((value) => JSON.parse(value) as { contentType?: string })
      ]);
      if (!fileMetadata.isFile()) return undefined;
      return {
        absolutePath: filePath,
        contentLength: fileMetadata.size,
        contentType: storedMetadata.contentType?.startsWith("image/")
          ? storedMetadata.contentType
          : "image/jpeg"
      };
    } catch {
      return undefined;
    }
  }

  async refreshMediaDiagnostics(assetKey: string) {
    const asset = await this.getAsset(assetKey);
    const mediaFile = await this.getMediaFile(assetKey);
    if (!asset || !mediaFile) return undefined;

    const handle = await open(mediaFile.absolutePath, "r");
    const probeLength = Math.min(mediaFile.contentLength, probeBytes());
    const probe = Buffer.alloc(probeLength);
    const fingerprintBytes = Math.min(mediaFile.contentLength, 1024 * 1024);
    const last = Buffer.alloc(fingerprintBytes);
    try {
      await handle.read(probe, 0, probe.length, 0);
      await handle.read(last, 0, last.length, Math.max(0, mediaFile.contentLength - last.length));
    } finally {
      await handle.close();
    }

    const fingerprint = createHash("sha256")
      .update(String(mediaFile.contentLength))
      .update(probe.subarray(0, Math.min(probe.length, fingerprintBytes)))
      .update(last)
      .digest("hex");
    asset.media = {
      ...asset.media,
      checkedAt: new Date().toISOString(),
      contentType: mediaFile.contentType,
      contentLength: mediaFile.contentLength,
      durationSeconds: await probeDurationSeconds(mediaFile.absolutePath),
      fingerprint,
      rangeSupported: true,
      mp4: inspectMp4(probe, mediaFile.contentType, mediaFile.absolutePath)
    };
    await this.saveAsset(asset);
    return asset;
  }

  async cleanupExpired(now = new Date()): Promise<CleanupExpiredResult> {
    const paths: string[] = [];
    const result = this.updateState((state) => {
      const output: CleanupExpiredResult = {
        scannedAssets: 0,
        expiredAssets: 0,
        idleExpiredAssets: 0,
        deletedAssets: 0,
        deletedJobs: 0,
        deletedBlobs: 0,
        errors: []
      };
      for (const [assetKey, asset] of Object.entries(state.assets)) {
        output.scannedAssets += 1;
        if (!isIdleReadyAsset(asset, now)) continue;
        output.expiredAssets += 1;
        output.idleExpiredAssets += 1;
        const mediaPath = asset.playbackUrl ? this.absolutePathFromUrl(asset.playbackUrl) : undefined;
        if (mediaPath) paths.push(path.dirname(mediaPath));
        delete state.assets[assetKey];
        output.deletedAssets += 1;
        if (asset.jobId && state.jobs[asset.jobId]) {
          delete state.jobs[asset.jobId];
          output.deletedJobs += 1;
        }
      }
      return output;
    });
    for (const directory of paths) {
      try {
        await rm(directory, { recursive: true, force: true });
        result.deletedBlobs += 1;
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : `Failed to delete ${directory}`);
      }
    }
    return result;
  }

  private async downloadToPartial(job: CacheJob, sourceUrl: string, partialPath: string) {
    let existingBytes = 0;
    try {
      existingBytes = (await stat(partialPath)).size;
    } catch {
      existingBytes = 0;
    }
    const headers: Record<string, string> = { "User-Agent": "wwpdw-home-cache-worker/0.1" };
    if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`;
    let response = await fetch(sourceUrl, { redirect: "follow", headers });
    if (response.status === 416 && existingBytes > 0) {
      await rm(partialPath, { force: true });
      existingBytes = 0;
      response = await fetch(sourceUrl, {
        redirect: "follow",
        headers: { "User-Agent": headers["User-Agent"] }
      });
    }
    if (!response.ok || !response.body) {
      throw new Error(`Source download failed with HTTP ${response.status}.`);
    }
    const appending = existingBytes > 0 && response.status === 206;
    if (!appending) existingBytes = 0;
    const expectedBytes =
      parseContentRangeTotal(response.headers.get("content-range")) ??
      ((parseContentLength(response.headers.get("content-length")) ?? 0) + existingBytes || undefined);
    await this.assertDownloadCapacity(expectedBytes, existingBytes);
    const cachedBytesAtStart = this.cachedMediaBytes();
    const file = await open(partialPath, appending ? "a" : "w");
    const reader = response.body.getReader();
    let bytes = existingBytes;
    let lastSavedAt = 0;
    let lastProgress = job.progress;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        await file.write(value);
        bytes += value.length;
        const maximumBytes = mediaMaxBytes();
        if (maximumBytes > 0 && cachedBytesAtStart + bytes * 2 > maximumBytes) {
          throw new Error(`Local media cache quota of ${maximumBytes} bytes would be exceeded.`);
        }
        const nextProgress = expectedBytes
          ? Math.min(uploadProgressEnd, uploadProgressStart + Math.floor((bytes / expectedBytes) * (uploadProgressEnd - uploadProgressStart)))
          : Math.min(uploadProgressEnd, uploadProgressStart + Math.floor(bytes / (64 * 1024 * 1024)));
        if (Date.now() - lastSavedAt >= 2500 || nextProgress > lastProgress) {
          job.status = "uploading";
          job.progress = Math.max(job.progress, nextProgress);
          job.message = "正在建立本地可播放文件。";
          job.updatedAt = new Date().toISOString();
          lastSavedAt = Date.now();
          lastProgress = job.progress;
          await this.saveJob(job);
        }
      }
    } finally {
      await file.close();
    }
    if (bytes <= 0) throw new Error("Source returned an empty media file.");
    if (expectedBytes && bytes !== expectedBytes) {
      throw new Error(`Source download ended at ${bytes} bytes; expected ${expectedBytes}.`);
    }
    return {
      bytes,
      expectedBytes,
      contentType: response.headers.get("content-type") ?? undefined,
      sourceAcceptRanges: response.headers.get("accept-ranges") ?? undefined
    };
  }

  private posterKey(poster: MoviePoster) {
    return createHash("sha256").update(stablePosterIdentity(poster), "utf8").digest("hex").slice(0, 32);
  }

  private async cachePoster(
    poster: MoviePoster,
    index: number,
    posters: MoviePoster[],
    options: CacheMoviePostersOptions
  ) {
    const posterKey = this.posterKey(poster);
    if (await this.getPosterFile(posterKey)) {
      return {
        ...poster,
        originalUrl: poster.originalUrl ?? poster.url,
        url: `/api/posters/${posterKey}`
      };
    }

    const pending = this.posterDownloads.get(posterKey);
    if (pending) return pending;
    const download = this.downloadPoster(posterKey, poster, index, posters, options)
      .finally(() => this.posterDownloads.delete(posterKey));
    this.posterDownloads.set(posterKey, download);
    return download;
  }

  private async downloadPoster(
    posterKey: string,
    poster: MoviePoster,
    index: number,
    posters: MoviePoster[],
    options: CacheMoviePostersOptions
  ) {
    const filePath = path.join(this.posterRoot, `${posterKey}.bin`);
    const tempPath = `${filePath}.${process.pid}.tmp`;
    const metadataPath = path.join(this.posterRoot, `${posterKey}.json`);
    let contentType: string | undefined;
    let downloaded = false;

    try {
      if (poster.blobName) {
        try {
          const response = await this.posterContainer.getBlobClient(poster.blobName).downloadToFile(tempPath);
          contentType = response.contentType;
          downloaded = true;
        } catch {
          await rm(tempPath, { force: true });
        }
      }

      if (!downloaded) {
        const candidates = await posterDownloadCandidates({
          poster,
          index,
          posters,
          refreshPosters: options.refreshPosters
        });
        for (const candidate of candidates) {
          try {
            const response = await fetch(candidate.url, {
              redirect: "follow",
              headers: posterRequestHeaders(candidate.url)
            });
            if (!response.ok || !response.body) continue;
            const responseType = response.headers.get("content-type")?.split(";")[0];
            if (responseType && !responseType.startsWith("image/")) continue;
            const file = await open(tempPath, "w");
            try {
              for await (const chunk of response.body) {
                await file.write(chunk);
              }
            } finally {
              await file.close();
            }
            contentType = responseType ?? poster.contentType;
            downloaded = true;
            break;
          } catch {
            await rm(tempPath, { force: true });
          }
        }
      }

      if (!downloaded) throw new Error("Poster could not be cached.");
      const downloadedFile = await stat(tempPath);
      if (!downloadedFile.isFile() || downloadedFile.size <= 0) {
        throw new Error("Poster download was empty.");
      }
      await rm(filePath, { force: true });
      await rename(tempPath, filePath);
      await writeFile(metadataPath, `${JSON.stringify({
        contentType: contentType?.startsWith("image/") ? contentType : "image/jpeg",
        cachedAt: new Date().toISOString(),
        blobName: poster.blobName,
        originalUrl: poster.originalUrl ?? poster.url
      })}\n`, "utf8");
      return {
        ...poster,
        originalUrl: poster.originalUrl ?? poster.url,
        contentType: contentType?.startsWith("image/") ? contentType : poster.contentType,
        cachedAt: new Date().toISOString(),
        url: `/api/posters/${posterKey}`
      };
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  private absolutePathFromUrl(playbackUrl: string) {
    if (!playbackUrl.startsWith(filesystemPrefix)) return undefined;
    const relativePath = playbackUrl.slice(filesystemPrefix.length);
    const candidate = path.resolve(this.root, ...relativePath.split("/"));
    const relativeToRoot = path.relative(this.root, candidate);
    return relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot) ? undefined : candidate;
  }

  private cachedMediaBytes() {
    return Object.values(this.readState().assets)
      .filter((asset) => asset.status === "ready")
      .reduce((total, asset) => {
        const contentLength = asset.media?.contentLength ?? 0;
        const mediaPath = asset.playbackUrl ? this.absolutePathFromUrl(asset.playbackUrl) : undefined;
        const hasHls = mediaPath
          ? existsSync(path.join(path.dirname(mediaPath), "hls", "index.m3u8"))
          : false;
        return total + contentLength + (hasHls ? contentLength : 0);
      }, 0);
  }

  private async assertDownloadCapacity(expectedBytes: number | undefined, existingBytes: number) {
    const maximumBytes = mediaMaxBytes();
    const requiredBytes = expectedBytes ? expectedBytes * 2 : undefined;
    if (maximumBytes > 0 && requiredBytes && this.cachedMediaBytes() + requiredBytes > maximumBytes) {
      throw new Error(`Local media cache quota of ${maximumBytes} bytes would be exceeded.`);
    }

    if (!expectedBytes) return;
    const { statfs } = await import("node:fs/promises");
    const fileSystem = await statfs(this.root);
    const availableBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
    const remainingDownloadBytes = Math.max(0, expectedBytes - existingBytes);
    const playbackSegmentBytes = expectedBytes;
    if (availableBytes - remainingDownloadBytes - playbackSegmentBytes < mediaMinFreeBytes()) {
      throw new Error(`Local media cache must keep ${mediaMinFreeBytes()} bytes free.`);
    }
  }

  private readState() {
    const row = this.database.prepare("SELECT payload FROM cache_state WHERE id = 1").get() as { payload: string };
    return JSON.parse(row.payload) as LocalCacheState;
  }

  private updateState<T>(mutator: (state: LocalCacheState) => T) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const state = this.readState();
      const result = mutator(state);
      this.database.prepare("UPDATE cache_state SET payload = ?, updated_at = ? WHERE id = 1")
        .run(JSON.stringify(state), new Date().toISOString());
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
