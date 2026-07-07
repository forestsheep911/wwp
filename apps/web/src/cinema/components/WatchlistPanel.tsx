import { useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Database, Film, Loader2, Play, RefreshCw, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import type { CacheAsset, CreditPolicyResponse, MediaVariant, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  bestSummary,
  directorLine,
  formatBytes,
  formatDateTime,
  metadataLine,
  variantHasSizeMetadata,
  variantSpecText,
  visibleTags
} from "../format";
import { genreBadgeClass } from "../genre-style";
import { copy } from "../i18n";
import type { PlaybackHistoryEntry, ResultWithCache } from "../types";
import { formatCreditAmount, playbackCreditCost } from "../types";
import { EmptyState } from "./EmptyState";

type WatchCategory = "all" | "movie" | "tv";
type WatchCost = "all" | "ready" | "freeReplay";
type WatchSort = "latest" | "rating" | "cached";
type WatchType = "all" | "action" | "comedy" | "romance" | "scifi" | "crime" | "adventure" | "horror" | "animation" | "war" | "mystery" | "disaster" | "documentary";
type WatchRegion = "all" | "mainland" | "hongkong" | "taiwan" | "usa" | "japan" | "korea" | "uk" | "france" | "germany" | "italy" | "india" | "other";
type WatchYear = "all" | "2020s" | "2010s" | "2000s" | "90s" | "80s" | "earlier";

interface WatchCandidate {
  result: ResultWithCache;
  readyVariant?: MediaVariant;
  firstVariant?: MediaVariant;
  cachedAt?: string;
  replayFree: boolean;
}

const sortOptions: Array<{ id: WatchSort; label: string }> = [
  { id: "latest", label: copy.watchlist.sort.latest },
  { id: "rating", label: copy.watchlist.sort.rating },
  { id: "cached", label: copy.watchlist.sort.cached }
];

const categoryOptions: Array<{ id: WatchCategory; label: string }> = [
  { id: "all", label: copy.watchlist.categories.all },
  { id: "movie", label: copy.watchlist.categories.movie },
  { id: "tv", label: copy.watchlist.categories.tv }
];

const costOptions: Array<{ id: WatchCost; label: string }> = [
  { id: "all", label: copy.watchlist.costs.all },
  { id: "ready", label: copy.watchlist.costs.ready },
  { id: "freeReplay", label: copy.watchlist.costs.freeReplay }
];

const typeOptions: Array<{ id: WatchType; label: string; aliases?: string[] }> = [
  { id: "all", label: copy.watchlist.all },
  { id: "action", label: "动作", aliases: ["动作", "action"] },
  { id: "comedy", label: "喜剧", aliases: ["喜剧", "comedy"] },
  { id: "romance", label: "爱情", aliases: ["爱情", "romance"] },
  { id: "scifi", label: "科幻", aliases: ["科幻", "sci-fi", "science fiction"] },
  { id: "crime", label: "犯罪", aliases: ["犯罪", "crime"] },
  { id: "adventure", label: "冒险", aliases: ["冒险", "adventure"] },
  { id: "horror", label: "恐怖", aliases: ["恐怖", "horror"] },
  { id: "animation", label: "动画", aliases: ["动画", "動畫", "animation", "anime"] },
  { id: "war", label: "战争", aliases: ["战争", "war"] },
  { id: "mystery", label: "悬疑", aliases: ["悬疑", "mystery", "suspense"] },
  { id: "disaster", label: "灾难", aliases: ["灾难", "disaster"] },
  { id: "documentary", label: "纪录片", aliases: ["纪录", "纪录片", "documentary"] }
];

const regionOptions: Array<{ id: WatchRegion; label: string; aliases?: string[] }> = [
  { id: "all", label: copy.watchlist.all },
  { id: "mainland", label: "中国大陆", aliases: ["中国大陆", "大陆", "china", "prc"] },
  { id: "hongkong", label: "中国香港", aliases: ["中国香港", "香港", "hong kong"] },
  { id: "taiwan", label: "中国台湾", aliases: ["中国台湾", "台湾", "taiwan"] },
  { id: "usa", label: "美国", aliases: ["美国", "usa", "united states"] },
  { id: "japan", label: "日本", aliases: ["日本", "japan"] },
  { id: "korea", label: "韩国", aliases: ["韩国", "south korea", "korea"] },
  { id: "uk", label: "英国", aliases: ["英国", "uk", "united kingdom"] },
  { id: "france", label: "法国", aliases: ["法国", "france"] },
  { id: "germany", label: "德国", aliases: ["德国", "germany"] },
  { id: "italy", label: "意大利", aliases: ["意大利", "italy"] },
  { id: "india", label: "印度", aliases: ["印度", "india"] },
  { id: "other", label: "其他" }
];

const yearOptions: Array<{ id: WatchYear; label: string }> = [
  { id: "all", label: copy.watchlist.all },
  { id: "2020s", label: "2020s" },
  { id: "2010s", label: "2010s" },
  { id: "2000s", label: "2000s" },
  { id: "90s", label: "90年代" },
  { id: "80s", label: "80年代" },
  { id: "earlier", label: "更早" }
];

export function WatchlistPanel({
  browseHasMore,
  browseLoading,
  browseLoadingMore,
  browseResults,
  cachedAssets,
  creditPolicy,
  favoriteAssetKeys,
  historyItems,
  onLoadMore,
  onRefresh,
  onToggleFavorite,
  onSelect
}: {
  browseHasMore: boolean;
  browseLoading: boolean;
  browseLoadingMore: boolean;
  browseResults: ResultWithCache[];
  cachedAssets: CacheAsset[];
  creditPolicy: CreditPolicyResponse;
  favoriteAssetKeys: Set<string>;
  historyItems: PlaybackHistoryEntry[];
  onLoadMore: () => void;
  onRefresh: () => void;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<WatchCategory>("all");
  const [activeCost, setActiveCost] = useState<WatchCost>("ready");
  const [activeSort, setActiveSort] = useState<WatchSort>("latest");
  const [activeType, setActiveType] = useState<WatchType>("all");
  const [activeRegion, setActiveRegion] = useState<WatchRegion>("all");
  const [activeYear, setActiveYear] = useState<WatchYear>("all");
  const cachedByAssetKey = useMemo(() => new Map(cachedAssets.map((asset) => [asset.assetKey, asset])), [cachedAssets]);
  const replayFreeAssetKeys = useMemo(
    () => replayFreeKeys(historyItems, creditPolicy.playbackReplayFreeHours),
    [creditPolicy.playbackReplayFreeHours, historyItems]
  );
  const candidates = useMemo(
    () => buildCandidates(browseResults, cachedByAssetKey, replayFreeAssetKeys),
    [browseResults, cachedByAssetKey, replayFreeAssetKeys]
  );
  const filteredCandidates = useMemo(
    () => sortCandidates(candidates.filter((candidate) => (
      matchesCategory(candidate.result, activeCategory) &&
      matchesCost(candidate, activeCost) &&
      matchesType(candidate.result, activeType) &&
      matchesRegion(candidate.result, activeRegion) &&
      matchesYear(candidate.result, activeYear)
    )), activeSort),
    [activeCategory, activeCost, activeRegion, activeSort, activeType, activeYear, candidates]
  );
  const readyCount = candidates.filter((candidate) => candidate.readyVariant).length;
  const replayFreeCount = candidates.filter((candidate) => candidate.replayFree).length;
  const initialLoading = browseLoading && browseResults.length === 0;

  if (initialLoading) {
    return <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title={copy.watchlist.loadingCatalog} />;
  }

  if (browseResults.length === 0) {
    return (
      <div className="grid gap-3">
        <div className="grid gap-2 sm:flex sm:justify-end">
          <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={browseLoading}>
            <RefreshCw className={`h-4 w-4 ${browseLoading ? "animate-spin" : ""}`} />
            {copy.watchlist.refresh}
          </Button>
        </div>
        <EmptyState icon={<Database className="h-5 w-5" />} title={copy.watchlist.empty} />
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-black/20 sm:rounded-lg lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">
              <Sparkles className="h-3.5 w-3.5" />
              {copy.watchlist.available(candidates.length)}
            </Badge>
            <Badge variant="secondary">{copy.watchlist.matched(filteredCandidates.length)}</Badge>
            <Badge variant="muted">{copy.watchlist.cachedReady(readyCount)}</Badge>
            {replayFreeCount > 0 ? <Badge variant="warning">{copy.watchlist.costs.freeReplay} {replayFreeCount}</Badge> : null}
          </div>
          <h2 className="mt-3 text-2xl font-semibold leading-tight text-slate-50">{copy.watchlist.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{copy.watchlist.description}</p>
        </div>
        <Button className="w-full lg:w-auto" type="button" variant="outline" onClick={onRefresh} disabled={browseLoading || browseLoadingMore}>
          <RefreshCw className={`h-4 w-4 ${browseLoading || browseLoadingMore ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 sm:rounded-md">
        <FilterRow label={copy.watchlist.rows.sort}>
          {sortOptions.map((option) => (
            <FilterButton key={option.id} active={activeSort === option.id} onClick={() => setActiveSort(option.id)}>
              {option.label}
            </FilterButton>
          ))}
        </FilterRow>
        <FilterRow label={copy.watchlist.rows.category}>
          {categoryOptions.map((option) => (
            <FilterButton key={option.id} active={activeCategory === option.id} onClick={() => setActiveCategory(option.id)}>
              {option.label}
            </FilterButton>
          ))}
        </FilterRow>
        <FilterRow label={copy.watchlist.rows.cost}>
          {costOptions.map((option) => (
            <FilterButton key={option.id} active={activeCost === option.id} onClick={() => setActiveCost(option.id)}>
              {option.label}
            </FilterButton>
          ))}
        </FilterRow>
        <FilterRow label={copy.watchlist.rows.type}>
          {typeOptions.map((option) => (
            <FilterButton key={option.id} active={activeType === option.id} onClick={() => setActiveType(option.id)}>
              {option.label}
            </FilterButton>
          ))}
        </FilterRow>
        <FilterRow label={copy.watchlist.rows.region}>
          {regionOptions.map((option) => (
            <FilterButton key={option.id} active={activeRegion === option.id} onClick={() => setActiveRegion(option.id)}>
              {option.label}
            </FilterButton>
          ))}
        </FilterRow>
        <FilterRow label={copy.watchlist.rows.year}>
          {yearOptions.map((option) => (
            <FilterButton key={option.id} active={activeYear === option.id} onClick={() => setActiveYear(option.id)}>
              {option.label}
            </FilterButton>
          ))}
        </FilterRow>
      </div>

      {activeCost !== "all" ? (
        <p className="text-xs font-semibold text-slate-500">{copy.watchlist.viewReadyOnlyHint}</p>
      ) : null}

      {filteredCandidates.length === 0 ? (
        <EmptyState icon={<Film className="h-5 w-5" />} title={copy.watchlist.emptyFilter} />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filteredCandidates.map((candidate) => (
            <WatchCandidateCard
              candidate={candidate}
              creditPolicy={creditPolicy}
              favorite={favoriteAssetKeys.has(candidate.result.assetKey)}
              key={candidate.result.assetKey}
              onToggleFavorite={onToggleFavorite}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      {browseHasMore ? (
        <div className="grid gap-2 pt-1 sm:flex sm:justify-center">
          <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={onLoadMore} disabled={browseLoadingMore}>
            {browseLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            {copy.watchlist.loadMore}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function FilterRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid min-w-0 gap-2 md:grid-cols-[4rem_minmax(0,1fr)] md:items-start">
      <div className="flex items-center gap-1.5 pt-1 text-sm font-bold text-emerald-300">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="scrollbar-none flex max-w-[calc(100vw-3rem)] gap-2 overflow-x-auto md:max-w-none md:flex-wrap">{children}</div>
    </div>
  );
}

function FilterButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <Button className="min-h-11 flex-none rounded-lg sm:min-h-8 sm:rounded-md" type="button" size="sm" variant={active ? "secondary" : "ghost"} onClick={onClick}>
      {children}
    </Button>
  );
}

function buildCandidates(
  results: ResultWithCache[],
  cachedByAssetKey: Map<string, CacheAsset>,
  replayFreeAssetKeys: Set<string>
): WatchCandidate[] {
  return results
    .map((result) => {
      const variants = result.variants ?? [];
      const hydratedVariants = variants.map((variant) => ({
        ...variant,
        cache: variant.cache ?? cachedByAssetKey.get(variant.assetKey)
      }));
      const readyVariant = hydratedVariants.find((variant) => variant.cache?.status === "ready");
      const firstVariant = readyVariant ?? hydratedVariants[0];
      const cachedAt = readyVariant?.cache?.cachedAt ?? result.cache?.cachedAt;
      const replayFree = hydratedVariants.some((variant) => replayFreeAssetKeys.has(variant.assetKey)) || replayFreeAssetKeys.has(result.assetKey);
      return {
        result: {
          ...result,
          cache: result.cache ?? cachedByAssetKey.get(result.assetKey),
          variants: hydratedVariants
        },
        readyVariant,
        firstVariant,
        cachedAt,
        replayFree
      };
    })
    .filter((candidate) => candidate.firstVariant);
}

function sortCandidates(candidates: WatchCandidate[], sort: WatchSort) {
  const sorted = [...candidates];
  sorted.sort((left, right) => {
    if (sort === "rating") {
      return numericRating(right.result) - numericRating(left.result) || resultTime(right.result) - resultTime(left.result);
    }

    if (sort === "cached") {
      return timestamp(right.cachedAt ?? right.result.cache?.cachedAt) - timestamp(left.cachedAt ?? left.result.cache?.cachedAt) || resultTime(right.result) - resultTime(left.result);
    }

    return resultTime(right.result) - resultTime(left.result);
  });
  return sorted;
}

function replayFreeKeys(historyItems: PlaybackHistoryEntry[], replayHours: number) {
  const cutoff = Date.now() - replayHours * 60 * 60 * 1000;
  const keys = new Set<string>();
  for (const item of historyItems) {
    if (timestamp(item.playedAt) >= cutoff) {
      keys.add(item.assetKey);
    }
  }
  return keys;
}

function matchesCost(candidate: WatchCandidate, cost: WatchCost) {
  if (cost === "ready") {
    return Boolean(candidate.readyVariant);
  }
  if (cost === "freeReplay") {
    return candidate.replayFree;
  }
  return true;
}

function matchesCategory(result: SearchResult, category: WatchCategory) {
  if (category === "all") {
    return true;
  }

  return resultCategory(result) === category;
}

function matchesType(result: SearchResult, type: WatchType) {
  if (type === "all") {
    return true;
  }

  const option = typeOptions.find((item) => item.id === type);
  return option?.aliases?.some((alias) => genreText(result).includes(alias.toLowerCase())) ?? false;
}

function resultCategory(result: SearchResult): Exclude<WatchCategory, "all"> {
  const kind = result.metadata?.work?.kind ?? result.metadata?.kind;
  if (kind === "series" || kind === "season" || kind === "episode") {
    return "tv";
  }
  if (kind === "movie" || kind === "short" || kind === "special") {
    return "movie";
  }

  const type = [
    result.metadata?.type,
    result.metadata?.external?.omdb?.type,
    result.metadata?.display?.subtitle,
    result.metadata?.work?.display?.subtitle,
    result.title
  ].filter(Boolean).join(" ").toLowerCase();
  if (/series|season|episode|tv|mini[-\s]?series|剧集|电视剧|迷你剧|番剧/.test(type)) {
    return "tv";
  }
  return "movie";
}

function matchesRegion(result: SearchResult, region: WatchRegion) {
  if (region === "all") {
    return true;
  }

  const text = countryText(result);
  if (region === "other") {
    return !regionOptions.some((option) => option.id !== "all" && option.id !== "other" && option.aliases?.some((alias) => text.includes(alias.toLowerCase())));
  }

  const option = regionOptions.find((item) => item.id === region);
  return option?.aliases?.some((alias) => text.includes(alias.toLowerCase())) ?? false;
}

function matchesYear(result: SearchResult, yearFilter: WatchYear) {
  if (yearFilter === "all") {
    return true;
  }

  const year = releaseYear(result);
  if (!year) {
    return false;
  }

  if (yearFilter === "2020s") {
    return year >= 2020;
  }
  if (yearFilter === "2010s") {
    return year >= 2010 && year <= 2019;
  }
  if (yearFilter === "2000s") {
    return year >= 2000 && year <= 2009;
  }
  if (yearFilter === "90s") {
    return year >= 1990 && year <= 1999;
  }
  if (yearFilter === "80s") {
    return year >= 1980 && year <= 1989;
  }
  return year < 1980;
}

function genreText(result: SearchResult) {
  return [
    result.metadata?.genres?.join(" "),
    result.metadata?.work?.genres?.join(" "),
    result.metadata?.external?.omdb?.genres?.join(" "),
    result.metadata?.type,
    result.metadata?.kind,
    result.metadata?.work?.kind
  ].filter(Boolean).join(" ").toLowerCase();
}

function countryText(result: SearchResult) {
  return [
    result.metadata?.work?.release?.countries?.join(" "),
    result.metadata?.work?.countries?.join(" "),
    result.metadata?.release?.countries?.join(" "),
    result.metadata?.external?.omdb?.countries?.join(" ")
  ].filter(Boolean).join(" ").toLowerCase();
}

function releaseYear(result: SearchResult) {
  const value = [
    result.metadata?.year,
    result.metadata?.release?.year,
    result.metadata?.work?.release?.year,
    result.metadata?.external?.omdb?.year,
    result.metadata?.releaseDate
  ].find(Boolean);
  const year = value?.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ? Number.parseInt(year, 10) : undefined;
}

function resultTime(result: SearchResult) {
  const year = releaseYear(result);
  return Math.max(timestamp(result.updatedAt), year ? timestamp(`${year}-01-01`) : 0);
}

function numericRating(result: SearchResult) {
  const ratings = [
    ...(result.metadata?.ratings ?? []),
    ...(result.metadata?.external?.omdb?.ratings ?? [])
  ];
  if (result.metadata?.external?.omdb?.imdbRating && result.metadata.external.omdb.imdbRating !== "N/A") {
    ratings.push({ label: "IMDb", value: result.metadata.external.omdb.imdbRating });
  }

  return Math.max(0, ...ratings.map((rating) => Number.parseFloat(rating.value.replace(/[^\d.]/g, "")) || 0));
}

function timestamp(value?: string) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function WatchCandidateCard({
  candidate,
  creditPolicy,
  favorite,
  onToggleFavorite,
  onSelect
}: {
  candidate: WatchCandidate;
  creditPolicy: CreditPolicyResponse;
  favorite: boolean;
  onToggleFavorite: (result: ResultWithCache) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const result = candidate.result;
  const variant = candidate.readyVariant ?? candidate.firstVariant;
  const ready = variant?.cache?.status === "ready";
  const tags = [
    ...visibleTags(result.metadata?.genres),
    ...visibleTags(result.metadata?.work?.genres)
  ].filter((tag, index, tags) => tags.indexOf(tag) === index).slice(0, 4);
  const year = releaseYear(result);

  return (
    <Card className="rounded-xl sm:rounded-lg">
      <CardContent className="grid gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <h3 className="line-clamp-2 font-semibold leading-6 text-slate-50">{result.title}</h3>
            <p className="mt-1 text-sm text-slate-400">{metadataLine(result)}</p>
            {directorLine(result) ? (
              <p className="mt-1 text-xs font-semibold text-slate-500">{copy.library.director(directorLine(result))}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              className={favorite ? "border-amber-300/40 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20" : ""}
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onToggleFavorite(result)}
              title={favorite ? copy.favorites.unfavorite : copy.favorites.favorite}
              aria-label={favorite ? copy.favorites.unfavorite : copy.favorites.favorite}
            >
              <Star className={`h-4 w-4 ${favorite ? "fill-amber-300 text-amber-300" : ""}`} />
            </Button>
            {ready ? <Badge variant="default">{copy.cache.status.ready}</Badge> : <Badge variant="muted">{copy.cache.notCached}</Badge>}
            {candidate.replayFree ? <Badge variant="warning">{copy.watchlist.replayFree}</Badge> : null}
            {year ? (
              <Badge variant="secondary">
                <CalendarDays className="h-3.5 w-3.5" />
                {year}
              </Badge>
            ) : null}
          </div>
        </div>

        {tags.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge className={genreBadgeClass(tag)} key={`${result.assetKey}-${tag}`} variant="secondary">{tag}</Badge>
            ))}
          </div>
        ) : null}

        <p className="line-clamp-3 text-sm leading-6 text-slate-400 sm:line-clamp-2">{bestSummary(result)}</p>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <p className="min-w-0 text-xs font-semibold leading-5 text-slate-500 sm:truncate sm:leading-normal">
            {variant ? variantSpecText(result.title, variant, { compact: true }) : copy.watchlist.noPlayableVariant}
            {ready && variant?.cache?.media?.contentLength && !variantHasSizeMetadata(variant) ? ` / ${formatBytes(variant.cache.media.contentLength)}` : ""}
            {candidate.cachedAt ? ` / ${copy.watchlist.cachedAt(formatDateTime(candidate.cachedAt))}` : ` / ${copy.watchlist.updatedAt(formatDateTime(result.updatedAt))}`}
          </p>
          {variant ? (
            <Button className="w-full sm:w-auto" type="button" size="sm" variant={ready ? "default" : "secondary"} onClick={() => onSelect(result, variant)}>
              <Play className="h-4 w-4" />
              {ready
                ? formatCreditAmount(playbackCreditCost(variant.cache?.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)
                : `${copy.watchlist.prepare} ${formatCreditAmount(creditPolicy.cacheCredits, creditPolicy.unitSymbol)}`}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
