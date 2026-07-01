import type {
  CacheAsset,
  CacheAssetLookupResponse,
  CacheJob,
  CacheStatus,
  MediaDiagnostics,
  MemberAccessCode,
  SearchResult
} from "@wwpdw/shared";
import { cacheMessageLabel, cacheStatusLabel, copy } from "./i18n";
import type { BadgeVariant } from "./types";

export const cacheStatusText: Record<CacheStatus, string> = copy.cache.status;

export function formatDate(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatLongDate(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatDateTime(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function creditsLabel(code: MemberAccessCode) {
  return `${code.credits.unitSymbol} ${code.credits.remaining}`;
}

export function cacheLabel(asset?: CacheAsset) {
  if (!asset) {
    return copy.cache.notCached;
  }

  return cacheStatusLabel(asset.status);
}

export function cacheVariant(asset?: CacheAsset): BadgeVariant {
  if (!asset) {
    return "muted";
  }

  if (asset.status === "ready") {
    return "default";
  }

  if (asset.status === "failed") {
    return "danger";
  }

  return "warning";
}

export function jobVariant(status: CacheJob["status"]): BadgeVariant {
  if (status === "ready") {
    return "default";
  }

  if (status === "failed") {
    return "danger";
  }

  if (status === "queued" || status === "fetching" || status === "downloading" || status === "processing" || status === "uploading") {
    return "warning";
  }

  return "secondary";
}

export function historyCacheLabel(status?: CacheAssetLookupResponse) {
  if (!status) {
    return copy.cache.checking;
  }

  if (status.playable) {
    return cacheStatusLabel("ready");
  }

  if (status.asset?.status === "ready") {
    return copy.cache.expired;
  }

  return status.asset ? cacheStatusLabel(status.asset.status) : copy.cache.notCached;
}

export function historyCacheVariant(status?: CacheAssetLookupResponse): BadgeVariant {
  if (!status) {
    return "secondary";
  }

  if (status.playable) {
    return "default";
  }

  if (!status.asset) {
    return "muted";
  }

  if (status.asset.status === "failed") {
    return "danger";
  }

  return "warning";
}

export function formatBytes(value?: number) {
  if (!Number.isFinite(value)) {
    return copy.common.unknown;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value ?? 0;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function booleanLabel(value?: boolean) {
  if (value === undefined) {
    return copy.common.unknown;
  }

  return value ? copy.common.enabled : copy.common.disabled;
}

export function mp4StatusLabel(media?: MediaDiagnostics) {
  switch (media?.mp4?.status) {
    case "faststart":
      return copy.media.seekReady;
    case "late_moov":
      return copy.media.seekSlow;
    case "not_mp4":
      return copy.media.notMp4;
    case "unknown":
      return copy.common.unknown;
    default:
      return copy.media.unchecked;
  }
}

export function offsetLabel(value?: number) {
  return value === undefined ? copy.common.unknown : value.toLocaleString();
}

export function titleInitial(title: string) {
  return title.match(/[\u3400-\u9fff]/)?.[0] ?? title.trim().charAt(0).toUpperCase() ?? "W";
}

export function metadataLine(result: SearchResult) {
  const metadata = result.metadata;
  const parts = [
    metadata?.year,
    metadata?.type,
    metadata?.ratingLevel?.[0],
    formatLongDate(metadata?.releaseDate)
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : `${result.source} / ${formatDate(result.updatedAt)}`;
}

export function visibleTags(tags?: string[]) {
  return (tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== copy.library.ignoredSourceTag);
}

export function directorLine(result: SearchResult) {
  const directors = visibleTags(result.metadata?.directors);
  return directors.length > 0 ? directors.join(" / ") : "";
}

export function peopleTags(result: SearchResult) {
  return visibleTags(result.metadata?.people).slice(0, 3);
}

export function bestSummary(result: SearchResult) {
  return result.metadata?.description ?? result.metadata?.info ?? result.summary;
}

function looksTruncated(value: string) {
  return /(?:\.{3}|…)$/u.test(value.trim());
}

export function bestDetailSummary(result: SearchResult) {
  const summary = bestSummary(result);
  const omdbPlot = result.metadata?.external?.omdb?.plot;
  if (looksTruncated(summary) && omdbPlot && omdbPlot !== "N/A" && omdbPlot.length > summary.length) {
    return omdbPlot;
  }

  return summary;
}

export function mediaQuality(media?: MediaDiagnostics) {
  if (!media) {
    return copy.media.notChecked;
  }

  if (media.mp4?.status === "faststart" && media.rangeSupported) {
    return copy.media.seekReady;
  }

  if (media.mp4?.status === "late_moov") {
    return copy.media.seekSlow;
  }

  return copy.media.playbackChecked;
}

export function jobStatusLabel(status: CacheStatus) {
  return cacheStatusLabel(status);
}

export function jobMessageLabel(job: CacheJob) {
  if (job.status === "failed") {
    return copy.cache.failedRetry;
  }

  return cacheMessageLabel(job.message);
}

export function cacheErrorLabel(message: string) {
  if (message.includes("The specified block list is invalid")) {
    return copy.cache.errors.blockListInvalid;
  }

  if (message.includes("Asset is not ready for playback")) {
    return copy.cache.errors.assetNotReady;
  }

  return cacheMessageLabel(message);
}
