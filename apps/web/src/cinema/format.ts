import type {
  CacheAsset,
  CacheAssetLookupResponse,
  CacheJob,
  CacheStatus,
  MediaDiagnostics,
  MemberAccessCode,
  SearchResult
} from "@wwpdw/shared";
import type { BadgeVariant } from "./types";

export const cacheStatusText: Record<CacheStatus, string> = {
  queued: "排队中",
  fetching: "准备中",
  downloading: "获取中",
  processing: "准备播放",
  uploading: "建立缓存",
  ready: "可播放",
  failed: "失败"
};

export const cacheMessageText: Record<string, string> = {
  "Waiting for a cache worker.": "等待开始准备。",
  "Fetching source metadata.": "正在准备片源。",
  "Resolving the media source.": "正在确认可播放版本。",
  "Copying the resolved media into the cache lane.": "正在建立播放缓存。",
  "Publishing the cached asset.": "正在完成播放准备。",
  "Uploading the resolved media into Blob cache.": "正在建立播放缓存。",
  "正在检查播放状态。": "正在检查播放状态。",
  "Ready for playback.": "可以播放。",
  "Failed to cache the resolved media.": "准备失败。"
};

export function formatDate(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
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

  return new Intl.DateTimeFormat("en", {
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

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function creditsLabel(code: MemberAccessCode) {
  return `${code.credits.unitSymbol} ${code.credits.remaining}/${code.credits.total}`;
}

export function creditWindowLabel(used: number, limit: number) {
  return `${used}/${limit}`;
}

export function cacheLabel(asset?: CacheAsset) {
  if (!asset) {
    return "未缓存";
  }

  return cacheStatusText[asset.status];
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
    return "检查中";
  }

  if (status.playable) {
    return "可播放";
  }

  if (status.asset?.status === "ready") {
    return "已过期";
  }

  return status.asset ? cacheStatusText[status.asset.status] : "未缓存";
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
    return "unknown";
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
    return "unknown";
  }

  return value ? "yes" : "no";
}

export function mp4StatusLabel(media?: MediaDiagnostics) {
  switch (media?.mp4?.status) {
    case "faststart":
      return "faststart";
    case "late_moov":
      return "late moov";
    case "not_mp4":
      return "not mp4";
    case "unknown":
      return "unknown";
    default:
      return "not checked";
  }
}

export function offsetLabel(value?: number) {
  return value === undefined ? "unknown" : value.toLocaleString();
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
    .filter((tag) => tag && tag !== "闻达");
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

export function mediaQuality(media?: MediaDiagnostics) {
  if (!media) {
    return "Media not checked";
  }

  if (media.mp4?.status === "faststart" && media.rangeSupported) {
    return "Seek ready";
  }

  if (media.mp4?.status === "late_moov") {
    return "Seek may be slow";
  }

  return "Playback checked";
}

export function jobStatusLabel(status: CacheStatus) {
  return cacheStatusText[status];
}

export function jobMessageLabel(job: CacheJob) {
  if (job.status === "failed") {
    return "准备失败，可以重新准备。";
  }

  return cacheMessageText[job.message] ?? job.message;
}

export function cacheErrorLabel(message: string) {
  if (message.includes("The specified block list is invalid")) {
    return "缓存写入失败，请重新准备。";
  }

  if (message.includes("Asset is not ready for playback")) {
    return "这条影片还没有准备好播放。";
  }

  return cacheMessageText[message] ?? message;
}
