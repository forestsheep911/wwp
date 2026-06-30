import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Artplayer from "artplayer";
import {
  Activity,
  CheckCircle2,
  Copy,
  Database,
  Film,
  History,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import type {
  AccessRole,
  AdminCacheJobEntry,
  AuthCheckResponse,
  CacheAsset,
  CacheAssetLookupResponse,
  CacheStatus,
  CacheJob,
  GeneratedMemberAccessCode,
  MediaDiagnostics,
  MediaVariant,
  MemberAccessCode,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";
import {
  addMemberCredits,
  checkAccess,
  clearAccessKey,
  createMemberAccessCode,
  deleteMemberAccessCode,
  ensureCache,
  errorMessage,
  getAccessKey,
  getCacheAsset,
  getCacheStatus,
  getPlayback,
  isUnauthorizedError,
  listCachedAssets,
  listCacheJobs,
  listMemberCodes,
  revokeMemberAccessCode,
  searchAssets,
  setAccessKey
} from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Progress } from "./components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

type ResultWithCache = SearchResult & { cache?: CacheAsset };
type AppTab = "library" | "cached" | "history" | "admin";
type LibraryViewMode = "gallery" | "list";

interface PlaybackHistoryEntry {
  assetKey: string;
  title: string;
  playedAt: string;
  contentType?: string;
  contentLength?: number;
  result?: SearchResult;
}

interface TrackedCacheItem {
  job: CacheJob;
  asset?: CacheAsset;
  result?: SearchResult;
}

type ManagedMemberCode = MemberAccessCode & { code?: string };

const historyStorageKey = "wwpdw-playback-history";

const cacheStatusText: Record<CacheStatus, string> = {
  queued: "排队中",
  fetching: "准备中",
  downloading: "获取中",
  processing: "准备播放",
  uploading: "建立缓存",
  ready: "可播放",
  failed: "失败"
};

const cacheMessageText: Record<string, string> = {
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

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(value?: string) {
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

function formatLongDate(value?: string) {
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

function formatDateTime(value?: string) {
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

function creditsLabel(code: MemberAccessCode) {
  return `${code.credits.unitSymbol} ${code.credits.remaining}/${code.credits.total}`;
}

function creditWindowLabel(used: number, limit: number) {
  return `${used}/${limit}`;
}

function cacheLabel(asset?: CacheAsset) {
  if (!asset) {
    return "未缓存";
  }

  return cacheStatusText[asset.status];
}

function cacheVariant(asset?: CacheAsset): "default" | "secondary" | "warning" | "danger" | "muted" {
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

function jobVariant(status: CacheJob["status"]): "default" | "secondary" | "warning" | "danger" | "muted" {
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

function historyCacheLabel(status?: CacheAssetLookupResponse) {
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

function historyCacheVariant(
  status?: CacheAssetLookupResponse
): "default" | "secondary" | "warning" | "danger" | "muted" {
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

function formatBytes(value?: number) {
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

function booleanLabel(value?: boolean) {
  if (value === undefined) {
    return "unknown";
  }

  return value ? "yes" : "no";
}

function mp4StatusLabel(media?: MediaDiagnostics) {
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

function offsetLabel(value?: number) {
  return value === undefined ? "unknown" : value.toLocaleString();
}

function titleInitial(title: string) {
  return title.match(/[\u3400-\u9fff]/)?.[0] ?? title.trim().charAt(0).toUpperCase() ?? "W";
}

function metadataLine(result: SearchResult) {
  const metadata = result.metadata;
  const parts = [
    metadata?.year,
    metadata?.type,
    metadata?.ratingLevel?.[0],
    formatLongDate(metadata?.releaseDate)
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : `${result.source} / ${formatDate(result.updatedAt)}`;
}

function visibleTags(tags?: string[]) {
  return (tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== "闻达");
}

function directorLine(result: SearchResult) {
  const directors = visibleTags(result.metadata?.directors);
  return directors.length > 0 ? directors.join(" / ") : "";
}

function peopleTags(result: SearchResult) {
  return visibleTags(result.metadata?.people).slice(0, 3);
}

function bestSummary(result: SearchResult) {
  return result.metadata?.description ?? result.metadata?.info ?? result.summary;
}

function mediaQuality(media?: MediaDiagnostics) {
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

function jobStatusLabel(status: CacheStatus) {
  return cacheStatusText[status];
}

function jobMessageLabel(job: CacheJob) {
  if (job.status === "failed") {
    return "准备失败，可以重新准备。";
  }

  return cacheMessageText[job.message] ?? job.message;
}

function cacheErrorLabel(message: string) {
  if (message.includes("The specified block list is invalid")) {
    return "缓存写入失败，请重新准备。";
  }

  if (message.includes("Asset is not ready for playback")) {
    return "这条影片还没有准备好播放。";
  }

  return cacheMessageText[message] ?? message;
}

function appErrorMessage(error: unknown, fallback: string) {
  return cacheErrorLabel(errorMessage(error, fallback));
}

function MediaDiagnosticsView({ media }: { media?: MediaDiagnostics }) {
  if (!media) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-slate-500">Media</span>
        <Badge variant={media.mp4?.status === "late_moov" ? "warning" : "secondary"}>
          {mediaQuality(media)}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Metric label="Type" value={media.contentType ?? "unknown"} />
        <Metric label="Size" value={formatBytes(media.contentLength)} />
        <Metric label="Range" value={booleanLabel(media.rangeSupported)} />
        <Metric label="MP4" value={mp4StatusLabel(media)} />
      </div>
      {media.mp4 ? (
        <p className="text-xs leading-5 text-slate-500">
          moov {offsetLabel(media.mp4.moovOffset)} / mdat {offsetLabel(media.mp4.mdatOffset)}
        </p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="truncate text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function AccessGate({ onUnlock }: { onUnlock: (auth: AuthCheckResponse) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = value.trim();
    if (!candidate) {
      setError("Enter a Cinema Pass.");
      return;
    }

    setLoading(true);
    setError("");
    setAccessKey(candidate);
    try {
      const auth = await checkAccess();
      onUnlock(auth);
    } catch (accessError) {
      clearAccessKey();
      setError(errorMessage(accessError, "Cinema Pass did not match."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-200">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">WW Family Cinema</CardTitle>
          <CardDescription>Private household screening room</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="access-key">Cinema Pass</Label>
              <Input
                id="access-key"
                autoFocus
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                type="password"
              />
            </div>
            {error ? <p className="text-sm font-semibold text-rose-300">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Enter
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function MoviePoster({ result }: { result: SearchResult }) {
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-slate-900">
      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 to-emerald-950 text-4xl font-black text-emerald-100">
        {titleInitial(result.title)}
      </div>
      {result.metadata?.posterUrl ? (
        <img
          alt={result.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={result.metadata.posterUrl}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </div>
  );
}

function VariantButtons({
  result,
  pendingAssetKeys,
  trackedByAssetKey,
  onSelect,
  compact = false
}: {
  result: ResultWithCache;
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  compact?: boolean;
}) {
  const variants = result.variants ?? [];

  if (variants.length === 0) {
    return <Badge variant="danger">无规格</Badge>;
  }

  return (
    <div className={compact ? "grid min-w-[220px] gap-2 sm:min-w-[240px]" : "grid gap-2"}>
      {variants.map((variant) => {
        const pending = pendingAssetKeys.includes(variant.assetKey);
        const tracked = trackedByAssetKey.get(variant.assetKey);
        const displayAsset = tracked?.asset ?? variant.cache;
        const displayStatus = pending
          ? "排队中"
          : tracked
            ? `${jobStatusLabel(tracked.job.status)} ${tracked.job.progress}%`
            : cacheLabel(displayAsset);
        const progress = tracked?.job.progress ?? 0;
        const progressColor = tracked?.job.status === "failed"
          ? "bg-rose-500/22"
          : tracked?.job.status === "ready"
            ? "bg-emerald-500/24"
            : "bg-amber-400/20";
        const badgeVariant = pending
          ? "warning"
          : tracked
            ? jobVariant(tracked.job.status)
            : cacheVariant(displayAsset);

        return (
          <Button
            className={`relative h-auto min-w-0 flex-col items-start overflow-hidden px-3 py-2 text-left sm:flex-row sm:items-center sm:justify-between ${compact ? "min-h-10" : ""}`}
            key={variant.assetKey}
            type="button"
            variant={displayAsset?.status === "ready" ? "default" : "secondary"}
            onClick={() => onSelect(result, variant)}
            disabled={pending}
          >
            {tracked ? (
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 ${progressColor} transition-[width] duration-500`}
                style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
              />
            ) : null}
            <span className="relative z-10 min-w-0 max-w-full truncate">{variant.label}</span>
            <span className="relative z-10 flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-start">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <Badge variant={badgeVariant}>{displayStatus}</Badge>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function MovieCard({
  result,
  pendingAssetKeys,
  trackedByAssetKey,
  onSelect
}: {
  result: ResultWithCache;
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const variants = result.variants ?? [];

  return (
    <article className="grid grid-cols-[96px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 shadow-2xl shadow-black/20 sm:grid-cols-[132px_minmax(0,1fr)] md:grid-cols-[180px_minmax(0,1fr)]">
      <MoviePoster result={result} />
      <div className="grid min-w-0 gap-3 p-3 sm:gap-4 sm:p-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="line-clamp-3 text-base font-semibold leading-tight text-slate-50 sm:text-lg">{result.title}</h2>
              <p className="mt-1 text-sm text-slate-400">{metadataLine(result)}</p>
              {directorLine(result) ? (
                <p className="mt-1 text-xs font-semibold text-slate-300">导演 {directorLine(result)}</p>
              ) : null}
            </div>
            <Badge variant="secondary">
              <Film className="h-3.5 w-3.5" />
              {variants.length} {variants.length === 1 ? "spec" : "specs"}
            </Badge>
          </div>

          {result.metadata?.ratings?.length ? (
            <div className="flex flex-wrap gap-2">
              {result.metadata.ratings.map((rating) => (
                <Badge key={`${rating.label}-${rating.value}`} variant="warning">
                  {rating.label} <span className="text-slate-50">{rating.value}</span>
                </Badge>
              ))}
            </div>
          ) : null}

          {visibleTags(result.metadata?.genres).length || peopleTags(result).length ? (
            <div className="flex flex-wrap gap-2">
              {visibleTags(result.metadata?.genres).slice(0, 4).map((tag) => (
                <Badge key={`genre-${tag}`} variant="secondary">{tag}</Badge>
              ))}
              {peopleTags(result).map((tag) => (
                <Badge key={`people-${tag}`} variant="muted">{tag}</Badge>
              ))}
            </div>
          ) : null}

          <p className="line-clamp-2 text-sm leading-6 text-slate-400 sm:line-clamp-4">{bestSummary(result)}</p>
        </div>

        <div className="grid gap-2">
          <VariantButtons
            result={result}
            pendingAssetKeys={pendingAssetKeys}
            trackedByAssetKey={trackedByAssetKey}
            onSelect={onSelect}
          />
        </div>
      </div>
    </article>
  );
}

function MovieListView({
  results,
  pendingAssetKeys,
  trackedByAssetKey,
  onSelect
}: {
  results: ResultWithCache[];
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  if (results.length === 0) {
    return <EmptyState icon={<Film className="h-5 w-5" />} title="No titles loaded" />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70">
      <table className="w-full min-w-[960px] border-collapse text-left">
        <thead className="border-b border-slate-800 bg-slate-950 text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="w-[34%] px-4 py-3">Title</th>
            <th className="w-[18%] px-4 py-3">Meta</th>
            <th className="w-[18%] px-4 py-3">People</th>
            <th className="w-[30%] px-4 py-3">Specs</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => {
            const genres = visibleTags(result.metadata?.genres).slice(0, 3);
            const people = peopleTags(result).slice(0, 2);
            return (
              <tr key={result.assetKey} className="border-b border-slate-900/80 align-top last:border-0">
                <td className="px-4 py-4">
                  <div className="flex gap-3">
                    <div className="w-14 shrink-0 overflow-hidden rounded-md">
                      <MoviePoster result={result} />
                    </div>
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-semibold leading-5 text-slate-50">{result.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{bestSummary(result)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm">
                  <p className="text-slate-300">{metadataLine(result)}</p>
                  {directorLine(result) ? (
                    <p className="mt-2 text-xs font-semibold text-slate-400">导演 {directorLine(result)}</p>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    {genres.map((tag) => (
                      <Badge key={`list-genre-${result.assetKey}-${tag}`} variant="secondary">{tag}</Badge>
                    ))}
                    {people.map((tag) => (
                      <Badge key={`list-people-${result.assetKey}-${tag}`} variant="muted">{tag}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <VariantButtons
                    result={result}
                    pendingAssetKeys={pendingAssetKeys}
                    trackedByAssetKey={trackedByAssetKey}
                    onSelect={onSelect}
                    compact
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusPanel({
  items,
  onOpenPlayer
}: {
  items: TrackedCacheItem[];
  onOpenPlayer: (assetKey: string, result?: SearchResult) => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="sticky top-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-emerald-300" />
            当前准备任务
          </CardTitle>
          <CardDescription>本次浏览器还没有正在准备的影片</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="sticky top-5">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>当前准备任务</span>
          <Badge variant="secondary">{items.length} 项</Badge>
        </CardTitle>
        <CardDescription>本次浏览器发起的准备任务</CardDescription>
      </CardHeader>
      <CardContent className="grid max-h-[calc(100vh-10rem)] gap-3 overflow-auto pr-3">
        {items.map(({ job, asset, result }) => (
          <div key={job.id} className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-50">{job.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{jobMessageLabel(job)}</p>
              </div>
              <Badge variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
            </div>
            <Progress value={job.progress} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-200">{job.progress}%</span>
              {job.resolve ? (
                <span className="text-slate-500">{job.resolve.layer} / {job.resolve.kind}</span>
              ) : (
                <span className="text-slate-500">{formatDateTime(job.lastRequestedAt ?? job.createdAt)}</span>
              )}
            </div>
            {job.error ? <p className="text-xs font-semibold text-rose-300">{cacheErrorLabel(job.error)}</p> : null}
            {asset?.media ? <MediaDiagnosticsView media={asset.media} /> : null}
            {asset?.status === "ready" ? (
              <Button type="button" size="sm" onClick={() => onOpenPlayer(asset.assetKey, result)}>
                <Play className="h-4 w-4" />
                播放
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ArtPlayerView({ playback }: { playback: PlaybackResponse }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const art = new Artplayer({
      container: containerRef.current,
      url: playback.playbackUrl,
      theme: "#34d399",
      volume: 0.8,
      autoplay: false,
      autoSize: true,
      autoPlayback: true,
      hotkey: true,
      mutex: true,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: true,
      playsInline: true,
      lock: true,
      fastForward: true,
      moreVideoAttr: {
        preload: "metadata"
      }
    });

    return () => {
      art.destroy(false);
    };
  }, [playback.playbackUrl]);

  return <div ref={containerRef} className="aspect-video w-full bg-black" />;
}

function Player({
  playback,
  onClose
}: {
  playback: PlaybackResponse;
  onClose: () => void;
}) {
  const isMock = playback.playbackUrl.startsWith("mock://");

  return (
    <main className="min-h-screen px-3 py-4 sm:px-5 sm:py-6 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-5">
        <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-emerald-300">Now Playing</p>
            <h1 className="mt-1 line-clamp-3 text-xl font-semibold text-slate-50 sm:text-2xl">{playback.title}</h1>
          </div>
          <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={onClose}>
            Back to cinema
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-black shadow-2xl">
          {isMock ? (
            <div className="grid aspect-video place-items-center text-slate-400">
              <div className="grid place-items-center gap-3">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-400 text-slate-950">
                  <Play className="h-9 w-9" />
                </div>
                <p className="max-w-full truncate px-4 text-sm">{playback.assetKey}</p>
              </div>
            </div>
          ) : (
            <ArtPlayerView playback={playback} />
          )}
        </div>
        <MediaDiagnosticsView media={playback.media} />
        <p className="text-xs text-slate-500">Signed URL expires {formatLongDate(playback.expiresAt)}</p>
      </div>
    </main>
  );
}

function CachedShelf({
  cachedAssets,
  loading,
  onOpen,
  onRefresh
}: {
  cachedAssets: CacheAsset[];
  loading: boolean;
  onOpen: (assetKey: string) => void;
  onRefresh: () => void;
}) {
  if (cachedAssets.length === 0 && loading) {
    return <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="Loading cached titles" />;
  }

  if (cachedAssets.length === 0) {
    return (
      <div className="grid gap-3">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <EmptyState icon={<Database className="h-5 w-5" />} title="No cached titles" />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge variant="default">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {cachedAssets.length} 可播放
        </Badge>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      {cachedAssets.map((asset) => (
        <Card key={asset.assetKey}>
          <CardContent className="grid gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-50">{asset.title}</p>
              <p className="mt-1 text-sm text-slate-400">
                {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)} / {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
              </p>
            </div>
            <Button className="w-full sm:w-auto" type="button" onClick={() => onOpen(asset.assetKey)}>
              <Play className="h-4 w-4" />
              Play
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HistoryPanel({
  items,
  statusByAssetKey,
  onClear,
  onPlay,
  onRecache
}: {
  items: PlaybackHistoryEntry[];
  statusByAssetKey: Record<string, CacheAssetLookupResponse | undefined>;
  onClear: () => void;
  onPlay: (assetKey: string, result?: SearchResult) => void;
  onRecache: (entry: PlaybackHistoryEntry) => void;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<History className="h-5 w-5" />} title="No playback history" />;
  }

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Clear history
        </Button>
      </div>
      {items.map((item) => (
        <Card key={`${item.assetKey}-${item.playedAt}`}>
          <CardContent className="grid gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold text-slate-50">{item.title}</p>
                <Badge variant={historyCacheVariant(statusByAssetKey[item.assetKey])}>
                  {historyCacheLabel(statusByAssetKey[item.assetKey])}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {formatLongDate(item.playedAt)} / {item.contentType ?? "unknown"} / {formatBytes(item.contentLength)}
              </p>
              {!statusByAssetKey[item.assetKey]?.playable && !item.result ? (
                <p className="mt-1 text-xs text-slate-500">需要先重新搜索这条影片，才能再次准备。</p>
              ) : null}
            </div>
            <div className="grid gap-2 sm:flex">
              {statusByAssetKey[item.assetKey]?.playable ? (
                <Button className="w-full sm:w-auto" type="button" size="sm" onClick={() => onPlay(item.assetKey, item.result)}>
                  <Play className="h-4 w-4" />
                  播放
                </Button>
              ) : null}
              {!statusByAssetKey[item.assetKey]?.playable && item.result ? (
                <Button className="w-full sm:w-auto" type="button" size="sm" variant="secondary" onClick={() => onRecache(item)}>
                  <RefreshCw className="h-4 w-4" />
                  重新准备
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AdminCacheJobsPanel({
  jobs,
  loading,
  onRefresh
}: {
  jobs: AdminCacheJobEntry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-300" />
            Recent cache jobs
          </CardTitle>
          <CardDescription>Worker state, asset keys, and request ids for cache debugging.</CardDescription>
        </div>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <div className="grid place-items-center rounded-md border border-slate-800 bg-slate-950/70 p-8 text-center text-sm font-semibold text-slate-500">
            No cache jobs recorded
          </div>
        ) : (
          <div className="grid gap-3">
            {jobs.map(({ job, asset }) => (
              <div key={job.id} className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-50">{job.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{jobMessageLabel(job)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                    <Badge variant="secondary">{job.progress}%</Badge>
                  </div>
                </div>

                <Progress value={job.progress} />

                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <Metric label="Job" value={job.id} />
                  <Metric label="Request" value={job.lastRequestId ?? job.requestId ?? "not captured"} />
                  <Metric label="Asset" value={job.assetKey} />
                  <Metric label="Updated" value={formatDateTime(job.lastRequestedAt ?? job.updatedAt)} />
                  <Metric label="Blob" value={asset?.media?.blobName ?? "not ready"} />
                  <Metric label="Size" value={formatBytes(asset?.media?.contentLength)} />
                  <Metric label="Range" value={booleanLabel(asset?.media?.rangeSupported)} />
                  <Metric label="MP4" value={mp4StatusLabel(asset?.media)} />
                </div>

                {job.error ? <p className="text-sm font-semibold text-rose-300">{cacheErrorLabel(job.error)}</p> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminPanel({
  adminUnlocked,
  adminError,
  adminLoading,
  cacheJobs,
  cacheJobsLoading,
  adminKeyInput,
  memberName,
  memberDays,
  memberCredits,
  memberFiveHourLimit,
  memberWeekLimit,
  memberTopUps,
  memberCodes,
  setAdminKeyInput,
  setMemberName,
  setMemberDays,
  setMemberCredits,
  setMemberFiveHourLimit,
  setMemberWeekLimit,
  setMemberTopUp,
  onUnlock,
  onGenerate,
  onCopy,
  onDelete,
  onRefreshJobs,
  onTopUp,
  onRevoke
}: {
  adminUnlocked: boolean;
  adminError: string;
  adminLoading: boolean;
  cacheJobs: AdminCacheJobEntry[];
  cacheJobsLoading: boolean;
  adminKeyInput: string;
  memberName: string;
  memberDays: number;
  memberCredits: number;
  memberFiveHourLimit: number;
  memberWeekLimit: number;
  memberTopUps: Record<string, number>;
  memberCodes: ManagedMemberCode[];
  setAdminKeyInput: (value: string) => void;
  setMemberName: (value: string) => void;
  setMemberDays: (value: number) => void;
  setMemberCredits: (value: number) => void;
  setMemberFiveHourLimit: (value: number) => void;
  setMemberWeekLimit: (value: number) => void;
  setMemberTopUp: (id: string, value: number) => void;
  onUnlock: () => void;
  onGenerate: () => void;
  onCopy: (code: string) => void;
  onDelete: (id: string) => void;
  onRefreshJobs: () => void;
  onTopUp: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  if (!adminUnlocked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            Administrator
          </CardTitle>
          <CardDescription>Enter the administrator key to manage household Cinema Passes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid max-w-md gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onUnlock();
            }}
          >
            <Label htmlFor="admin-key">Admin key</Label>
            <Input
              id="admin-key"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              type="password"
            />
            {adminError ? <p className="text-sm font-semibold text-rose-300">{adminError}</p> : null}
            <Button type="submit" disabled={adminLoading}>
              {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Unlock
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-emerald-300" />
              New Cinema Pass
            </CardTitle>
            <CardDescription>Generate a household pass with a personal 🍀 allowance</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                onGenerate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="member-name">Member name</Label>
                <Input id="member-name" value={memberName} onChange={(event) => setMemberName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="member-days">Days</Label>
                <Input
                  id="member-days"
                  min={1}
                  max={365}
                  type="number"
                  value={memberDays}
                  onChange={(event) => setMemberDays(Number(event.target.value))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="member-credits">🍀 Total</Label>
                  <Input
                    id="member-credits"
                    min={0}
                    max={10000}
                    type="number"
                    value={memberCredits}
                    onChange={(event) => setMemberCredits(Number(event.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="member-five-hour-limit">5h limit</Label>
                  <Input
                    id="member-five-hour-limit"
                    min={0}
                    max={10000}
                    type="number"
                    value={memberFiveHourLimit}
                    onChange={(event) => setMemberFiveHourLimit(Number(event.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="member-week-limit">Week limit</Label>
                  <Input
                    id="member-week-limit"
                    min={0}
                    max={10000}
                    type="number"
                    value={memberWeekLimit}
                    onChange={(event) => setMemberWeekLimit(Number(event.target.value))}
                  />
                </div>
              </div>
              {adminError ? <p className="text-sm font-semibold text-rose-300">{adminError}</p> : null}
              <Button type="submit" disabled={adminLoading}>
                {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Generate
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {memberCodes.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="No Cinema Passes" />
          ) : (
            memberCodes.map((code) => (
              <Card key={code.id}>
                <CardContent className="grid gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-50">{code.name}</p>
                      <Badge variant={code.status === "active" ? "default" : "danger"}>{code.status}</Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-sm text-slate-300">
                      {code.code ?? code.codePreview}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Expires {formatLongDate(code.expiresAt)}</p>
                    <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                      <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                        <p className="text-slate-500">Allowance</p>
                        <p className="mt-1 font-semibold text-emerald-200">{creditsLabel(code)}</p>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                        <p className="text-slate-500">5h limit</p>
                        <p className="mt-1 font-semibold">
                          {creditWindowLabel(code.credits.fiveHour.used, code.credits.fiveHour.limit)}
                        </p>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                        <p className="text-slate-500">Week limit</p>
                        <p className="mt-1 font-semibold">
                          {creditWindowLabel(code.credits.week.used, code.credits.week.limit)}
                        </p>
                      </div>
                    </div>
                    {!code.code ? (
                      <p className="mt-1 text-xs text-amber-200">
                        Full code is shown only when generated.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-9 w-20"
                        min={1}
                        max={10000}
                        type="number"
                        value={memberTopUps[code.id] ?? 10}
                        onChange={(event) => setMemberTopUp(code.id, Number(event.target.value))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onTopUp(code.id)}
                        disabled={adminLoading || code.status !== "active"}
                      >
                        +🍀
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => code.code && onCopy(code.code)}
                      disabled={!code.code || adminLoading}
                    >
                      <Copy className="h-4 w-4" />
                      <span className="sr-only">Copy</span>
                    </Button>
                    {code.status === "active" ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onRevoke(code.id)}
                        disabled={adminLoading}
                      >
                        Revoke
                      </Button>
                    ) : null}
                    {code.status !== "active" ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onDelete(code.id)}
                        disabled={adminLoading}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <AdminCacheJobsPanel jobs={cacheJobs} loading={cacheJobsLoading} onRefresh={onRefreshJobs} />
    </div>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Card>
      <CardContent className="grid place-items-center gap-3 p-6 text-center text-slate-500 sm:p-10">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-slate-800 bg-slate-950">
          {icon}
        </div>
        <p className="font-semibold">{title}</p>
      </CardContent>
    </Card>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => Boolean(getAccessKey()));
  const [role, setRole] = useState<AccessRole | undefined>();
  const [activeTab, setActiveTab] = useState<AppTab>("library");
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("gallery");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultWithCache[]>([]);
  const [job, setJob] = useState<CacheJob | undefined>();
  const [asset, setAsset] = useState<CacheAsset | undefined>();
  const [trackedItems, setTrackedItems] = useState<TrackedCacheItem[]>([]);
  const [playback, setPlayback] = useState<PlaybackResponse | undefined>();
  const [searchLoading, setSearchLoading] = useState(false);
  const [cacheRequestAssetKeys, setCacheRequestAssetKeys] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PlaybackHistoryEntry[]>(() => readJsonStorage(historyStorageKey, []));
  const [historyAssetStatus, setHistoryAssetStatus] = useState<Record<string, CacheAssetLookupResponse | undefined>>({});
  const [cachedAssets, setCachedAssets] = useState<CacheAsset[]>([]);
  const [cachedAssetsLoading, setCachedAssetsLoading] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [cacheJobsLoading, setCacheJobsLoading] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberDays, setMemberDays] = useState(30);
  const [memberCredits, setMemberCredits] = useState(20);
  const [memberFiveHourLimit, setMemberFiveHourLimit] = useState(5);
  const [memberWeekLimit, setMemberWeekLimit] = useState(20);
  const [memberTopUps, setMemberTopUps] = useState<Record<string, number>>({});
  const [memberCodes, setMemberCodes] = useState<ManagedMemberCode[]>([]);
  const [cacheJobs, setCacheJobs] = useState<AdminCacheJobEntry[]>([]);

  const readyCount = useMemo(
    () =>
      results.reduce((count, item) => {
        const resultReady = item.cache?.status === "ready" ? 1 : 0;
        const variantReady = item.variants?.filter((variant) => variant.cache?.status === "ready").length ?? 0;
        return count + resultReady + variantReady;
      }, 0),
    [results]
  );

  const trackedPollKey = useMemo(
    () =>
      trackedItems
        .filter((item) => item.job.status !== "ready" && item.job.status !== "failed")
        .map((item) => `${item.job.id}:${item.job.status}`)
        .join("|"),
    [trackedItems]
  );

  const trackedByAssetKey = useMemo(() => {
    const itemsByAssetKey = new Map<string, TrackedCacheItem>();
    for (const item of trackedItems) {
      if (!itemsByAssetKey.has(item.job.assetKey)) {
        itemsByAssetKey.set(item.job.assetKey, item);
      }
    }
    return itemsByAssetKey;
  }, [trackedItems]);

  function variantToResult(result: SearchResult, variant: MediaVariant): SearchResult {
    return {
      assetKey: variant.assetKey,
      title: `${result.title} / ${variant.label}`,
      source: result.source,
      sourceUrl: variant.sourceUrl,
      durationLabel: result.durationLabel,
      updatedAt: result.updatedAt,
      summary: variant.summary,
      metadata: result.metadata
    };
  }

  function mergeTrackedItem(currentItem: TrackedCacheItem, nextItem: TrackedCacheItem): TrackedCacheItem {
    return {
      ...nextItem,
      job: {
        ...nextItem.job,
        progress: Math.max(currentItem.job.progress, nextItem.job.progress)
      }
    };
  }

  function upsertTrackedItem(nextItem: TrackedCacheItem) {
    setTrackedItems((currentItems) => {
      const existing = currentItems.find((item) => item.job.id === nextItem.job.id);
      const mergedItem = existing ? mergeTrackedItem(existing, nextItem) : nextItem;
      return [
        mergedItem,
        ...currentItems.filter((item) => item.job.id !== nextItem.job.id)
      ].slice(0, 10);
    });
  }

  function handleRequestError(error: unknown, fallback: string) {
    if (isUnauthorizedError(error)) {
      clearAccessKey();
      setUnlocked(false);
      setRole(undefined);
      setAdminUnlocked(false);
      setPlayback(undefined);
      setJob(undefined);
      setAsset(undefined);
      setTrackedItems([]);
      setCacheRequestAssetKeys([]);
      return;
    }

    setError(appErrorMessage(error, fallback));
  }

  async function refreshResults(options: { showLoading: boolean; activateLibrary: boolean }) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setResults([]);
      setError("");
      if (options.showLoading) {
        setSearchLoading(false);
      }
      return;
    }

    if (options.showLoading) {
      setSearchLoading(true);
      setError("");
    }
    try {
      const response = await searchAssets(normalizedQuery);
      setResults(response.results);
      if (options.activateLibrary) {
        setActiveTab("library");
      }
    } catch (searchError) {
      handleRequestError(searchError, "Search failed.");
    } finally {
      if (options.showLoading) {
        setSearchLoading(false);
      }
    }
  }

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    await refreshResults({ showLoading: true, activateLibrary: true });
  }

  async function refreshResultsInBackground() {
    await refreshResults({ showLoading: false, activateLibrary: false });
  }

  async function selectResult(result: ResultWithCache, variant: MediaVariant) {
    setError("");
    setPlayback(undefined);
    setCacheRequestAssetKeys((currentKeys) => (
      currentKeys.includes(variant.assetKey) ? currentKeys : [...currentKeys, variant.assetKey]
    ));
    try {
      const target = variantToResult(result, variant);
      const response = await ensureCache(target);
      setJob(response.job);
      setAsset(response.asset);
      upsertTrackedItem({
        job: response.job,
        asset: response.asset,
        result: target
      });
      if (response.asset.status === "ready") {
        await openPlayer(response.asset.assetKey, target);
      }
      await refreshResultsInBackground();
    } catch (cacheError) {
      handleRequestError(cacheError, "Cache request failed.");
    } finally {
      setCacheRequestAssetKeys((currentKeys) => currentKeys.filter((assetKey) => assetKey !== variant.assetKey));
    }
  }

  function rememberPlayback(response: PlaybackResponse, result?: SearchResult) {
    const entry = {
      assetKey: response.assetKey,
      title: response.title,
      playedAt: new Date().toISOString(),
      contentType: response.media?.contentType,
      contentLength: response.media?.contentLength,
      result
    };
    setHistory((currentHistory) => {
      const next = [entry, ...currentHistory.filter((item) => item.assetKey !== response.assetKey)].slice(0, 20);
      writeJsonStorage(historyStorageKey, next);
      return next;
    });
  }

  async function openPlayer(assetKey = asset?.assetKey, result?: SearchResult) {
    if (!assetKey) {
      return;
    }

    try {
      const response = await getPlayback(assetKey);
      setPlayback(response);
      rememberPlayback(response, result);
    } catch (playbackError) {
      handleRequestError(playbackError, "Playback is not ready.");
    }
  }

  function clearHistory() {
    setHistory([]);
    writeJsonStorage(historyStorageKey, []);
    setHistoryAssetStatus({});
  }

  async function refreshHistoryAssetStatus() {
    const assetKeys = Array.from(new Set(history.map((item) => item.assetKey)));
    if (assetKeys.length === 0) {
      setHistoryAssetStatus({});
      return;
    }

    try {
      const statuses = await Promise.all(
        assetKeys.map(async (assetKey) => [assetKey, await getCacheAsset(assetKey)] as const)
      );
      setHistoryAssetStatus(Object.fromEntries(statuses));
    } catch (historyStatusError) {
      handleRequestError(historyStatusError, "Could not refresh history cache status.");
    }
  }

  async function refreshCachedAssets() {
    setCachedAssetsLoading(true);
    try {
      const response = await listCachedAssets(100);
      setCachedAssets(response.items.map((item) => item.asset));
    } catch (cachedAssetsError) {
      handleRequestError(cachedAssetsError, "Could not load cached titles.");
    } finally {
      setCachedAssetsLoading(false);
    }
  }

  async function recacheHistoryEntry(entry: PlaybackHistoryEntry) {
    if (!entry.result) {
      setError("Search this title again before re-caching it.");
      return;
    }

    setError("");
    setPlayback(undefined);
    setCacheRequestAssetKeys((currentKeys) => (
      currentKeys.includes(entry.assetKey) ? currentKeys : [...currentKeys, entry.assetKey]
    ));
    try {
      const response = await ensureCache(entry.result);
      setJob(response.job);
      setAsset(response.asset);
      upsertTrackedItem({
        job: response.job,
        asset: response.asset,
        result: entry.result
      });
      setActiveTab("library");
      await refreshHistoryAssetStatus();
    } catch (cacheError) {
      handleRequestError(cacheError, "Cache request failed.");
    } finally {
      setCacheRequestAssetKeys((currentKeys) => currentKeys.filter((assetKey) => assetKey !== entry.assetKey));
    }
  }

  function applyAuth(auth: AuthCheckResponse) {
    setRole(auth.role);
    setAdminUnlocked(auth.role === "admin");
  }

  async function refreshMemberCodes() {
    if (!adminUnlocked) {
      return;
    }

    try {
      const response = await listMemberCodes();
      setMemberCodes(response.codes);
      setAdminError("");
    } catch (adminListError) {
      setAdminError(errorMessage(adminListError, "Could not load member codes."));
    }
  }

  async function refreshCacheJobs() {
    if (!adminUnlocked) {
      return;
    }

    setCacheJobsLoading(true);
    try {
      const response = await listCacheJobs(20);
      setCacheJobs(response.jobs);
      setAdminError("");
    } catch (cacheJobError) {
      setAdminError(errorMessage(cacheJobError, "Could not load cache jobs."));
    } finally {
      setCacheJobsLoading(false);
    }
  }

  async function unlockAdmin() {
    const candidate = adminKeyInput.trim();
    if (!candidate) {
      setAdminError("Enter an administrator key.");
      return;
    }

    const previousKey = getAccessKey();
    setAdminLoading(true);
    setAdminError("");
    setAccessKey(candidate);
    try {
      const auth = await checkAccess();
      if (auth.role !== "admin") {
        setAccessKey(previousKey);
        setAdminError("This key is valid, but it is not an administrator key.");
        return;
      }

      applyAuth(auth);
      setAdminKeyInput("");
      const response = await listMemberCodes();
      setMemberCodes(response.codes);
      try {
        const jobsResponse = await listCacheJobs(20);
        setCacheJobs(jobsResponse.jobs);
      } catch (cacheJobError) {
        setAdminError(errorMessage(cacheJobError, "Could not load cache jobs."));
      }
    } catch (adminAccessError) {
      setAccessKey(previousKey);
      setAdminError(errorMessage(adminAccessError, "Admin key did not match."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function generateMemberCode() {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await createMemberAccessCode({
        name: memberName.trim() || "Family member",
        days: Number.isFinite(memberDays) && memberDays > 0 ? memberDays : 30,
        credits: Number.isFinite(memberCredits) && memberCredits >= 0 ? memberCredits : 20,
        fiveHourLimit: Number.isFinite(memberFiveHourLimit) && memberFiveHourLimit >= 0 ? memberFiveHourLimit : 5,
        weekLimit: Number.isFinite(memberWeekLimit) && memberWeekLimit >= 0 ? memberWeekLimit : 20
      });
      setMemberCodes((currentCodes) => [
        response.code,
        ...currentCodes.filter((code) => code.id !== response.code.id)
      ]);
      setMemberName("");
      setMemberDays(30);
      setMemberCredits(20);
      setMemberFiveHourLimit(5);
      setMemberWeekLimit(20);
    } catch (generateError) {
      setAdminError(errorMessage(generateError, "Could not generate member code."));
    } finally {
      setAdminLoading(false);
    }
  }

  function setMemberTopUp(id: string, value: number) {
    setMemberTopUps((currentTopUps) => ({
      ...currentTopUps,
      [id]: value
    }));
  }

  async function topUpMemberCredits(id: string) {
    const credits = memberTopUps[id] ?? 10;
    if (!Number.isFinite(credits) || credits <= 0) {
      setAdminError("Top-up amount must be greater than zero.");
      return;
    }

    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await addMemberCredits(id, { credits });
      setMemberCodes((currentCodes) => currentCodes.map((code) => (
        code.id === id
          ? { ...response.code, code: code.code }
          : code
      )));
      setMemberTopUp(id, 10);
    } catch (topUpError) {
      setAdminError(errorMessage(topUpError, "Could not add credits."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function revokeMemberCode(id: string) {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await revokeMemberAccessCode(id);
      setMemberCodes((currentCodes) => currentCodes.map((code) => (
        code.id === id
          ? { ...response.code, code: code.code }
          : code
      )));
    } catch (revokeError) {
      setAdminError(errorMessage(revokeError, "Could not revoke member code."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function deleteMemberCode(id: string) {
    setAdminLoading(true);
    setAdminError("");
    try {
      await deleteMemberAccessCode(id);
      setMemberCodes((currentCodes) => currentCodes.filter((code) => code.id !== id));
    } catch (deleteError) {
      setAdminError(errorMessage(deleteError, "Could not delete member code."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function copyMemberCode(code: string) {
    await navigator.clipboard?.writeText(code);
  }

  useEffect(() => {
    const activeItems = trackedItems.filter((item) => item.job.status !== "ready" && item.job.status !== "failed");
    if (activeItems.length === 0) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const responses = await Promise.all(activeItems.map((item) => getCacheStatus(item.job.id)));
        const responseByJobId = new Map(responses.map((response) => [response.job.id, response]));

        setTrackedItems((currentItems) =>
          currentItems.map((item) => {
            const response = responseByJobId.get(item.job.id);
            return response
              ? mergeTrackedItem(item, {
                job: response.job,
                asset: response.asset,
                result: item.result
              })
              : item;
          })
        );

        const focusedResponse = job?.id ? responseByJobId.get(job.id) : undefined;
        if (focusedResponse) {
          setJob(focusedResponse.job);
          setAsset(focusedResponse.asset);
        }

        if (responses.some((response) => response.job.status === "ready" || response.job.status === "failed")) {
          await refreshResultsInBackground();
          if (activeTab === "cached") {
            await refreshCachedAssets();
          }
        }
      } catch (statusError) {
        handleRequestError(statusError, "Status refresh failed.");
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [trackedPollKey, job?.id, query, activeTab]);

  useEffect(() => {
    if (!unlocked || role) {
      return;
    }

    checkAccess()
      .then((auth) => {
        applyAuth(auth);
      })
      .catch((authError) => {
        handleRequestError(authError, "Cinema Pass did not match.");
      });
  }, [unlocked, role]);

  useEffect(() => {
    if (activeTab === "admin" && adminUnlocked) {
      void refreshMemberCodes();
      void refreshCacheJobs();
    }
  }, [activeTab, adminUnlocked]);

  useEffect(() => {
    if (activeTab === "history") {
      void refreshHistoryAssetStatus();
    }
  }, [activeTab, history.length]);

  useEffect(() => {
    if (activeTab === "cached") {
      void refreshCachedAssets();
    }
  }, [activeTab]);

  if (!unlocked) {
    return <AccessGate onUnlock={(auth) => {
      setUnlocked(true);
      applyAuth(auth);
    }} />;
  }

  if (playback) {
    return <Player playback={playback} onClose={() => setPlayback(undefined)} />;
  }

  const showStatusPanel = activeTab === "library" || trackedItems.length > 0;

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-emerald-300">Private household cinema</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-50 sm:text-3xl">WW Family Cinema</h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Badge variant="secondary">{results.length} found</Badge>
            <Badge variant="default">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {readyCount} current ready
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                clearAccessKey();
                setUnlocked(false);
                setRole(undefined);
                setAdminUnlocked(false);
                setMemberCodes([]);
                setCacheJobs([]);
                setTrackedItems([]);
                setCacheRequestAssetKeys([]);
                setCachedAssets([]);
              }}
            >
              Lock
            </Button>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AppTab)}>
              <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
                <TabsList>
                  <TabsTrigger value="library">
                    <Film className="h-4 w-4" />
                    <span className="sm:hidden">片库</span>
                    <span className="hidden sm:inline">Library</span>
                  </TabsTrigger>
                  <TabsTrigger value="cached">
                    <Database className="h-4 w-4" />
                    <span className="sm:hidden">缓存</span>
                    <span className="hidden sm:inline">Cached</span>
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    <History className="h-4 w-4" />
                    <span className="sm:hidden">历史</span>
                    <span className="hidden sm:inline">History</span>
                  </TabsTrigger>
                  <TabsTrigger value="admin">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="sm:hidden">管理</span>
                    <span className="hidden sm:inline">Admin</span>
                  </TabsTrigger>
                </TabsList>
                {activeTab === "library" ? (
                  <div className="flex w-full rounded-md border border-slate-800 bg-slate-950 p-1 sm:w-auto">
                    <Button
                      className="flex-1 sm:flex-none"
                      type="button"
                      size="sm"
                      variant={libraryViewMode === "gallery" ? "secondary" : "ghost"}
                      onClick={() => setLibraryViewMode("gallery")}
                      title="Gallery view"
                    >
                      <LayoutGrid className="h-4 w-4" />
                      Gallery
                    </Button>
                    <Button
                      className="flex-1 sm:flex-none"
                      type="button"
                      size="sm"
                      variant={libraryViewMode === "list" ? "secondary" : "ghost"}
                      onClick={() => setLibraryViewMode("list")}
                      title="List view"
                    >
                      <List className="h-4 w-4" />
                      List
                    </Button>
                  </div>
                ) : null}
              </div>

              <TabsContent value="library">
                <div className="grid gap-5">
                  <Card>
                    <CardContent className="p-4">
                      <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={runSearch}>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                          <Input
                            className="pl-9"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search collection"
                          />
                        </div>
                        <Button type="submit" disabled={!query.trim()} aria-busy={searchLoading}>
                          {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          Search
                        </Button>
                      </form>
                      {error ? <p className="mt-3 text-sm font-semibold text-rose-300">{error}</p> : null}
                    </CardContent>
                  </Card>

                  {libraryViewMode === "gallery" ? (
                    <div className="grid gap-4">
                      {results.length === 0 ? (
                        <EmptyState icon={<Film className="h-5 w-5" />} title="No titles loaded" />
                      ) : (
                        results.map((result) => (
                          <MovieCard
                            key={result.assetKey}
                            result={result}
                            pendingAssetKeys={cacheRequestAssetKeys}
                            trackedByAssetKey={trackedByAssetKey}
                            onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
                          />
                        ))
                      )}
                    </div>
                  ) : (
                    <MovieListView
                      results={results}
                      pendingAssetKeys={cacheRequestAssetKeys}
                      trackedByAssetKey={trackedByAssetKey}
                      onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="cached">
                <CachedShelf
                  cachedAssets={cachedAssets}
                  loading={cachedAssetsLoading}
                  onOpen={(assetKey) => void openPlayer(assetKey)}
                  onRefresh={() => void refreshCachedAssets()}
                />
              </TabsContent>

              <TabsContent value="history">
                <HistoryPanel
                  items={history}
                  statusByAssetKey={historyAssetStatus}
                  onClear={clearHistory}
                  onPlay={(assetKey, result) => void openPlayer(assetKey, result)}
                  onRecache={(entry) => void recacheHistoryEntry(entry)}
                />
              </TabsContent>

              <TabsContent value="admin">
                <AdminPanel
                  adminUnlocked={adminUnlocked}
                  adminError={adminError}
                  adminLoading={adminLoading}
                  cacheJobs={cacheJobs}
                  cacheJobsLoading={cacheJobsLoading}
                  adminKeyInput={adminKeyInput}
                  memberName={memberName}
                  memberDays={memberDays}
                  memberCredits={memberCredits}
                  memberFiveHourLimit={memberFiveHourLimit}
                  memberWeekLimit={memberWeekLimit}
                  memberTopUps={memberTopUps}
                  memberCodes={memberCodes}
                  setAdminKeyInput={setAdminKeyInput}
                  setMemberName={setMemberName}
                  setMemberDays={setMemberDays}
                  setMemberCredits={setMemberCredits}
                  setMemberFiveHourLimit={setMemberFiveHourLimit}
                  setMemberWeekLimit={setMemberWeekLimit}
                  setMemberTopUp={setMemberTopUp}
                  onUnlock={unlockAdmin}
                  onGenerate={generateMemberCode}
                  onCopy={(code) => void copyMemberCode(code)}
                  onDelete={deleteMemberCode}
                  onRefreshJobs={() => void refreshCacheJobs()}
                  onTopUp={topUpMemberCredits}
                  onRevoke={revokeMemberCode}
                />
              </TabsContent>
            </Tabs>
          </div>

          {showStatusPanel ? (
            <StatusPanel
              items={trackedItems}
              onOpenPlayer={(assetKey) => void openPlayer(assetKey)}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
