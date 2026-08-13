import type {
  CacheAsset,
  CacheAssetLookupResponse,
  CacheJob,
  CacheStatus,
  MediaVariant,
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

  const includeYear = date.getFullYear() !== new Date().getFullYear();
  return new Intl.DateTimeFormat("zh-CN", {
    ...(includeYear ? { year: "numeric" as const } : {}),
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
  const ageLabel = metadata?.effectiveMinimumAge !== undefined
    ? `建议 ${metadata.effectiveMinimumAge}+`
    : undefined;
  const parts = [
    metadata?.year,
    metadata?.type,
    ageLabel,
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

function normalizedDisplayText(value?: string) {
  const text = value?.trim();
  if (!text || /^N\/?A$/i.test(text)) {
    return undefined;
  }

  return text;
}

function isGeneratedLibrarySummary(value: string) {
  return (
    /\b\d+\s+playable specs?\s+found in this movie entry\b/i.test(value) ||
    /^No playable specs were found\b/i.test(value) ||
    /^已整理\s*\d+\s*个可播放规格/u.test(value) ||
    /^这条影片暂时没有可播放规格/u.test(value) ||
    /^Structured Media Assets row\b/i.test(value) ||
    /^Media Assets? row\b/i.test(value)
  );
}

function usableSummary(value?: string) {
  const text = normalizedDisplayText(value);
  if (!text || isGeneratedLibrarySummary(text)) {
    return undefined;
  }

  return text;
}

function looksLikePeopleDump(value: string) {
  const slashParts = value
    .split(/\s*\/\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (slashParts.length < 6 || value.length < 72) {
    return false;
  }

  const compactNameParts = slashParts.filter((part) => (
    part.length <= 24 &&
    !/\d/u.test(part) &&
    !/[。！？!?；;，,]/u.test(part)
  ));

  return compactNameParts.length / slashParts.length >= 0.75;
}

function usableInfo(value?: string) {
  const text = usableSummary(value);
  if (
    !text ||
    /^(?:draft|partial|complete|completed|ready|verified|unknown|none|metadata|meta|notion|omdb)$/i.test(text) ||
    looksLikePeopleDump(text)
  ) {
    return undefined;
  }

  return text;
}

export function bestSummary(result: SearchResult) {
  return (
    usableSummary(result.metadata?.description) ??
    usableInfo(result.metadata?.info) ??
    usableSummary(result.metadata?.external?.omdb?.plot) ??
    usableSummary(result.summary) ??
    copy.library.missingSummary
  );
}

export function basicInfoLine(result: SearchResult) {
  const info = usableInfo(result.metadata?.info);
  const organizationParts = [
    visibleTags(result.metadata?.productionCompanies).length > 0
      ? `制作：${visibleTags(result.metadata?.productionCompanies).slice(0, 3).join(" / ")}`
      : undefined,
    visibleTags(result.metadata?.studios).length > 0
      ? `工作室：${visibleTags(result.metadata?.studios).slice(0, 3).join(" / ")}`
      : undefined,
    visibleTags(result.metadata?.distributors).length > 0
      ? `发行：${visibleTags(result.metadata?.distributors).slice(0, 3).join(" / ")}`
      : undefined
  ].filter(Boolean).join(" · ");
  const visibleInfo = info && bestSummary(result) !== info ? info : "";
  return [visibleInfo, organizationParts].filter(Boolean).join(" / ");
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleAliases(title: string) {
  const compactTitle = title.replace(/\s+/g, " ").trim();
  const withoutYear = compactTitle
    .replace(/\s*(?:\((?:19|20)\d{2}\)|（(?:19|20)\d{2}）)\s*$/u, "")
    .trim();
  const hanPrefix = withoutYear.match(/^[\p{Script=Han}][\p{Script=Han}\s·・《》]+/u)?.[0]?.trim();
  const latinTail = hanPrefix ? withoutYear.slice(hanPrefix.length).trim() : "";

  return [...new Set([
    compactTitle,
    withoutYear,
    hanPrefix,
    latinTail,
    ...withoutYear.split(/\s*[\/／|｜]\s*/u)
  ]
    .map((alias) => alias?.trim())
    .filter((alias): alias is string => Boolean(alias && alias.length >= 2)))]
    .sort((left, right) => right.length - left.length);
}

export function displayVariantLabel(title: string, label: string) {
  const cleanedLabel = label.replace(/\s+/g, " ").trim();
  for (const alias of titleAliases(title)) {
    const match = cleanedLabel.match(new RegExp(`^${escapeRegExp(alias)}(?:\\s+|[：:/／｜|-]+)`, "u"));
    if (!match) {
      continue;
    }

    const stripped = cleanedLabel.slice(match[0].length).trim();
    if (stripped) {
      return stripped;
    }
  }

  return cleanedLabel || label;
}

const mediaLanguageLabels: Record<string, string> = {
  "zh-Hans": "简",
  "zh-Hant": "繁",
  "zh-Mandarin": "国",
  "zh-Cantonese": "粤",
  en: "英",
  ja: "日",
  commentary: "评",
  none: "无"
};

const sourceLineageLabels: Record<string, string> = {
  encode: "压制版",
  remux: "Remux",
  "Blu-ray": "蓝光",
  "UHD Blu-ray": "UHD 蓝光",
  "WEB-DL": "WEB-DL",
  ISO: "ISO",
  source_archive: "片源包"
};

function labelList(values?: string[]) {
  return values
    ?.map((value) => mediaLanguageLabels[value] ?? sourceLineageLabels[value] ?? value)
    .filter(Boolean)
    .join("");
}

function uniqueDisplayLabels(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function variantHasSizeMetadata(variant?: MediaVariant) {
  const metadata = variant?.metadata;
  return Boolean(
    metadata &&
    (
      (typeof metadata.approximateSizeGb === "number" && Number.isFinite(metadata.approximateSizeGb) && metadata.approximateSizeGb > 0) ||
      (typeof metadata.exactByteSize === "number" && Number.isFinite(metadata.exactByteSize) && metadata.exactByteSize > 0)
    )
  );
}

export function variantSizeLabel(variant: MediaVariant) {
  const metadata = variant.metadata;
  if (!metadata) {
    return undefined;
  }

  if (typeof metadata.approximateSizeGb === "number" && Number.isFinite(metadata.approximateSizeGb) && metadata.approximateSizeGb > 0) {
    return `${metadata.approximateSizeGb.toLocaleString(undefined, { maximumFractionDigits: 2 })}G`;
  }

  if (typeof metadata.exactByteSize === "number" && Number.isFinite(metadata.exactByteSize) && metadata.exactByteSize > 0) {
    return formatBytes(metadata.exactByteSize).replace(/\s*GB\b/u, "G");
  }

  return undefined;
}

function normalizedEditionLabel(value: string) {
  if (/director(?:'s)?[\s._-]*cut|导演剪辑|導演剪輯/i.test(value)) {
    return "导演剪辑版";
  }
  if (/extended|加长|加長/i.test(value)) {
    return "加长版";
  }
  if (/theatrical|院线|院線|剧场|劇場/i.test(value)) {
    return "院线版";
  }
  if (/unrated|未分级|未分級/i.test(value)) {
    return "未分级版";
  }
  if (/uncut|未删减|未刪減/i.test(value)) {
    return "未删减版";
  }
  if (/remaster|重制|重製/i.test(value)) {
    return "重制版";
  }
  if (/restored|修复|修復/i.test(value)) {
    return "修复版";
  }
  return "";
}

function variantEditionLabel(variant: MediaVariant, options: { includeDefaultEdition?: boolean } = {}) {
  const metadata = variant.metadata;
  const explicitEdition = metadata?.edition?.trim();
  if (explicitEdition) {
    const label = normalizedEditionLabel(explicitEdition) || explicitEdition;
    return label === "院线版" && !options.includeDefaultEdition ? "" : label;
  }

  const label = normalizedEditionLabel([
    metadata?.sourceLabel,
    variant.sourceBreadcrumb?.[1],
    variant.label
  ].filter(Boolean).join(" "));
  return label === "院线版" && !options.includeDefaultEdition ? "" : label;
}

export function variantsNeedDefaultEditionLabel(variants: MediaVariant[]) {
  const editionLabels = variants
    .map((variant) => variantEditionLabel(variant, { includeDefaultEdition: true }))
    .filter(Boolean);
  return editionLabels.includes("院线版") && editionLabels.some((label) => label !== "院线版");
}

function variantDurationLabel(variant: MediaVariant) {
  const durationSeconds = variant.metadata?.durationSeconds;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}分钟`;
  }
  return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
}

function chineseEpisodeNumber(value: string) {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  let total = 0;
  let current = 0;

  for (const char of value) {
    if (char === "百") {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    if (char === "十") {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }

    const digit = digits[char];
    if (digit === undefined) {
      return undefined;
    }
    current = digit;
  }

  const number = total + current;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function episodeNumberFromText(value: string) {
  const patterns = [
    /\bS\d{1,2}E(\d{1,3})\b/i,
    /\b\d{1,2}x(\d{1,3})\b/i,
    /\b(?:Episode|Ep)[\s._-]*(\d{1,3})\b/i,
    /\bE(?:P)?[\s._-]*(\d{1,3})\b/i,
    /第\s*(\d{1,3})\s*[集话話]/u
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    const number = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isInteger(number) && number > 0) {
      return number;
    }
  }

  return chineseEpisodeNumber(value.match(/第\s*([一二两三四五六七八九十百零〇]+)\s*[集话話]/u)?.[1] ?? "");
}

export function variantEpisodeNumber(variant: MediaVariant) {
  const metadata = variant.metadata;
  return metadata?.episodeNumber ?? episodeNumberFromText([
    variant.label,
    metadata?.sourceLabel,
    metadata?.fileName,
    metadata?.originalFileName
  ].filter(Boolean).join(" "));
}

export function variantEpisodeLabel(variant: MediaVariant) {
  const number = variantEpisodeNumber(variant);
  const endNumber = variant.metadata?.episodeEndNumber;

  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    return undefined;
  }
  return typeof endNumber === "number" && Number.isInteger(endNumber) && endNumber > number
    ? `第${number}-${endNumber}集`
    : `第${number}集`;
}

export function variantSpecLabels(variant: MediaVariant, options: { compact?: boolean; includeEpisode?: boolean; includeSize?: boolean; includeDefaultEdition?: boolean } = {}) {
  const metadata = variant.metadata;
  if (!metadata) {
    return [];
  }

  const includeEpisode = options.includeEpisode ?? true;
  const includeSize = options.includeSize ?? true;
  const subtitles = metadata.noSubtitles
    ? "无"
    : labelList(metadata.subtitleLanguages);
  const labels = uniqueDisplayLabels([
    includeEpisode ? variantEpisodeLabel(variant) : undefined,
    variantEditionLabel(variant, options),
    metadata.resolution,
    variantDurationLabel(variant),
    subtitles,
    includeSize ? variantSizeLabel(variant) : undefined
  ]);

  return options.compact ? labels.slice(0, 5) : labels;
}

export function variantSpecGroupLabels(variant: MediaVariant) {
  const metadata = variant.metadata;
  if (!metadata) {
    return [];
  }

  const subtitles = metadata.noSubtitles
    ? "无"
    : labelList(metadata.subtitleLanguages);
  const sourceLabel = [
    variant.sourceBreadcrumb?.[1],
    metadata.sourceLabel,
    variant.label
  ].find(Boolean) ?? "";
  const sourceSize = sourceLabel.match(/\b(\d+(?:\.\d+)?)\s*(?:GB|G)\b/iu)?.[1];
  const sourceResolution = sourceLabel.match(/\b(\d{3,4}p)\b/iu)?.[1];
  const resolution = metadata.resolution ?? sourceResolution;
  const sourceProfile = sourceSize ? `${sourceSize}G` : undefined;

  return uniqueDisplayLabels([variantEditionLabel(variant), resolution, subtitles, sourceProfile]);
}

export function variantSpecGroupText(title: string, variant: MediaVariant) {
  const labels = variantSpecGroupLabels(variant);
  if (labels.length > 0) {
    return labels.join(" / ");
  }

  const sourceLabel = variant.sourceBreadcrumb?.[1] ?? variant.metadata?.sourceLabel ?? variant.label;
  return displayVariantLabel(title, sourceLabel) || "默认规格";
}

export function variantSpecText(title: string, variant: MediaVariant, options: { compact?: boolean; includeDefaultEdition?: boolean } = {}) {
  const labels = variantSpecLabels(variant, options);
  return labels.length > 0 ? labels.join(" / ") : displayVariantLabel(title, variant.label);
}

function compareVariantsByEpisode(left: MediaVariant, right: MediaVariant) {
  const leftEpisode = variantEpisodeNumber(left);
  const rightEpisode = variantEpisodeNumber(right);
  const leftHasEpisode = typeof leftEpisode === "number" && Number.isFinite(leftEpisode);
  const rightHasEpisode = typeof rightEpisode === "number" && Number.isFinite(rightEpisode);

  if (leftHasEpisode && rightHasEpisode && leftEpisode !== rightEpisode) {
    return leftEpisode - rightEpisode;
  }
  if (leftHasEpisode !== rightHasEpisode) {
    return leftHasEpisode ? -1 : 1;
  }

  return 0;
}

function variantSpecGroupKey(variant: MediaVariant) {
  const labels = variantSpecGroupLabels(variant);
  if (labels.length > 0) {
    return labels.map((label) => label.toLocaleLowerCase()).join("\u001f");
  }

  const metadata = variant.metadata;
  return [
    metadata?.edition,
    metadata?.resolution,
    metadata?.videoCodec,
    metadata?.videoDynamicRange,
    metadata?.qualityTag,
    ...(metadata?.subtitleLanguages ?? []),
    ...(metadata?.audioLanguages ?? [])
  ].map((value) => value?.trim().toLocaleLowerCase()).filter(Boolean).join("\u001f") || "default-spec";
}

export function groupEpisodeVariantsBySpec(title: string, variants: MediaVariant[]) {
  const episodeVariants = variants
    .filter((variant) => typeof variantEpisodeNumber(variant) === "number")
    .sort(compareVariantsByEpisode);
  if (episodeVariants.length < 2) {
    return [];
  }

  const groups = new Map<string, { key: string; label: string; labels: string[]; variants: MediaVariant[] }>();
  episodeVariants.forEach((variant) => {
    const key = variantSpecGroupKey(variant);
    const labels = variantSpecGroupLabels(variant);
    const label = variantSpecGroupText(title, variant);
    const group = groups.get(key) ?? { key, label, labels, variants: [] };
    group.variants.push(variant);
    groups.set(key, group);
  });

  return [...groups.values()].map((group) => {
    const coveredEpisodes = new Set<number>();
    for (const variant of group.variants) {
      const start = variantEpisodeNumber(variant);
      if (typeof start !== "number" || !Number.isInteger(start) || start < 1) continue;
      const end = variant.metadata?.episodeEndNumber ?? start;
      for (let episode = start; episode <= end; episode += 1) coveredEpisodes.add(episode);
    }
    const ordered = [...coveredEpisodes].sort((left, right) => left - right);
    const contiguous = ordered.every((episode, index) => index === 0 || episode === ordered[index - 1] + 1);
    const rangeLabel = contiguous && ordered.length > 1
      ? `第${ordered[0]}-${ordered.at(-1)}集`
      : `${ordered.length} 集`;
    return {
      ...group,
      episodeCount: ordered.length,
      rangeLabel
    };
  });
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

export function jobProgressIndeterminate(job: CacheJob) {
  return job.progressDeterminate === false && !["ready", "failed"].includes(job.status);
}

export function jobProgressLabel(job: CacheJob) {
  if (!jobProgressIndeterminate(job)) return `${job.progress}%`;
  return job.status === "queued" ? "等待开始" : "正在传输";
}

export function jobMessageLabel(job: CacheJob) {
  if (job.status === "failed") {
    return copy.cache.failedRetry;
  }

  if (job.status === "queued" && job.queuePosition) {
    return job.queueLength && job.queueLength > 1
      ? `准备排队中 · 第 ${job.queuePosition} 位，共 ${job.queueLength} 项`
      : `准备排队中 · 第 ${job.queuePosition} 位`;
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

  if (message.includes("playback credit cost cannot be calculated")) {
    return copy.cache.errors.playbackSizeMissing;
  }

  return cacheMessageLabel(message);
}
