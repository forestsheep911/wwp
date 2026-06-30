import { Activity, CheckCircle2, Database, Film, History, LayoutGrid, List, Loader2, Play, RefreshCw } from "lucide-react";
import type { CacheAsset, MediaVariant, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Progress } from "../../components/ui/progress";
import {
  bestSummary,
  cacheLabel,
  cacheVariant,
  directorLine,
  formatBytes,
  formatDateTime,
  formatLongDate,
  jobStatusLabel,
  jobVariant,
  mediaQuality,
  metadataLine,
  peopleTags,
  titleInitial,
  visibleTags
} from "../format";
import type { AppTab, LibraryViewMode, PlaybackHistoryEntry, ResultWithCache, TrackedCacheItem } from "../types";
import { EmptyState } from "./EmptyState";

interface LibraryTabProps {
  query: string;
  error: string;
  viewMode: LibraryViewMode;
  results: ResultWithCache[];
  cachedAssets: CacheAsset[];
  historyItems: PlaybackHistoryEntry[];
  trackedItems: TrackedCacheItem[];
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenCachedAsset: (assetKey: string) => void;
  onOpenHistoryItem: (assetKey: string, result?: SearchResult) => void;
  onOpenTab: (tab: AppTab) => void;
  onRefreshCachedAssets: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}

export function LibraryTab({
  query,
  error,
  viewMode,
  results,
  cachedAssets,
  historyItems,
  trackedItems,
  pendingAssetKeys,
  trackedByAssetKey,
  onOpenCachedAsset,
  onOpenHistoryItem,
  onOpenTab,
  onRefreshCachedAssets,
  onViewModeChange,
  onSelect
}: LibraryTabProps) {
  const hasQuery = query.trim().length > 0;

  return (
    <div className="grid gap-5">
      {error ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-200">
          {error}
        </div>
      ) : null}

      {!hasQuery && results.length === 0 ? (
        <LibraryHome
          cachedAssets={cachedAssets}
          historyItems={historyItems}
          trackedItems={trackedItems}
          onOpenCachedAsset={onOpenCachedAsset}
          onOpenHistoryItem={onOpenHistoryItem}
          onOpenTab={onOpenTab}
          onRefreshCachedAssets={onRefreshCachedAssets}
        />
      ) : (
        <>
          <div className="flex w-full rounded-md border border-slate-800 bg-slate-950 p-1 sm:w-fit">
            <Button
              className="flex-1 sm:flex-none"
              type="button"
              size="sm"
              variant={viewMode === "gallery" ? "secondary" : "ghost"}
              onClick={() => onViewModeChange("gallery")}
              title="Gallery view"
            >
              <LayoutGrid className="h-4 w-4" />
              Gallery
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              type="button"
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              onClick={() => onViewModeChange("list")}
              title="List view"
            >
              <List className="h-4 w-4" />
              List
            </Button>
          </div>

          {viewMode === "gallery" ? (
            <div className="gallery-results">
              <div className="gallery-results-grid grid gap-4">
                {results.length === 0 ? (
                  <div className="col-span-full">
                    <EmptyState icon={<Film className="h-5 w-5" />} title="No titles found" />
                  </div>
                ) : (
                  results.map((result) => (
                    <MovieCard
                      key={result.assetKey}
                      result={result}
                      pendingAssetKeys={pendingAssetKeys}
                      trackedByAssetKey={trackedByAssetKey}
                      onSelect={onSelect}
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <MovieListView
              results={results}
              pendingAssetKeys={pendingAssetKeys}
              trackedByAssetKey={trackedByAssetKey}
              onSelect={onSelect}
            />
          )}
        </>
      )}
    </div>
  );
}

function LibraryHome({
  cachedAssets,
  historyItems,
  trackedItems,
  onOpenCachedAsset,
  onOpenHistoryItem,
  onOpenTab,
  onRefreshCachedAssets
}: {
  cachedAssets: CacheAsset[];
  historyItems: PlaybackHistoryEntry[];
  trackedItems: TrackedCacheItem[];
  onOpenCachedAsset: (assetKey: string) => void;
  onOpenHistoryItem: (assetKey: string, result?: SearchResult) => void;
  onOpenTab: (tab: AppTab) => void;
  onRefreshCachedAssets: () => void;
}) {
  const readyAssets = cachedAssets.slice(0, 6);
  const recentHistory = historyItems.slice(0, 4);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
            <h2 className="text-lg font-semibold text-slate-50">Ready now</h2>
            <Badge variant="secondary">{cachedAssets.length}</Badge>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onRefreshCachedAssets}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenTab("cached")}>
              <Database className="h-4 w-4" />
              Cached
            </Button>
          </div>
        </div>
        {readyAssets.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {readyAssets.map((asset) => (
              <Card key={asset.assetKey} className="min-w-0 overflow-hidden">
                <CardContent className="grid gap-3 p-4">
                  <div className="min-w-0">
                    <p className="line-clamp-2 min-h-10 font-semibold leading-5 text-slate-50">{asset.title}</p>
                    <p className="mt-2 text-sm text-slate-400">
                      {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
                    </p>
                  </div>
                  <Button type="button" size="sm" onClick={() => onOpenCachedAsset(asset.assetKey)}>
                    <Play className="h-4 w-4" />
                    Play
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Database className="h-5 w-5" />} title="No cached titles" />
        )}
      </section>

      {trackedItems.length ? (
        <section className="grid gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-amber-200" />
            <h2 className="text-lg font-semibold text-slate-50">Preparing</h2>
            <Badge variant="warning">{trackedItems.length}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {trackedItems.slice(0, 4).map(({ job }) => (
              <Card key={job.id} className="min-w-0 overflow-hidden">
                <CardContent className="grid gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-2 min-w-0 font-semibold leading-5 text-slate-50">{job.title}</p>
                    <Badge className="shrink-0" variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                  </div>
                  <Progress value={job.progress} />
                  <p className="text-sm font-semibold text-slate-300">{job.progress}%</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-slate-300" />
            <h2 className="text-lg font-semibold text-slate-50">Recent plays</h2>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenTab("history")}>
            <History className="h-4 w-4" />
            History
          </Button>
        </div>
        {recentHistory.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {recentHistory.map((item) => (
              <Card key={`${item.assetKey}-${item.playedAt}`} className="min-w-0 overflow-hidden">
                <CardContent className="grid gap-3 p-4 sm:flex sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-50">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {formatLongDate(item.playedAt)} / {formatBytes(item.contentLength)}
                    </p>
                  </div>
                  <Button
                    className="w-full shrink-0 sm:w-auto"
                    type="button"
                    size="sm"
                    onClick={() => onOpenHistoryItem(item.assetKey, item.result)}
                  >
                    <Play className="h-4 w-4" />
                    Play
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={<History className="h-5 w-5" />} title="No playback history" />
        )}
      </section>
    </div>
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
            title={`${variant.label} / ${displayStatus}`}
            aria-label={`${variant.label} / ${displayStatus}`}
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
    <article className="grid h-full grid-cols-[96px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 shadow-2xl shadow-black/20 sm:grid-cols-[132px_minmax(0,1fr)]">
      <MoviePoster result={result} />
      <div className="grid min-w-0 content-between gap-3 p-3 sm:gap-4 sm:p-4">
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

        <VariantButtons
          result={result}
          pendingAssetKeys={pendingAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onSelect={onSelect}
        />
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
