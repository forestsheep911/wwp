import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  Database,
  Eye,
  Film,
  Flame,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Sparkles,
  Star,
  Trophy
} from "lucide-react";
import type { CacheAsset, CreditPolicyResponse, MediaVariant, SearchResult } from "@wwpdw/shared";
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
import { formatCreditAmount, playbackCreditCost, type BrowseChannel, type LibraryViewMode, type PlaybackHistoryEntry, type ResultWithCache, type TrackedCacheItem } from "../types";
import { EmptyState } from "./EmptyState";

interface LibraryTabProps {
  creditPolicy: CreditPolicyResponse;
  query: string;
  error: string;
  focusedAssetKey?: string;
  viewMode: LibraryViewMode;
  results: ResultWithCache[];
  browseChannel: BrowseChannel;
  browseResults: ResultWithCache[];
  browseLoading: boolean;
  browseLoadingMore: boolean;
  browseHasMore: boolean;
  cachedAssets: CacheAsset[];
  historyItems: PlaybackHistoryEntry[];
  trackedItems: TrackedCacheItem[];
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenCachedAsset: (assetKey: string) => void;
  onFocusedAssetHandled?: () => void;
  onLoadMoreBrowse: () => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}

export function LibraryTab({
  creditPolicy,
  query,
  error,
  focusedAssetKey,
  viewMode,
  results,
  browseChannel,
  browseResults,
  browseLoading,
  browseLoadingMore,
  browseHasMore,
  cachedAssets,
  historyItems,
  trackedItems,
  pendingAssetKeys,
  trackedByAssetKey,
  onOpenCachedAsset,
  onFocusedAssetHandled,
  onLoadMoreBrowse,
  onViewModeChange,
  onSelect
}: LibraryTabProps) {
  const hasQuery = query.trim().length > 0;
  const [detailResult, setDetailResult] = useState<ResultWithCache | undefined>();

  useEffect(() => {
    setDetailResult(undefined);
  }, [browseChannel, query]);

  useEffect(() => {
    if (!focusedAssetKey) {
      return;
    }

    const focusedResult = [...results, ...browseResults].find((result) => result.assetKey === focusedAssetKey);
    if (focusedResult) {
      setDetailResult(focusedResult);
      onFocusedAssetHandled?.();
    }
  }, [browseResults, focusedAssetKey, onFocusedAssetHandled, results]);

  return (
    <div className="grid gap-5">
      {error ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-200">
          {error}
        </div>
      ) : null}

      {detailResult ? (
        <MovieDetailView
          creditPolicy={creditPolicy}
          result={detailResult}
          pendingAssetKeys={pendingAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onBack={() => setDetailResult(undefined)}
          onSelect={onSelect}
        />
      ) : !hasQuery && results.length === 0 ? (
        <LibraryHome
          creditPolicy={creditPolicy}
          cachedAssets={cachedAssets}
          browseChannel={browseChannel}
          browseResults={browseResults}
          browseLoading={browseLoading}
          browseLoadingMore={browseLoadingMore}
          browseHasMore={browseHasMore}
          historyItems={historyItems}
          pendingAssetKeys={pendingAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onOpenCachedAsset={onOpenCachedAsset}
          onLoadMoreBrowse={onLoadMoreBrowse}
          onOpenDetail={setDetailResult}
          onSelect={onSelect}
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
                      creditPolicy={creditPolicy}
                      key={result.assetKey}
                      result={result}
                      pendingAssetKeys={pendingAssetKeys}
                      trackedByAssetKey={trackedByAssetKey}
                      onOpenDetail={setDetailResult}
                      onSelect={onSelect}
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <MovieListView
              creditPolicy={creditPolicy}
              results={results}
              pendingAssetKeys={pendingAssetKeys}
              trackedByAssetKey={trackedByAssetKey}
              onOpenDetail={setDetailResult}
              onSelect={onSelect}
            />
          )}
        </>
      )}
    </div>
  );
}

type BrowseViewId =
  | "recent"
  | "newGood"
  | "popular"
  | "topRated"
  | "mostWatched"
  | "doubanRank"
  | "imdbRank"
  | "rottenRank";

const browseInitialCount = 12;
const browseLoadStep = 12;

const browseViews: Array<{
  id: BrowseViewId;
  label: string;
  detail: string;
  icon: typeof CalendarDays;
}> = [
  { id: "recent", label: "最近更新", detail: "按目录更新时间排列", icon: CalendarDays },
  { id: "newGood", label: "近期佳片", detail: "新片优先，兼顾评分", icon: Sparkles },
  { id: "popular", label: "热门佳片", detail: "播放与评分综合排序", icon: Flame },
  { id: "topRated", label: "评价最高", detail: "优先展示评分条目", icon: Star },
  { id: "mostWatched", label: "观看最高", detail: "按家庭播放记录排序", icon: Eye }
];

const movieBrowseViews: Array<{
  id: BrowseViewId;
  label: string;
  detail: string;
  icon: typeof CalendarDays;
}> = [
  { id: "doubanRank", label: "豆瓣排名", detail: "按豆瓣评分优先排列", icon: Trophy },
  { id: "imdbRank", label: "IMDb 排名", detail: "按 IMDb 评分优先排列", icon: Star },
  { id: "rottenRank", label: "烂番茄排名", detail: "按烂番茄评分优先排列", icon: Flame },
  { id: "newGood", label: "近期佳片", detail: "新片优先，兼顾评分", icon: Sparkles },
  { id: "popular", label: "热门佳片", detail: "播放与评分综合排序", icon: Eye }
];

function viewsForBrowseChannel(channel: BrowseChannel) {
  return channel === "movie" ? movieBrowseViews : browseViews;
}

function LibraryHome({
  creditPolicy,
  cachedAssets,
  browseChannel,
  browseResults,
  browseLoading,
  browseLoadingMore,
  browseHasMore,
  historyItems,
  pendingAssetKeys,
  trackedByAssetKey,
  onOpenCachedAsset,
  onLoadMoreBrowse,
  onOpenDetail,
  onSelect
}: {
  creditPolicy: CreditPolicyResponse;
  cachedAssets: CacheAsset[];
  browseChannel: BrowseChannel;
  browseResults: ResultWithCache[];
  browseLoading: boolean;
  browseLoadingMore: boolean;
  browseHasMore: boolean;
  historyItems: PlaybackHistoryEntry[];
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenCachedAsset: (assetKey: string) => void;
  onLoadMoreBrowse: () => void;
  onOpenDetail: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const [activeView, setActiveView] = useState<BrowseViewId>("recent");
  const [visibleItemCount, setVisibleItemCount] = useState(browseInitialCount);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const channelViews = viewsForBrowseChannel(browseChannel);
  const activeSortView = (channelViews.find((view) => view.id === activeView) ?? channelViews[0]).id;
  const browsableResults = useMemo(
    () => browseResults.filter((result) => (result.variants?.length ?? 0) > 0 && resultMatchesBrowseChannel(result, browseChannel)),
    [browseChannel, browseResults]
  );
  const historyStats = useMemo(() => historyStatsByAssetKey(historyItems), [historyItems]);
  const rankedResults = useMemo(
    () => rankBrowseResults(activeSortView, browsableResults, historyStats),
    [activeSortView, browsableResults, historyStats]
  );
  const rankedAssets = useMemo(
    () => rankCachedAssets(activeSortView, cachedAssets),
    [activeSortView, cachedAssets]
  );
  const browsingResults = rankedResults.length > 0;
  const totalVisibleItems = browsingResults ? rankedResults.length : rankedAssets.length;
  const visibleResults = useMemo(
    () => rankedResults.slice(0, visibleItemCount),
    [rankedResults, visibleItemCount]
  );
  const visibleAssets = useMemo(
    () => rankedAssets.slice(0, visibleItemCount),
    [rankedAssets, visibleItemCount]
  );
  const hasMoreItems = visibleItemCount < totalVisibleItems;
  const browseInitialLoading = browseLoading && rankedResults.length === 0;

  function showMoreItems() {
    if (!hasMoreItems) {
      if (browseHasMore && !browseLoadingMore) {
        onLoadMoreBrowse();
      }
      return;
    }

    setVisibleItemCount((currentCount) => Math.min(currentCount + browseLoadStep, totalVisibleItems));
  }

  useEffect(() => {
    setActiveView(viewsForBrowseChannel(browseChannel)[0].id);
  }, [browseChannel]);

  useEffect(() => {
    setVisibleItemCount(browseInitialCount);
  }, [activeSortView, browseChannel]);

  useEffect(() => {
    if ((!hasMoreItems && !browseHasMore) || !loadMoreRef.current) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        showMoreItems();
      }
    }, {
      rootMargin: "360px 0px"
    });

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [browseHasMore, browseLoadingMore, hasMoreItems, totalVisibleItems, visibleItemCount]);

  return (
    <section className="grid gap-4">
      <div className="scrollbar-none flex gap-2 overflow-x-auto rounded-md border border-slate-800 bg-slate-950 p-1">
        {channelViews.map((view) => {
          const Icon = view.icon;
          return (
            <Button
              className="flex-none"
              key={view.id}
              type="button"
              size="sm"
              variant={activeSortView === view.id ? "secondary" : "ghost"}
              onClick={() => setActiveView(view.id)}
              title={view.label}
            >
              <Icon className="h-4 w-4" />
              {view.label}
            </Button>
          );
        })}
      </div>

      <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
        {browseInitialLoading ? (
          <BrowseLoadingGrid />
        ) : browsingResults ? (
          <>
            <div className="gallery-results">
              <div className="gallery-results-grid grid gap-4">
                {visibleResults.map((result) => (
                  <MovieCard
                    creditPolicy={creditPolicy}
                    key={result.assetKey}
                    result={result}
                    pendingAssetKeys={pendingAssetKeys}
                    trackedByAssetKey={trackedByAssetKey}
                    onOpenDetail={onOpenDetail}
                    onSelect={onSelect}
                    variantLimit={3}
                  />
                ))}
              </div>
            </div>
            <LazyLoadFooter
              hasMore={hasMoreItems || browseHasMore}
              loadMoreRef={loadMoreRef}
              loading={browseLoadingMore}
              shownCount={visibleResults.length}
              totalCount={rankedResults.length}
              onLoadMore={showMoreItems}
            />
          </>
        ) : visibleAssets.length ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleAssets.map((asset) => (
                <BrowseAssetCard
                  key={asset.assetKey}
                  asset={asset}
                  creditPolicy={creditPolicy}
                  onOpen={onOpenCachedAsset}
                />
              ))}
            </div>
            <LazyLoadFooter
              hasMore={hasMoreItems || browseHasMore}
              loadMoreRef={loadMoreRef}
              loading={browseLoadingMore}
              shownCount={visibleAssets.length}
              totalCount={rankedAssets.length}
              onLoadMore={showMoreItems}
            />
          </>
        ) : browseHasMore ? (
          <>
            <EmptyState icon={<Database className="h-5 w-5" />} title="继续加载更多影片" />
            <LazyLoadFooter
              hasMore
              loadMoreRef={loadMoreRef}
              loading={browseLoadingMore}
              shownCount={0}
              totalCount={0}
              onLoadMore={showMoreItems}
            />
          </>
        ) : (
          <EmptyState icon={<Database className="h-5 w-5" />} title="暂无可浏览影片" />
        )}
      </div>
    </section>
  );
}

function LazyLoadFooter({
  hasMore,
  loadMoreRef,
  loading,
  shownCount,
  totalCount,
  onLoadMore
}: {
  hasMore: boolean;
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  shownCount: number;
  totalCount: number;
  onLoadMore: () => void;
}) {
  if (!hasMore && totalCount <= browseInitialCount) {
    return null;
  }

  return (
    <div ref={loadMoreRef} className="flex justify-center pt-1">
      {hasMore ? (
        <Button type="button" variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
          {loading ? "加载中" : "加载更多"}
          {totalCount > 0 ? <Badge variant="secondary">{shownCount}/{totalCount}{hasMore ? "+" : ""}</Badge> : null}
        </Button>
      ) : (
        <Badge variant="muted">已显示 {totalCount}</Badge>
      )}
    </div>
  );
}

function BrowseLoadingGrid() {
  return (
    <div className="gallery-results" aria-busy="true" aria-label="正在加载浏览目录">
      <div className="gallery-results-grid grid gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <article
            className="grid h-full grid-cols-[96px_minmax(0,1fr)] content-start gap-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 p-3 shadow-2xl shadow-black/20 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4 sm:p-4"
            key={index}
          >
            <div className="aspect-[2/3] animate-pulse rounded-md bg-slate-800/70" />
            <div className="grid min-w-0 content-start gap-3">
              <div className="h-5 w-4/5 animate-pulse rounded bg-slate-800/70" />
              <div className="flex gap-2">
                <div className="h-6 w-12 animate-pulse rounded-full bg-slate-800/70" />
                <div className="h-6 w-14 animate-pulse rounded-full bg-slate-800/70" />
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="h-6 w-14 animate-pulse rounded-full bg-slate-800/60" />
                <div className="h-6 w-16 animate-pulse rounded-full bg-slate-800/60" />
              </div>
            </div>
            <div className="col-span-2 grid min-w-0 gap-3">
              <div className="space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-slate-800/60" />
                <div className="h-4 w-11/12 animate-pulse rounded bg-slate-800/50" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800/40" />
              </div>
              <div className="grid gap-2">
                <div className="h-10 animate-pulse rounded-md bg-slate-800/70" />
                <div className="h-10 animate-pulse rounded-md bg-slate-800/50" />
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function normalizedMetadataText(result: SearchResult) {
  const metadata = result.metadata;
  return [
    metadata?.type,
    metadata?.ratingLevel?.join(" "),
    metadata?.genres?.join(" "),
    metadata?.info,
    metadata?.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function resultMatchesBrowseChannel(result: SearchResult, channel: BrowseChannel) {
  if (channel === "recommended") {
    return true;
  }

  const text = normalizedMetadataText(result);
  if (channel === "animation") {
    return /动画|動漫|anime|animation|animated/.test(text);
  }

  if (channel === "tv") {
    return /电视|电视剧|剧集|影集|tv|series|season|show/.test(text);
  }

  return /电影|movie|film/.test(text) && !/电视|电视剧|剧集|影集|tv series|series/.test(text);
}

function toTime(value?: string) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function historyStatsByAssetKey(historyItems: PlaybackHistoryEntry[]) {
  const stats = new Map<string, { count: number; lastPlayedAt: number }>();
  for (const item of historyItems) {
    const current = stats.get(item.assetKey) ?? { count: 0, lastPlayedAt: 0 };
    stats.set(item.assetKey, {
      count: current.count + 1,
      lastPlayedAt: Math.max(current.lastPlayedAt, toTime(item.playedAt))
    });
  }
  return stats;
}

function numericRating(result: SearchResult) {
  const ratings = ratingCandidates(result);
  const values = ratings
    .map((rating) => Number.parseFloat(rating.value.replace(/[^\d.]/g, "")))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : 0;
}

function sourceRating(result: SearchResult, source: "douban" | "imdb" | "rotten") {
  const rating = ratingCandidates(result).find((item) => ratingSourceConfig[source].match.test(item.label));
  const value = Number.parseFloat(rating?.value.replace(/[^\d.]/g, "") ?? "");
  return Number.isFinite(value) ? value : 0;
}

function sourceRatingSort(source: "douban" | "imdb" | "rotten") {
  return (left: SearchResult, right: SearchResult) => {
    const leftRating = sourceRating(left, source);
    const rightRating = sourceRating(right, source);
    const leftHasRating = leftRating > 0 ? 1 : 0;
    const rightHasRating = rightRating > 0 ? 1 : 0;

    return rightHasRating - leftHasRating ||
      rightRating - leftRating ||
      numericRating(right) - numericRating(left) ||
      toTime(right.updatedAt) - toTime(left.updatedAt);
  };
}

function releaseTime(result: SearchResult) {
  const releaseDate = toTime(result.metadata?.releaseDate);
  if (releaseDate) {
    return releaseDate;
  }

  const year = Number.parseInt(result.metadata?.year ?? "", 10);
  return Number.isFinite(year) ? toTime(`${year}-01-01`) : 0;
}

function resultKeys(result: SearchResult) {
  return [
    result.assetKey,
    ...(result.variants?.map((variant) => variant.assetKey) ?? [])
  ];
}

function resultWatchCount(result: SearchResult, stats: Map<string, { count: number; lastPlayedAt: number }>) {
  return resultKeys(result).reduce((count, key) => count + (stats.get(key)?.count ?? 0), 0);
}

function resultLastPlayedAt(result: SearchResult, stats: Map<string, { count: number; lastPlayedAt: number }>) {
  return resultKeys(result).reduce((time, key) => Math.max(time, stats.get(key)?.lastPlayedAt ?? 0), 0);
}

function rankBrowseResults(
  view: BrowseViewId,
  results: ResultWithCache[],
  stats: Map<string, { count: number; lastPlayedAt: number }>
) {
  const ranked = [...results];
  const byUpdated = (left: SearchResult, right: SearchResult) => toTime(right.updatedAt) - toTime(left.updatedAt);
  const byRating = (left: SearchResult, right: SearchResult) => numericRating(right) - numericRating(left);
  const byRelease = (left: SearchResult, right: SearchResult) => releaseTime(right) - releaseTime(left);
  const byWatch = (left: SearchResult, right: SearchResult) => resultWatchCount(right, stats) - resultWatchCount(left, stats);
  const byLastPlayed = (left: SearchResult, right: SearchResult) => resultLastPlayedAt(right, stats) - resultLastPlayedAt(left, stats);

  if (view === "doubanRank") {
    return ranked.sort(sourceRatingSort("douban"));
  }

  if (view === "imdbRank") {
    return ranked.sort(sourceRatingSort("imdb"));
  }

  if (view === "rottenRank") {
    return ranked.sort(sourceRatingSort("rotten"));
  }

  if (view === "newGood") {
    return ranked.sort((left, right) => byRelease(left, right) || byRating(left, right) || byUpdated(left, right));
  }

  if (view === "popular") {
    return ranked.sort((left, right) => byWatch(left, right) || byRating(left, right) || byUpdated(left, right));
  }

  if (view === "topRated") {
    return ranked.sort((left, right) => byRating(left, right) || byUpdated(left, right));
  }

  if (view === "mostWatched") {
    return ranked.sort((left, right) => byWatch(left, right) || byLastPlayed(left, right) || byUpdated(left, right));
  }

  return ranked.sort(byUpdated);
}

function assetActivityTime(asset: CacheAsset) {
  return toTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt);
}

function rankCachedAssets(view: BrowseViewId, assets: CacheAsset[]) {
  const ranked = [...assets];
  if (view === "mostWatched" || view === "popular") {
    return ranked.sort((left, right) => toTime(right.lastPlayedAt) - toTime(left.lastPlayedAt) || assetActivityTime(right) - assetActivityTime(left));
  }

  if (view === "topRated" || view === "newGood") {
    return ranked.sort((left, right) => (right.media?.contentLength ?? 0) - (left.media?.contentLength ?? 0) || assetActivityTime(right) - assetActivityTime(left));
  }

  return ranked.sort((left, right) => assetActivityTime(right) - assetActivityTime(left));
}

function BrowseAssetCard({
  asset,
  creditPolicy,
  onOpen
}: {
  asset: CacheAsset;
  creditPolicy: CreditPolicyResponse;
  onOpen: (assetKey: string) => void;
}) {
  const credits = playbackCreditCost(asset.media?.contentLength, creditPolicy);

  return (
    <article className="grid min-w-0 content-between gap-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 p-4 shadow-2xl shadow-black/20">
      <div className="min-w-0">
        <p className="line-clamp-2 min-h-10 font-semibold leading-5 text-slate-50">{asset.title}</p>
        <p className="mt-2 text-sm text-slate-400">
          {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
        </p>
      </div>
      <Button type="button" size="sm" onClick={() => onOpen(asset.assetKey)}>
        <Play className="h-4 w-4" />
        {formatCreditAmount(credits, creditPolicy.unitSymbol)}
      </Button>
    </article>
  );
}

type RatingSource = "douban" | "imdb" | "rotten" | "metacritic";

const ratingSourceConfig: Record<RatingSource, { label: string; shortLabel: string; match: RegExp; className: string }> = {
  douban: {
    label: "豆瓣",
    shortLabel: "豆瓣",
    match: /douban|豆瓣/i,
    className: "border-emerald-300/55 bg-emerald-400/18 text-emerald-50"
  },
  imdb: {
    label: "IMDb",
    shortLabel: "IMDb",
    match: /imdb/i,
    className: "border-amber-300/65 bg-amber-300/22 text-amber-50"
  },
  rotten: {
    label: "烂番茄",
    shortLabel: "烂番茄",
    match: /^rt$|rotten|tomato|tomatometer|烂番茄|爛番茄/i,
    className: "border-red-300/60 bg-red-400/20 text-red-50"
  },
  metacritic: {
    label: "Metacritic",
    shortLabel: "Meta",
    match: /^meta$|metacritic|meta\s*critic|metascore|metamatrix|metamatrices/i,
    className: "border-violet-300/60 bg-violet-400/22 text-violet-50"
  }
};

type DisplayRating = {
  source: RatingSource;
  sourceLabel: string;
  shortLabel: string;
  value: string;
  className: string;
};

function ratingCandidates(result: SearchResult) {
  const metadata = result.metadata;
  const ratings = [
    ...(metadata?.ratings ?? []),
    ...(metadata?.external?.omdb?.ratings ?? [])
  ];

  if (metadata?.external?.omdb?.imdbRating && metadata.external.omdb.imdbRating !== "N/A") {
    ratings.push({ label: "IMDb", value: metadata.external.omdb.imdbRating });
  }

  if (metadata?.external?.omdb?.metascore && metadata.external.omdb.metascore !== "N/A") {
    ratings.push({ label: "Metacritic", value: metadata.external.omdb.metascore });
  }

  return ratings.filter((rating) => rating.label && rating.value && rating.value !== "N/A");
}

function displayRatings(result: SearchResult): DisplayRating[] {
  const ratings = ratingCandidates(result);
  return (Object.keys(ratingSourceConfig) as RatingSource[])
    .map((source) => {
      const config = ratingSourceConfig[source];
      const rating = ratings.find((item) => config.match.test(item.label));
      return rating
        ? {
          source,
          sourceLabel: config.label,
          shortLabel: config.shortLabel,
          value: rating.value,
          className: config.className
        }
        : undefined;
    })
    .filter((rating): rating is DisplayRating => Boolean(rating));
}

function CompactRatingBadges({ result }: { result: SearchResult }) {
  const ratings = displayRatings(result);
  if (ratings.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ratings.map((rating) => (
        <span
          key={`${rating.source}-${rating.value}`}
          className={`inline-flex min-w-10 items-center justify-center rounded-full border px-2 py-1 text-xs font-bold leading-none ${rating.className}`}
          title={`${rating.sourceLabel} ${rating.value}`}
          aria-label={`${rating.sourceLabel} ${rating.value}`}
        >
          {rating.value}
        </span>
      ))}
    </div>
  );
}

function cardTags(result: SearchResult) {
  return [
    ...visibleTags(result.metadata?.genres).map((tag) => ({ key: `genre-${tag}`, tag, variant: "secondary" as const })),
    ...peopleTags(result).map((tag) => ({ key: `people-${tag}`, tag, variant: "muted" as const }))
  ].slice(0, 3);
}

function detailTags(result: SearchResult) {
  return [
    ...visibleTags(result.metadata?.genres).map((tag) => ({ key: `genre-${tag}`, tag, variant: "secondary" as const })),
    ...visibleTags(result.metadata?.people).map((tag) => ({ key: `people-${tag}`, tag, variant: "muted" as const }))
  ];
}

function MoviePoster({ result }: { result: SearchResult }) {
  const posterUrl = result.metadata?.posterUrl ?? result.metadata?.posters?.[0]?.url;

  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-slate-900">
      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 to-emerald-950 text-4xl font-black text-emerald-100">
        {titleInitial(result.title)}
      </div>
      {posterUrl ? (
        <img
          alt={result.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={posterUrl}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </div>
  );
}

function VariantButtons({
  creditPolicy,
  result,
  pendingAssetKeys,
  trackedByAssetKey,
  onSelect,
  onShowAllVariants,
  compact = false,
  variantLimit
}: {
  creditPolicy: CreditPolicyResponse;
  result: ResultWithCache;
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onShowAllVariants?: () => void;
  compact?: boolean;
  variantLimit?: number;
}) {
  const variants = result.variants ?? [];
  const visibleVariants = variantLimit ? variants.slice(0, variantLimit) : variants;
  const hiddenVariantCount = Math.max(0, variants.length - visibleVariants.length);

  if (variants.length === 0) {
    return <Badge variant="danger">无规格</Badge>;
  }

  return (
    <div className={compact ? "grid min-w-[220px] gap-2 sm:min-w-[240px]" : "grid gap-2"}>
      {visibleVariants.map((variant) => {
        const pending = pendingAssetKeys.includes(variant.assetKey);
        const tracked = trackedByAssetKey.get(variant.assetKey);
        const displayAsset = tracked?.asset ?? variant.cache;
        const displayStatus = pending
          ? "排队中"
          : tracked
            ? `${jobStatusLabel(tracked.job.status)} ${tracked.job.progress}%`
            : !displayAsset
              ? undefined
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
        const isActiveCacheHit = pending || Boolean(tracked && tracked.job.status !== "failed" && tracked.job.status !== "ready");
        const costLabel = displayAsset?.status === "ready"
            ? formatCreditAmount(playbackCreditCost(displayAsset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)
            : formatCreditAmount(creditPolicy.cacheCredits, creditPolicy.unitSymbol);
        const costBadgeClass = displayAsset?.status === "ready" && !isActiveCacheHit
          ? "border-slate-950/25 bg-slate-950/90 text-emerald-100 shadow-sm shadow-emerald-950/20"
          : undefined;

        return (
          <Button
            className={`relative h-auto min-w-0 flex-col items-start overflow-hidden px-3 py-2 text-left sm:flex-row sm:items-center sm:justify-between ${compact ? "min-h-10" : ""}`}
            key={variant.assetKey}
            type="button"
            variant={displayAsset?.status === "ready" ? "default" : "secondary"}
            onClick={() => onSelect(result, variant)}
            disabled={isActiveCacheHit}
            title={displayStatus ? `${variant.label} / ${displayStatus}` : `${variant.label} / ${costLabel}`}
            aria-label={displayStatus ? `${variant.label} / ${displayStatus}` : `${variant.label} / ${costLabel}`}
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
              {!isActiveCacheHit ? (
                <Badge className={costBadgeClass} variant="warning">
                  {costLabel}
                </Badge>
              ) : null}
              {displayStatus ? <Badge variant={badgeVariant}>{displayStatus}</Badge> : null}
            </span>
          </Button>
        );
      })}
      {hiddenVariantCount > 0 ? (
        onShowAllVariants ? (
          <Button
            className="min-h-10 justify-between rounded-full border-slate-700 bg-slate-900/80 px-3 text-slate-100 hover:bg-slate-800"
            type="button"
            variant="outline"
            size="sm"
            onClick={onShowAllVariants}
            title="查看全部规格"
          >
            还有 {hiddenVariantCount} 个规格
          </Button>
        ) : (
          <Badge variant="secondary">还有 {hiddenVariantCount} 个规格</Badge>
        )
      ) : null}
    </div>
  );
}

function MovieCard({
  creditPolicy,
  result,
  pendingAssetKeys,
  trackedByAssetKey,
  onOpenDetail,
  onSelect,
  variantLimit
}: {
  creditPolicy: CreditPolicyResponse;
  result: ResultWithCache;
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenDetail: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  variantLimit?: number;
}) {
  const tags = cardTags(result);
  const summary = bestSummary(result);

  return (
    <article className="grid h-full grid-cols-[96px_minmax(0,1fr)] content-start gap-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 p-3 shadow-2xl shadow-black/20 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4 sm:p-4">
      <button
        className="overflow-hidden rounded-md text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        type="button"
        onClick={() => onOpenDetail(result)}
        title="查看详细信息"
      >
        <MoviePoster result={result} />
      </button>
      <div className="grid min-w-0 content-start gap-3">
        <button
          className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          type="button"
          onClick={() => onOpenDetail(result)}
          title="查看详细信息"
        >
          <h2 className="line-clamp-3 text-base font-semibold leading-tight text-slate-50 transition-colors hover:text-emerald-100 sm:text-lg">
            {result.title}
          </h2>
        </button>

        <CompactRatingBadges result={result} />

        {tags.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag.key} variant={tag.variant}>{tag.tag}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="col-span-2 grid min-w-0 gap-3">
        <SummaryText summary={summary} />
        <VariantButtons
          creditPolicy={creditPolicy}
          result={result}
          pendingAssetKeys={pendingAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onSelect={onSelect}
          onShowAllVariants={() => onOpenDetail(result)}
          variantLimit={variantLimit}
        />
      </div>
    </article>
  );
}

function SummaryText({ summary }: { summary: string }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipId = useId();

  return (
    <>
      <p
        aria-describedby={tooltipOpen ? tooltipId : undefined}
        className="line-clamp-3 h-[4.5rem] cursor-help rounded-sm text-sm leading-6 text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 sm:line-clamp-4 sm:h-24"
        tabIndex={0}
        onBlur={() => setTooltipOpen(false)}
        onFocus={() => setTooltipOpen(true)}
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
      >
        {summary}
      </p>
      {tooltipOpen ? (
        <div
          className="fixed bottom-6 left-1/2 z-[200] max-h-[60vh] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-md border border-slate-600 bg-slate-950 px-4 py-3 text-sm leading-7 text-slate-100 shadow-2xl shadow-black/50"
          id={tooltipId}
          role="tooltip"
        >
          {summary}
        </div>
      ) : null}
    </>
  );
}

function MovieListView({
  creditPolicy,
  results,
  pendingAssetKeys,
  trackedByAssetKey,
  onOpenDetail,
  onSelect
}: {
  creditPolicy: CreditPolicyResponse;
  results: ResultWithCache[];
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenDetail: (result: ResultWithCache) => void;
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
                    <button
                      className="w-14 shrink-0 overflow-hidden rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      type="button"
                      onClick={() => onOpenDetail(result)}
                      title="查看详细信息"
                    >
                      <MoviePoster result={result} />
                    </button>
                    <div className="min-w-0">
                      <button
                        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        type="button"
                        onClick={() => onOpenDetail(result)}
                        title="查看详细信息"
                      >
                        <p className="line-clamp-2 font-semibold leading-5 text-slate-50 hover:text-emerald-100">{result.title}</p>
                      </button>
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
                    creditPolicy={creditPolicy}
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

function MovieDetailView({
  creditPolicy,
  result,
  pendingAssetKeys,
  trackedByAssetKey,
  onBack,
  onSelect
}: {
  creditPolicy: CreditPolicyResponse;
  result: ResultWithCache;
  pendingAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onBack: () => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const tags = detailTags(result);
  const ratings = displayRatings(result);
  const directors = directorLine(result);
  const summary = bestSummary(result);
  const variantCount = result.variants?.length ?? 0;

  return (
    <section className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          返回列表
        </Button>
        <Badge variant="secondary">{variantCount} 个规格</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="max-w-[220px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
          <MoviePoster result={result} />
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold leading-tight text-slate-50">{result.title}</h2>
            <p className="mt-2 text-sm text-slate-400">{metadataLine(result)}</p>
            {directors ? (
              <p className="mt-2 text-sm font-semibold text-slate-300">导演 {directors}</p>
            ) : null}
          </div>

          {ratings.length ? (
            <div className="flex flex-wrap gap-2">
              {ratings.map((rating) => (
                <span
                  key={`detail-rating-${rating.source}-${rating.value}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold leading-none ${rating.className}`}
                  title={`${rating.sourceLabel} ${rating.value}`}
                  aria-label={`${rating.sourceLabel} ${rating.value}`}
                >
                  <span className="font-semibold opacity-80">{rating.sourceLabel}</span>
                  <span>{rating.value}</span>
                </span>
              ))}
            </div>
          ) : null}

          {tags.length ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge key={`detail-${tag.key}`} variant={tag.variant}>{tag.tag}</Badge>
              ))}
            </div>
          ) : null}

          <div className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/80 p-4">
            <h3 className="text-sm font-semibold text-slate-200">简介</h3>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{summary}</p>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-200">全部规格</h3>
              <Badge variant="muted">{variantCount}</Badge>
            </div>
            <VariantButtons
              creditPolicy={creditPolicy}
              result={result}
              pendingAssetKeys={pendingAssetKeys}
              trackedByAssetKey={trackedByAssetKey}
              onSelect={onSelect}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
