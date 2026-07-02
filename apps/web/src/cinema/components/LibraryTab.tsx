import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  Database,
  Download,
  Eye,
  Film,
  Flame,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Sparkles,
  Star,
  Shuffle,
  Trophy
} from "lucide-react";
import type { CacheAsset, CreditPolicyResponse, MediaVariant, MovieSummaryMode, MovieSummaryResponse, SearchResult } from "@wwpdw/shared";
import { errorMessage, summarizeMovie as requestMovieSummary } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import {
  bestSummary,
  bestDetailSummary,
  cacheLabel,
  cacheVariant,
  directorLine,
  displayVariantLabel,
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
import { genreBadgeClass } from "../genre-style";
import { copy } from "../i18n";
import { tspdtImdbIds } from "../tspdt-id-map";
import { tspdtChineseTitles } from "../tspdt-zh";
import { tspdtEdition, tspdtSourceUrl, tspdtTop1000, type TspdtEntry } from "../tspdt";
import { formatCreditAmount, playbackCreditCost, type BrowseChannel, type BrowseViewId, type LibraryViewMode, type PlaybackHistoryEntry, type ResultWithCache, type TrackedCacheItem } from "../types";
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
  browseLoadMode: "paged" | "random";
  cachedAssets: CacheAsset[];
  historyItems: PlaybackHistoryEntry[];
  trackedItems: TrackedCacheItem[];
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  favoriteAssetKeys: Set<string>;
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenCachedAsset: (assetKey: string) => void;
  onFocusedAssetHandled?: () => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onRefreshBrowse: (options?: { append?: boolean; mode?: "paged" | "random"; limit?: number; view?: BrowseViewId }) => void;
  onViewModeChange: (value: LibraryViewMode) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
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
  browseLoadMode,
  cachedAssets,
  historyItems,
  trackedItems,
  pendingAssetKeys,
  pendingDownloadAssetKeys,
  favoriteAssetKeys,
  trackedByAssetKey,
  onOpenCachedAsset,
  onFocusedAssetHandled,
  onToggleFavorite,
  onRefreshBrowse,
  onViewModeChange,
  onSelect,
  onDownload
}: LibraryTabProps) {
  const hasQuery = query.trim().length > 0;
  const [detailResult, setDetailResult] = useState<ResultWithCache | undefined>();
  const [summaryDialog, setSummaryDialog] = useState<{
    open: boolean;
    result?: ResultWithCache;
    mode: MovieSummaryMode;
    loading: boolean;
    error: string;
    response?: MovieSummaryResponse;
  }>({
    open: false,
    mode: "spoiler_free",
    loading: false,
    error: ""
  });

  async function loadMovieSummary(result: ResultWithCache, mode: MovieSummaryMode) {
    setSummaryDialog({
      open: true,
      result,
      mode,
      loading: true,
      error: "",
      response: undefined
    });

    try {
      const response = await requestMovieSummary({ mode, result });
      setSummaryDialog({
        open: true,
        result,
        mode,
        loading: false,
        error: "",
        response
      });
    } catch (summaryError) {
      setSummaryDialog({
        open: true,
        result,
        mode,
        loading: false,
        error: errorMessage(summaryError, copy.fallbackErrors.movieSummary),
        response: undefined
      });
    }
  }

  function openMovieSummary(result: ResultWithCache) {
    setSummaryDialog({
      open: true,
      result,
      mode: "spoiler_free",
      loading: false,
      error: "",
      response: undefined
    });
  }

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
          pendingDownloadAssetKeys={pendingDownloadAssetKeys}
          favoriteAssetKeys={favoriteAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onBack={() => setDetailResult(undefined)}
          onSummarize={openMovieSummary}
          onToggleFavorite={onToggleFavorite}
          onSelect={onSelect}
          onDownload={onDownload}
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
          browseLoadMode={browseLoadMode}
          historyItems={historyItems}
          pendingAssetKeys={pendingAssetKeys}
          pendingDownloadAssetKeys={pendingDownloadAssetKeys}
          favoriteAssetKeys={favoriteAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onOpenCachedAsset={onOpenCachedAsset}
          onRefreshBrowse={onRefreshBrowse}
          onOpenDetail={setDetailResult}
          onSummarize={openMovieSummary}
          onToggleFavorite={onToggleFavorite}
          onSelect={onSelect}
          onDownload={onDownload}
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
              title={copy.library.galleryView}
            >
              <LayoutGrid className="h-4 w-4" />
              {copy.library.gallery}
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              type="button"
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              onClick={() => onViewModeChange("list")}
              title={copy.library.listView}
            >
              <List className="h-4 w-4" />
              {copy.library.list}
            </Button>
          </div>

          {viewMode === "gallery" ? (
            <div className="gallery-results">
              <div className="gallery-results-grid grid gap-4">
                {results.length === 0 ? (
                  <div className="col-span-full">
                    <EmptyState icon={<Film className="h-5 w-5" />} title={copy.library.noTitlesFound} />
                  </div>
                ) : (
                  results.map((result) => (
                    <MovieCard
                      creditPolicy={creditPolicy}
                      key={result.assetKey}
                      result={result}
                      pendingAssetKeys={pendingAssetKeys}
                      pendingDownloadAssetKeys={pendingDownloadAssetKeys}
                      favoriteAssetKeys={favoriteAssetKeys}
                      trackedByAssetKey={trackedByAssetKey}
                      onOpenDetail={setDetailResult}
                      onSummarize={openMovieSummary}
                      onToggleFavorite={onToggleFavorite}
                      onSelect={onSelect}
                      onDownload={onDownload}
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
              pendingDownloadAssetKeys={pendingDownloadAssetKeys}
              favoriteAssetKeys={favoriteAssetKeys}
              trackedByAssetKey={trackedByAssetKey}
              onOpenDetail={setDetailResult}
              onSummarize={openMovieSummary}
              onToggleFavorite={onToggleFavorite}
              onSelect={onSelect}
              onDownload={onDownload}
            />
          )}
        </>
      )}

      <MovieSummaryDialog
        state={summaryDialog}
        onOpenChange={(open) => {
          setSummaryDialog((current) => ({
            ...current,
            open
          }));
        }}
        onModeChange={(mode) => {
          if (
            summaryDialog.result &&
            !summaryDialog.loading &&
            (mode !== summaryDialog.mode || summaryDialog.response?.mode !== mode)
          ) {
            void loadMovieSummary(summaryDialog.result, mode);
          }
        }}
      />
    </div>
  );
}

const browseInitialCount = 12;
const browseLoadStep = 12;
const browseViewItemLimit = 300;
const browseRandomLimit = 48;
const luckyRanks = new Map<string, number>();

function randomBrowseSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

const browseViews: Array<{
  id: BrowseViewId;
  label: string;
  detail: string;
  icon: typeof CalendarDays;
}> = [
  { id: "lucky", label: copy.library.browseViews.lucky.label, detail: copy.library.browseViews.lucky.detail, icon: Shuffle },
  { id: "recent", label: copy.library.browseViews.recent.label, detail: copy.library.browseViews.recent.detail, icon: CalendarDays },
  { id: "newGood", label: copy.library.browseViews.newGood.label, detail: copy.library.browseViews.newGood.detail, icon: Sparkles },
  { id: "popular", label: copy.library.browseViews.popular.label, detail: copy.library.browseViews.popular.detail, icon: Flame },
  { id: "topRated", label: copy.library.browseViews.topRated.label, detail: copy.library.browseViews.topRated.detail, icon: Star },
  { id: "mostWatched", label: copy.library.browseViews.mostWatched.label, detail: copy.library.browseViews.mostWatched.detail, icon: Eye }
];

const movieBrowseViews: Array<{
  id: BrowseViewId;
  label: string;
  detail: string;
  icon: typeof CalendarDays;
}> = [
  { id: "newGood", label: copy.library.browseViews.newGood.label, detail: copy.library.browseViews.newGood.detail, icon: Sparkles },
  { id: "popular", label: copy.library.browseViews.popular.label, detail: copy.library.browseViews.popular.detail, icon: Eye },
  { id: "doubanRank", label: copy.library.browseViews.doubanRank.label, detail: copy.library.browseViews.doubanRank.detail, icon: Trophy },
  { id: "imdbRank", label: copy.library.browseViews.imdbRank.label, detail: copy.library.browseViews.imdbRank.detail, icon: Star },
  { id: "rottenRank", label: copy.library.browseViews.rottenRank.label, detail: copy.library.browseViews.rottenRank.detail, icon: Flame },
  { id: "tspdtRank", label: copy.library.browseViews.tspdtRank.label, detail: copy.library.browseViews.tspdtRank.detail, icon: Trophy }
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
  browseLoadMode,
  historyItems,
  pendingAssetKeys,
  pendingDownloadAssetKeys,
  favoriteAssetKeys,
  trackedByAssetKey,
  onOpenCachedAsset,
  onRefreshBrowse,
  onOpenDetail,
  onSummarize,
  onToggleFavorite,
  onSelect,
  onDownload
}: {
  creditPolicy: CreditPolicyResponse;
  cachedAssets: CacheAsset[];
  browseChannel: BrowseChannel;
  browseResults: ResultWithCache[];
  browseLoading: boolean;
  browseLoadingMore: boolean;
  browseHasMore: boolean;
  browseLoadMode: "paged" | "random";
  historyItems: PlaybackHistoryEntry[];
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  favoriteAssetKeys: Set<string>;
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenCachedAsset: (assetKey: string) => void;
  onRefreshBrowse: (options?: { append?: boolean; mode?: "paged" | "random"; limit?: number; view?: BrowseViewId }) => void;
  onOpenDetail: (result: ResultWithCache) => void;
  onSummarize: (result: ResultWithCache) => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const [activeView, setActiveView] = useState<BrowseViewId>("lucky");
  const [viewSeed, setViewSeed] = useState(() => randomBrowseSeed());
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
    () => rankBrowseResults(activeSortView, browsableResults, historyStats, viewSeed),
    [activeSortView, browsableResults, historyStats, viewSeed]
  );
  const rankedAssets = useMemo(
    () => rankCachedAssets(activeSortView, cachedAssets),
    [activeSortView, cachedAssets]
  );
  const tspdtItems = useMemo(
    () => buildTspdtRankItems(browsableResults),
    [browsableResults]
  );
  const tspdtMatchedCount = useMemo(
    () => tspdtItems.filter((item) => Boolean(item.result)).length,
    [tspdtItems]
  );
  const showingTspdtRank = activeSortView === "tspdtRank";
  const needsFullBrowseResults = showingTspdtRank || activeSortView === "popular" || activeSortView === "mostWatched";
  const browsingResults = rankedResults.length > 0;
  const totalRankedItems = showingTspdtRank
    ? tspdtItems.length
    : browsingResults
      ? rankedResults.length
      : rankedAssets.length;
  const totalVisibleItems = Math.min(totalRankedItems, browseViewItemLimit);
  const loadedBrowseItemCount = showingTspdtRank ? browsableResults.length : totalRankedItems;
  const canLoadMoreFromServer = browseHasMore && loadedBrowseItemCount < browseViewItemLimit;
  const reachedBrowseViewLimit = totalVisibleItems >= browseViewItemLimit && (totalRankedItems > browseViewItemLimit || browseHasMore);
  const visibleResults = useMemo(
    () => rankedResults.slice(0, visibleItemCount),
    [rankedResults, visibleItemCount]
  );
  const visibleAssets = useMemo(
    () => rankedAssets.slice(0, visibleItemCount),
    [rankedAssets, visibleItemCount]
  );
  const visibleTspdtItems = useMemo(
    () => tspdtItems.slice(0, visibleItemCount),
    [tspdtItems, visibleItemCount]
  );
  const hasMoreItems = visibleItemCount < totalVisibleItems;
  const browseInitialLoading = browseLoading && rankedResults.length === 0 && !showingTspdtRank;

  function showMoreItems() {
    if (!hasMoreItems) {
      if (canLoadMoreFromServer && !browseLoadingMore) {
        onRefreshBrowse({ append: true, mode: "paged", limit: 100, view: activeSortView });
      }
      return;
    }

    setVisibleItemCount((currentCount) => Math.min(currentCount + browseLoadStep, totalVisibleItems));
  }

  useEffect(() => {
    setActiveView(viewsForBrowseChannel(browseChannel)[0].id);
    setViewSeed(randomBrowseSeed());
  }, [browseChannel]);

  useEffect(() => {
    setVisibleItemCount(browseInitialCount);
  }, [activeSortView, browseChannel]);

  useEffect(() => {
    if (!needsFullBrowseResults || browseLoading || browseLoadingMore || loadedBrowseItemCount >= browseViewItemLimit) {
      return;
    }

    if (browseLoadMode !== "paged") {
      onRefreshBrowse({ mode: "paged", limit: 100, view: activeSortView });
      return;
    }

    if (canLoadMoreFromServer) {
      onRefreshBrowse({ append: true, mode: "paged", limit: 100, view: activeSortView });
    }
  }, [activeSortView, browseLoadMode, browseLoading, browseLoadingMore, browseResults.length, canLoadMoreFromServer, loadedBrowseItemCount, needsFullBrowseResults, onRefreshBrowse]);

  useEffect(() => {
    if ((!hasMoreItems && !canLoadMoreFromServer) || !loadMoreRef.current) {
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
  }, [browseLoadingMore, canLoadMoreFromServer, hasMoreItems, totalVisibleItems, visibleItemCount]);

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
              onClick={() => {
                setActiveView(view.id);
                setViewSeed(randomBrowseSeed());
                onRefreshBrowse({
                  mode: view.id === "lucky" ? "random" : "paged",
                  limit: view.id === "lucky" ? browseRandomLimit : 100,
                  view: view.id
                });
              }}
              title={view.label}
            >
              <Icon className="h-4 w-4" />
              {view.label}
            </Button>
          );
        })}
      </div>

      <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
        {showingTspdtRank ? (
          <>
            <TspdtRankView
              creditPolicy={creditPolicy}
              catalogLoadedCount={browsableResults.length}
              hasMoreCatalogItems={browseHasMore}
              items={visibleTspdtItems}
              matchedCount={tspdtMatchedCount}
              pendingAssetKeys={pendingAssetKeys}
              pendingDownloadAssetKeys={pendingDownloadAssetKeys}
              favoriteAssetKeys={favoriteAssetKeys}
              trackedByAssetKey={trackedByAssetKey}
              totalCount={tspdtItems.length}
              onOpenDetail={onOpenDetail}
              onSummarize={onSummarize}
              onToggleFavorite={onToggleFavorite}
              onSelect={onSelect}
              onDownload={onDownload}
            />
            <LazyLoadFooter
              capped={reachedBrowseViewLimit}
              hasMore={hasMoreItems || canLoadMoreFromServer}
              loadMoreRef={loadMoreRef}
              loading={browseLoadingMore}
              shownCount={visibleTspdtItems.length}
              totalCount={totalRankedItems}
              onLoadMore={showMoreItems}
            />
          </>
        ) : browseInitialLoading ? (
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
                    pendingDownloadAssetKeys={pendingDownloadAssetKeys}
                    favoriteAssetKeys={favoriteAssetKeys}
                    trackedByAssetKey={trackedByAssetKey}
                    onOpenDetail={onOpenDetail}
                    onSummarize={onSummarize}
                    onToggleFavorite={onToggleFavorite}
                    onSelect={onSelect}
                    onDownload={onDownload}
                    variantLimit={3}
                  />
                ))}
              </div>
            </div>
            <LazyLoadFooter
              capped={reachedBrowseViewLimit}
              hasMore={hasMoreItems || canLoadMoreFromServer}
              loadMoreRef={loadMoreRef}
              loading={browseLoadingMore}
              shownCount={visibleResults.length}
              totalCount={totalRankedItems}
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
              capped={reachedBrowseViewLimit}
              hasMore={hasMoreItems || canLoadMoreFromServer}
              loadMoreRef={loadMoreRef}
              loading={browseLoadingMore}
              shownCount={visibleAssets.length}
              totalCount={totalRankedItems}
              onLoadMore={showMoreItems}
            />
          </>
        ) : canLoadMoreFromServer ? (
          <>
            <EmptyState icon={<Database className="h-5 w-5" />} title={copy.library.continueLoading} />
            <LazyLoadFooter
              capped={false}
              hasMore
              loadMoreRef={loadMoreRef}
              loading={browseLoadingMore}
              shownCount={0}
              totalCount={0}
              onLoadMore={showMoreItems}
            />
          </>
        ) : (
          <EmptyState icon={<Database className="h-5 w-5" />} title={copy.library.emptyBrowse} />
        )}
      </div>
    </section>
  );
}

function LazyLoadFooter({
  capped,
  hasMore,
  loadMoreRef,
  loading,
  shownCount,
  totalCount,
  onLoadMore
}: {
  capped: boolean;
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
          {loading ? copy.common.loading : copy.library.loadMore}
          {totalCount > 0 ? <Badge variant="secondary">{shownCount}/{totalCount}{hasMore ? "+" : ""}</Badge> : null}
        </Button>
      ) : (
        <Badge variant="muted">{capped ? copy.library.loadedLimit(shownCount) : copy.library.loadedAll(totalCount)}</Badge>
      )}
    </div>
  );
}

function BrowseLoadingGrid() {
  return (
    <div className="gallery-results" aria-busy="true" aria-label={copy.library.browseLoadingLabel}>
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

interface TspdtRankItem {
  entry: TspdtEntry;
  result?: ResultWithCache;
}

function TspdtRankView({
  creditPolicy,
  catalogLoadedCount,
  hasMoreCatalogItems,
  items,
  matchedCount,
  pendingAssetKeys,
  pendingDownloadAssetKeys,
  favoriteAssetKeys,
  trackedByAssetKey,
  totalCount,
  onOpenDetail,
  onSummarize,
  onToggleFavorite,
  onSelect,
  onDownload
}: {
  creditPolicy: CreditPolicyResponse;
  catalogLoadedCount: number;
  hasMoreCatalogItems: boolean;
  items: TspdtRankItem[];
  matchedCount: number;
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  favoriteAssetKeys: Set<string>;
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  totalCount: number;
  onOpenDetail: (result: ResultWithCache) => void;
  onSummarize: (result: ResultWithCache) => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">TSPDT {tspdtEdition}</Badge>
          <Badge variant="muted">{copy.library.tspdtMatched(matchedCount, totalCount)}</Badge>
          <Badge variant="muted">{copy.library.tspdtCatalogLoaded(catalogLoadedCount, hasMoreCatalogItems)}</Badge>
        </div>
        <a
          className="text-xs font-semibold text-slate-500 transition-colors hover:text-emerald-200"
          href={tspdtSourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          theyshootpictures.com
        </a>
      </div>
      <div className="grid gap-2">
        {items.map((item) => (
          <TspdtRankRow
            creditPolicy={creditPolicy}
            item={item}
            key={item.entry.rank}
            pendingAssetKeys={pendingAssetKeys}
            pendingDownloadAssetKeys={pendingDownloadAssetKeys}
            favoriteAssetKeys={favoriteAssetKeys}
            trackedByAssetKey={trackedByAssetKey}
            onOpenDetail={onOpenDetail}
            onSummarize={onSummarize}
            onToggleFavorite={onToggleFavorite}
            onSelect={onSelect}
            onDownload={onDownload}
          />
        ))}
      </div>
    </div>
  );
}

function TspdtRankRow({
  creditPolicy,
  item,
  pendingAssetKeys,
  pendingDownloadAssetKeys,
  favoriteAssetKeys,
  trackedByAssetKey,
  onOpenDetail,
  onSummarize,
  onToggleFavorite,
  onSelect,
  onDownload
}: {
  creditPolicy: CreditPolicyResponse;
  item: TspdtRankItem;
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  favoriteAssetKeys: Set<string>;
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenDetail: (result: ResultWithCache) => void;
  onSummarize: (result: ResultWithCache) => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const { entry, result } = item;
  const title = tspdtDisplayTitle(item);

  if (!result) {
    return (
      <article className="grid min-h-[4.75rem] grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-slate-900 bg-slate-950/45 px-3 py-3 opacity-80 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(220px,0.65fr)]">
        <RankNumber rank={entry.rank} />
        <h3 className="min-w-0 truncate text-sm font-semibold text-slate-300 sm:text-base">{title}</h3>
        <div aria-hidden="true" className="hidden sm:block" />
      </article>
    );
  }

  const tags = cardTags(result);
  return (
    <article className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/80 p-3 shadow-xl shadow-black/10 lg:grid-cols-[4.5rem_84px_minmax(0,1fr)_minmax(260px,0.72fr)]">
      <RankNumber rank={entry.rank} />
      <button
        className="hidden overflow-hidden rounded-md text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 lg:block"
        type="button"
        onClick={() => onOpenDetail(result)}
        title={copy.library.viewDetails}
      >
        <MoviePoster result={result} />
      </button>
      <div className="grid min-w-0 content-start gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <button
            className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            type="button"
            onClick={() => onOpenDetail(result)}
            title={copy.library.viewDetails}
          >
            <h3 className="line-clamp-2 text-base font-semibold leading-tight text-slate-50 hover:text-emerald-100">
              {title}
            </h3>
          </button>
          <div className="flex items-center gap-1">
            <AiSummaryButton onClick={() => onSummarize(result)} />
            <FavoriteButton
              active={favoriteAssetKeys.has(result.assetKey)}
              onClick={() => onToggleFavorite(result)}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">{metadataLine(result)}</p>
        <CompactRatingBadges result={result} />
        {tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge className={tag.className} key={`tspdt-${entry.rank}-${tag.key}`} variant={tag.variant}>{tag.tag}</Badge>
            ))}
          </div>
        ) : null}
      </div>
      <VariantButtons
        compact
        creditPolicy={creditPolicy}
        result={result}
        pendingAssetKeys={pendingAssetKeys}
        pendingDownloadAssetKeys={pendingDownloadAssetKeys}
        trackedByAssetKey={trackedByAssetKey}
        onSelect={onSelect}
        onDownload={onDownload}
      />
    </article>
  );
}

function tspdtDisplayTitle(item: TspdtRankItem) {
  const chineseTitle = tspdtChineseTitles[item.entry.rank];
  const resultTitle = item.result?.title;
  if (resultTitle && hasCjkText(resultTitle)) {
    return resultTitle;
  }

  return chineseTitle ?? resultTitle ?? item.entry.title;
}

function hasCjkText(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function RankNumber({ rank }: { rank: number }) {
  return (
    <div className="flex items-center">
      <span className="inline-flex h-10 w-14 items-center justify-center rounded-md border border-amber-300/25 bg-amber-300/10 text-sm font-black tabular-nums text-amber-100">
        #{rank}
      </span>
    </div>
  );
}

function buildTspdtRankItems(results: ResultWithCache[]): TspdtRankItem[] {
  const externalIdMap = new Map<string, ResultWithCache>();
  const titleMap = new Map<string, ResultWithCache>();
  const yearTitleMap = new Map<string, ResultWithCache>();

  for (const result of results) {
    for (const idKey of resultExternalIdKeys(result)) {
      if (!externalIdMap.has(idKey)) {
        externalIdMap.set(idKey, result);
      }
    }

    const years = resultYears(result);
    for (const key of resultTitleKeys(result)) {
      if (!titleMap.has(key)) {
        titleMap.set(key, result);
      }
      for (const year of years) {
        const yearKey = `${key}|${year}`;
        if (!yearTitleMap.has(yearKey)) {
          yearTitleMap.set(yearKey, result);
        }
      }
    }
  }

  return tspdtTop1000.map((entry) => {
    const idMatch = tspdtExternalIdKeys(entry)
      .map((key) => externalIdMap.get(key))
      .find(Boolean);
    const keys = uniqueStrings([
      ...titleKeysFromString(entry.title),
      ...titleKeysFromString(tspdtChineseTitles[entry.rank])
    ]);
    const yearMatch = keys
      .map((key) => yearTitleMap.get(`${key}|${entry.year}`))
      .find(Boolean);
    const titleMatch = keys
      .map((key) => titleMap.get(key))
      .find(Boolean);

    return {
      entry,
      result: idMatch ?? yearMatch ?? titleMatch
    };
  });
}

function tspdtExternalIdKeys(entry: TspdtEntry) {
  return uniqueStrings([
    workIdKey(entry.workId),
    imdbIdKey(entry.imdbId ?? tspdtImdbIds[entry.rank]),
    doubanSubjectIdKey(entry.doubanSubjectId)
  ]);
}

function resultExternalIdKeys(result: SearchResult) {
  const metadata = result.metadata;
  return uniqueStrings([
    workIdKey(metadata?.workId),
    workIdKey(metadata?.work?.workId),
    imdbIdKey(metadata?.imdbId),
    imdbIdKey(metadata?.externalIds?.imdb),
    imdbIdKey(metadata?.work?.externalIds?.imdb),
    imdbIdKey(metadata?.external?.omdb?.imdbId),
    imdbIdKey(extractImdbId(result.sourceUrl)),
    doubanSubjectIdKey(metadata?.externalIds?.douban),
    doubanSubjectIdKey(metadata?.work?.externalIds?.douban),
    doubanSubjectIdKey(extractDoubanSubjectId(result.sourceUrl))
  ]);
}

function workIdKey(value?: string) {
  return value ? `work:${value}` : undefined;
}

function imdbIdKey(value?: string) {
  const id = extractImdbId(value);
  return id ? `imdb:${id.toLowerCase()}` : undefined;
}

function doubanSubjectIdKey(value?: string) {
  const id = extractDoubanSubjectId(value);
  return id ? `douban:${id}` : undefined;
}

function extractImdbId(value?: string) {
  return value?.match(/\btt\d+\b/i)?.[0];
}

function extractDoubanSubjectId(value?: string) {
  return value?.match(/(?:^|\/subject\/)(\d{4,})(?:\/|$|\?)/i)?.[1] ?? (value?.match(/^\d{4,}$/)?.[0]);
}

function resultTitleKeys(result: SearchResult) {
  return uniqueStrings([
    ...titleKeysFromString(result.title),
    ...titleKeysFromString(result.metadata?.display?.title),
    ...titleKeysFromString(result.metadata?.work?.display?.title),
    ...(result.metadata?.titles ?? []).flatMap((title) => titleKeysFromString(title.title)),
    ...(result.metadata?.work?.titles ?? []).flatMap((title) => titleKeysFromString(title.title)),
    ...titleKeysFromString(result.metadata?.external?.omdb?.title),
    ...titleKeysFromString(result.metadata?.external?.omdb?.seriesId)
  ]);
}

function resultYears(result: SearchResult) {
  const releaseYear = result.metadata?.releaseDate?.match(/\b(\d{4})\b/)?.[1];
  const structuredYear = result.metadata?.release?.year?.match(/\b(\d{4})\b/)?.[1];
  const structuredDateYear = result.metadata?.release?.date?.match(/\b(\d{4})\b/)?.[1];
  const workYear = result.metadata?.work?.release?.year?.match(/\b(\d{4})\b/)?.[1];
  const workDateYear = result.metadata?.work?.release?.date?.match(/\b(\d{4})\b/)?.[1];
  const omdbYear = result.metadata?.external?.omdb?.year?.match(/\b(\d{4})\b/)?.[1];
  return uniqueStrings([
    result.metadata?.year?.match(/\b(\d{4})\b/)?.[1],
    structuredYear,
    structuredDateYear,
    workYear,
    workDateYear,
    releaseYear,
    omdbYear
  ]);
}

function titleKeysFromString(value?: string) {
  if (!value) {
    return [];
  }

  const withoutYear = value.replace(/\s*[\[(](?:19|20)\d{2}[\])]\s*$/u, "");
  const deInverted = deInvertTitle(withoutYear);
  const normalized = normalizeTitle(withoutYear);
  const normalizedDeInverted = normalizeTitle(deInverted);
  return uniqueStrings([
    normalized,
    normalizedDeInverted,
    stripLeadingArticle(normalized),
    stripLeadingArticle(normalizedDeInverted)
  ]);
}

function deInvertTitle(value: string) {
  const match = value.match(/^(.+),\s*(the|a|an|l'|la|le|les|el|los|las|il|lo|der|die|das)$/iu);
  if (!match) {
    return value;
  }

  return `${match[2]} ${match[1]}`;
}

function normalizeTitle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/½/g, "1/2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripLeadingArticle(value: string) {
  return value.replace(/^(?:the|a|an|l|la|le|les|el|los|las|il|lo|der|die|das)\s+/u, "");
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function normalizedMetadataText(result: SearchResult) {
  const metadata = result.metadata;
  const work = metadata?.work;
  return [
    result.title,
    result.sourceBreadcrumb?.join(" "),
    metadata?.kind,
    work?.kind,
    metadata?.type,
    metadata?.ratingLevel?.join(" "),
    metadata?.genres?.join(" "),
    work?.genres?.join(" "),
    metadata?.display?.title,
    metadata?.display?.subtitle,
    work?.display?.title,
    work?.display?.subtitle,
    metadata?.titles?.map((title) => title.title).join(" "),
    work?.titles?.map((title) => title.title).join(" "),
    metadata?.info,
    metadata?.description,
    metadata?.external?.omdb?.type,
    metadata?.external?.omdb?.genres?.join(" "),
    metadata?.external?.omdb?.plot
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function explicitBrowseKind(result: SearchResult): "movie" | "tv" | undefined {
  const kind = result.metadata?.work?.kind ?? result.metadata?.kind;
  if (kind === "series" || kind === "season" || kind === "episode") {
    return "tv";
  }
  if (kind === "movie" || kind === "short" || kind === "special") {
    return "movie";
  }

  const type = result.metadata?.type?.trim().toLowerCase();
  if (!type) {
    return undefined;
  }

  if (/\bmovie\b|\bfilm\b|电影/.test(type)) {
    return "movie";
  }

  if (/\btv\b|\bseries\b|\bseason\b|\bshow\b|电视|电视剧|剧集|影集/.test(type)) {
    return "tv";
  }

  return undefined;
}

function resultMatchesBrowseChannel(result: SearchResult, channel: BrowseChannel) {
  if (channel === "recommended") {
    return true;
  }

  const text = normalizedMetadataText(result);
  if (channel === "animation") {
    return /动画|動畫|动漫|動漫|番剧|番劇|anime|animation|animated/.test(text);
  }

  const explicitKind = explicitBrowseKind(result);
  if (explicitKind) {
    return channel === explicitKind;
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

function seededBrowseRank(seed: number, result: SearchResult) {
  const key = `${seed}:${result.assetKey}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sourceRatingSort(source: "douban" | "imdb" | "rotten", seed: number) {
  return (left: SearchResult, right: SearchResult) => {
    const leftRating = sourceRating(left, source);
    const rightRating = sourceRating(right, source);
    const leftHasRating = leftRating > 0 ? 1 : 0;
    const rightHasRating = rightRating > 0 ? 1 : 0;

    return rightHasRating - leftHasRating ||
      rightRating - leftRating ||
      seededBrowseRank(seed, left) - seededBrowseRank(seed, right) ||
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

function luckyRank(key: string) {
  const existingRank = luckyRanks.get(key);
  if (existingRank !== undefined) {
    return existingRank;
  }

  const nextRank = Math.random();
  luckyRanks.set(key, nextRank);
  return nextRank;
}

function rankBrowseResults(
  view: BrowseViewId,
  results: ResultWithCache[],
  stats: Map<string, { count: number; lastPlayedAt: number }>,
  seed: number
) {
  const ranked = [...results];
  const byUpdated = (left: SearchResult, right: SearchResult) => toTime(right.updatedAt) - toTime(left.updatedAt);
  const byRating = (left: SearchResult, right: SearchResult) => numericRating(right) - numericRating(left);
  const byRelease = (left: SearchResult, right: SearchResult) => releaseTime(right) - releaseTime(left);
  const byWatch = (left: SearchResult, right: SearchResult) => resultWatchCount(right, stats) - resultWatchCount(left, stats);
  const byLastPlayed = (left: SearchResult, right: SearchResult) => resultLastPlayedAt(right, stats) - resultLastPlayedAt(left, stats);

  if (view === "lucky") {
    return ranked.sort((left, right) => luckyRank(left.assetKey) - luckyRank(right.assetKey));
  }

  if (view === "doubanRank") {
    return ranked.sort(sourceRatingSort("douban", seed));
  }

  if (view === "imdbRank") {
    return ranked.sort(sourceRatingSort("imdb", seed));
  }

  if (view === "rottenRank") {
    return ranked.sort(sourceRatingSort("rotten", seed));
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
  if (view === "lucky") {
    return ranked.sort((left, right) => luckyRank(left.assetKey) - luckyRank(right.assetKey));
  }

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
    label: copy.library.ratingSources.douban,
    shortLabel: copy.library.ratingSources.douban,
    match: /douban|豆瓣/i,
    className: "border-emerald-300/55 bg-emerald-400/18 text-emerald-50"
  },
  imdb: {
    label: copy.library.ratingSources.imdb,
    shortLabel: copy.library.ratingSources.imdb,
    match: /imdb/i,
    className: "border-amber-300/65 bg-amber-300/22 text-amber-50"
  },
  rotten: {
    label: copy.library.ratingSources.rotten,
    shortLabel: copy.library.ratingSources.rotten,
    match: /^rt$|rotten|tomato|tomatometer|烂番茄|爛番茄/i,
    className: "border-red-300/60 bg-red-400/20 text-red-50"
  },
  metacritic: {
    label: copy.library.ratingSources.metacritic,
    shortLabel: copy.library.ratingSources.metaShort,
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
    ...visibleTags(result.metadata?.genres).map((tag) => ({
      key: `genre-${tag}`,
      tag,
      variant: "secondary" as const,
      className: genreBadgeClass(tag)
    })),
    ...peopleTags(result).map((tag) => ({ key: `people-${tag}`, tag, variant: "muted" as const, className: undefined }))
  ].slice(0, 3);
}

function detailTags(result: SearchResult) {
  return [
    ...visibleTags(result.metadata?.genres).map((tag) => ({
      key: `genre-${tag}`,
      tag,
      variant: "secondary" as const,
      className: genreBadgeClass(tag)
    })),
    ...visibleTags(result.metadata?.people).map((tag) => ({ key: `people-${tag}`, tag, variant: "muted" as const, className: undefined }))
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
  pendingDownloadAssetKeys,
  trackedByAssetKey,
  onSelect,
  onDownload,
  onShowAllVariants,
  compact = false,
  variantLimit
}: {
  creditPolicy: CreditPolicyResponse;
  result: ResultWithCache;
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
  onShowAllVariants?: () => void;
  compact?: boolean;
  variantLimit?: number;
}) {
  const variants = result.variants ?? [];
  const visibleVariants = variantLimit ? variants.slice(0, variantLimit) : variants;
  const hiddenVariantCount = Math.max(0, variants.length - visibleVariants.length);

  if (variants.length === 0) {
    return <Badge variant="danger">{copy.library.noVariants}</Badge>;
  }

  return (
    <div className={compact ? "grid min-w-[220px] gap-2 sm:min-w-[240px]" : "grid gap-2"}>
      {visibleVariants.map((variant) => {
        const variantLabel = displayVariantLabel(result.title, variant.label);
        const pending = pendingAssetKeys.includes(variant.assetKey);
        const tracked = trackedByAssetKey.get(variant.assetKey);
        const displayAsset = tracked?.asset ?? variant.cache;
        const displayStatus = pending
          ? copy.cache.status.queued
          : tracked && tracked.job.status !== "ready"
            ? `${jobStatusLabel(tracked.job.status)} ${tracked.job.progress}%`
            : displayAsset && displayAsset.status !== "ready"
              ? cacheLabel(displayAsset)
              : undefined;
        const downloading = pendingDownloadAssetKeys.includes(variant.assetKey);
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
        const costDisplayLabel = displayAsset?.status === "ready" && !isActiveCacheHit
          ? `▶ ${costLabel}`
          : costLabel;
        const costBadgeClass = displayAsset?.status === "ready" && !isActiveCacheHit
          ? "border-slate-950/25 bg-slate-950/90 px-2.5 text-slate-50 shadow-sm shadow-emerald-950/20"
          : undefined;

        return (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] gap-2" key={variant.assetKey}>
            <Button
              className={`relative h-auto min-w-0 flex-col items-start overflow-hidden px-3 py-2 text-left sm:flex-row sm:items-center sm:justify-between ${compact ? "min-h-10" : ""}`}
              type="button"
              variant={displayAsset?.status === "ready" ? "default" : "secondary"}
              onClick={() => onSelect(result, variant)}
              disabled={isActiveCacheHit}
              title={displayStatus ? `${variantLabel} / ${displayStatus}` : `${variantLabel} / ${costLabel}`}
              aria-label={displayStatus ? `${variantLabel} / ${displayStatus}` : `${variantLabel} / ${costLabel}`}
            >
              {tracked ? (
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 ${progressColor} transition-[width] duration-500`}
                  style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
                />
              ) : null}
              <span className="relative z-10 min-w-0 max-w-full truncate">{variantLabel}</span>
              <span className="relative z-10 flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-start">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {!isActiveCacheHit ? (
                  <Badge className={costBadgeClass} variant="warning">
                    {costDisplayLabel}
                  </Badge>
                ) : null}
                {displayStatus ? <Badge variant={badgeVariant}>{displayStatus}</Badge> : null}
              </span>
            </Button>
            <Button
              className="h-full min-h-10 border-slate-700 bg-slate-900/80 text-slate-100 hover:bg-slate-800"
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onDownload(result, variant)}
              disabled={downloading}
              title={`${variantLabel} / ${copy.library.directDownload}`}
              aria-label={`${variantLabel} / ${copy.library.directDownload}`}
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="sr-only">{copy.library.directDownload}</span>
            </Button>
          </div>
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
            title={copy.library.viewAllVariants}
          >
            {copy.library.moreVariants(hiddenVariantCount)}
          </Button>
        ) : (
          <Badge variant="secondary">{copy.library.moreVariants(hiddenVariantCount)}</Badge>
        )
      ) : null}
    </div>
  );
}

function MovieCard({
  creditPolicy,
  result,
  pendingAssetKeys,
  pendingDownloadAssetKeys,
  favoriteAssetKeys,
  trackedByAssetKey,
  onOpenDetail,
  onSummarize,
  onToggleFavorite,
  onSelect,
  onDownload,
  variantLimit
}: {
  creditPolicy: CreditPolicyResponse;
  result: ResultWithCache;
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  favoriteAssetKeys: Set<string>;
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenDetail: (result: ResultWithCache) => void;
  onSummarize: (result: ResultWithCache) => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
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
        title={copy.library.viewDetails}
      >
        <MoviePoster result={result} />
      </button>
      <div className="grid min-w-0 content-start gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <button
            className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            type="button"
            onClick={() => onOpenDetail(result)}
            title={copy.library.viewDetails}
          >
            <h2 className="line-clamp-3 text-base font-semibold leading-tight text-slate-50 transition-colors hover:text-emerald-100 sm:text-lg">
              {result.title}
            </h2>
          </button>
          <div className="flex items-center gap-1">
            <AiSummaryButton onClick={() => onSummarize(result)} />
            <FavoriteButton
              active={favoriteAssetKeys.has(result.assetKey)}
              onClick={() => onToggleFavorite(result)}
            />
          </div>
        </div>

        <CompactRatingBadges result={result} />

        {tags.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge className={tag.className} key={tag.key} variant={tag.variant}>{tag.tag}</Badge>
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
          pendingDownloadAssetKeys={pendingDownloadAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onSelect={onSelect}
          onDownload={onDownload}
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

function AiSummaryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      className="h-8 w-8 shrink-0 border-slate-700 bg-slate-900/80 text-emerald-100 hover:bg-slate-800"
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      title={copy.library.aiSummary}
      aria-label={copy.library.aiSummary}
    >
      <Sparkles className="h-4 w-4" />
      <span className="sr-only">{copy.library.aiSummary}</span>
    </Button>
  );
}

function FavoriteButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const label = active ? copy.favorites.unfavorite : copy.favorites.favorite;

  return (
    <Button
      className={active ? "border-amber-300/40 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20" : ""}
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Star className={`h-4 w-4 ${active ? "fill-amber-300 text-amber-300" : ""}`} />
    </Button>
  );
}

function MovieSummaryDialog({
  state,
  onOpenChange,
  onModeChange
}: {
  state: {
    open: boolean;
    result?: ResultWithCache;
    mode: MovieSummaryMode;
    loading: boolean;
    error: string;
    response?: MovieSummaryResponse;
  };
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: MovieSummaryMode) => void;
}) {
  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,720px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-300" />
            {copy.library.aiSummaryTitle}
          </DialogTitle>
          <DialogDescription>
            {state.result?.title ?? copy.library.aiSummaryDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex w-full rounded-md border border-slate-800 bg-slate-950 p-1 sm:w-fit">
          <Button
            className="flex-1 sm:flex-none"
            type="button"
            size="sm"
            variant={state.mode === "spoiler_free" ? "secondary" : "ghost"}
            onClick={() => onModeChange("spoiler_free")}
            disabled={state.loading}
          >
            {copy.library.spoilerFree}
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            type="button"
            size="sm"
            variant={state.mode === "spoiler" ? "secondary" : "ghost"}
            onClick={() => onModeChange("spoiler")}
            disabled={state.loading}
          >
            {copy.library.spoiler}
          </Button>
        </div>

        <div className="min-h-[180px] rounded-md border border-slate-800 bg-slate-950/80 p-4">
          {state.loading ? (
            <div className="flex min-h-[148px] items-center justify-center gap-2 text-sm font-semibold text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.library.aiSummaryLoading}
            </div>
          ) : state.error ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">
              {state.error}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
              {state.response?.summary ?? copy.library.aiSummaryEmpty}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MovieListView({
  creditPolicy,
  results,
  pendingAssetKeys,
  pendingDownloadAssetKeys,
  favoriteAssetKeys,
  trackedByAssetKey,
  onOpenDetail,
  onSummarize,
  onToggleFavorite,
  onSelect,
  onDownload
}: {
  creditPolicy: CreditPolicyResponse;
  results: ResultWithCache[];
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  favoriteAssetKeys: Set<string>;
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onOpenDetail: (result: ResultWithCache) => void;
  onSummarize: (result: ResultWithCache) => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  if (results.length === 0) {
    return <EmptyState icon={<Film className="h-5 w-5" />} title={copy.library.noTitlesLoaded} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70">
      <table className="w-full min-w-[1020px] border-collapse text-left">
        <thead className="border-b border-slate-800 bg-slate-950 text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="w-[31%] px-4 py-3">{copy.library.table.title}</th>
            <th className="w-[17%] px-4 py-3">{copy.library.table.metadata}</th>
            <th className="w-[17%] px-4 py-3">{copy.library.table.people}</th>
            <th className="w-[29%] px-4 py-3">{copy.library.table.specs}</th>
            <th className="w-[6%] px-4 py-3">{copy.favorites.favorite}</th>
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
                      title={copy.library.viewDetails}
                    >
                      <MoviePoster result={result} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <button
                          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                          type="button"
                          onClick={() => onOpenDetail(result)}
                          title={copy.library.viewDetails}
                        >
                          <p className="line-clamp-2 font-semibold leading-5 text-slate-50 hover:text-emerald-100">{result.title}</p>
                        </button>
                        <AiSummaryButton onClick={() => onSummarize(result)} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{bestSummary(result)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 text-sm">
                  <p className="text-slate-300">{metadataLine(result)}</p>
                  {directorLine(result) ? (
                    <p className="mt-2 text-xs font-semibold text-slate-400">{copy.library.director(directorLine(result))}</p>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    {genres.map((tag) => (
                      <Badge className={genreBadgeClass(tag)} key={`list-genre-${result.assetKey}-${tag}`} variant="secondary">{tag}</Badge>
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
                    pendingDownloadAssetKeys={pendingDownloadAssetKeys}
                    trackedByAssetKey={trackedByAssetKey}
                    onSelect={onSelect}
                    onDownload={onDownload}
                    compact
                  />
                </td>
                <td className="px-4 py-4">
                  <FavoriteButton
                    active={favoriteAssetKeys.has(result.assetKey)}
                    onClick={() => onToggleFavorite(result)}
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
  pendingDownloadAssetKeys,
  favoriteAssetKeys,
  trackedByAssetKey,
  onBack,
  onSummarize,
  onToggleFavorite,
  onSelect,
  onDownload
}: {
  creditPolicy: CreditPolicyResponse;
  result: ResultWithCache;
  pendingAssetKeys: string[];
  pendingDownloadAssetKeys: string[];
  favoriteAssetKeys: Set<string>;
  trackedByAssetKey: Map<string, TrackedCacheItem>;
  onBack: () => void;
  onSummarize: (result: ResultWithCache) => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
  onDownload: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const tags = detailTags(result);
  const ratings = displayRatings(result);
  const directors = directorLine(result);
  const summary = bestDetailSummary(result);
  const variantCount = result.variants?.length ?? 0;

  return (
    <section className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          {copy.library.backToList}
        </Button>
        <div className="flex items-center gap-2">
          <FavoriteButton
            active={favoriteAssetKeys.has(result.assetKey)}
            onClick={() => onToggleFavorite(result)}
          />
          <Badge variant="secondary">{copy.library.variantCount(variantCount)}</Badge>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="max-w-[220px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
          <MoviePoster result={result} />
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <h2 className="min-w-0 flex-1 text-2xl font-semibold leading-tight text-slate-50">{result.title}</h2>
              <AiSummaryButton onClick={() => onSummarize(result)} />
            </div>
            <p className="mt-2 text-sm text-slate-400">{metadataLine(result)}</p>
            {directors ? (
              <p className="mt-2 text-sm font-semibold text-slate-300">{copy.library.director(directors)}</p>
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
                <Badge className={tag.className} key={`detail-${tag.key}`} variant={tag.variant}>{tag.tag}</Badge>
              ))}
            </div>
          ) : null}

          <div className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/80 p-4">
            <h3 className="text-sm font-semibold text-slate-200">{copy.library.intro}</h3>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{summary}</p>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-200">{copy.library.allVariants}</h3>
              <Badge variant="muted">{variantCount}</Badge>
            </div>
            <VariantButtons
              creditPolicy={creditPolicy}
              result={result}
              pendingAssetKeys={pendingAssetKeys}
              pendingDownloadAssetKeys={pendingDownloadAssetKeys}
              trackedByAssetKey={trackedByAssetKey}
              onSelect={onSelect}
              onDownload={onDownload}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
