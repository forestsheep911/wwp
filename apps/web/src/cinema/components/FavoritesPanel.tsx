import { readSession, writeSession } from "../session-state";
import { historyEntryKey } from "../navigation";
import { useState } from "react";
import { CalendarDays, CheckCircle2, Eye, Film, Play, Star } from "lucide-react";
import type { CacheAsset, CreditPolicyResponse, MediaVariant } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  bestSummary,
  directorLine,
  formatBytes,
  formatDateTime,
  metadataLine,
  titleInitial,
  variantHasSizeMetadata,
  variantSpecText,
  visibleTags
} from "../format";
import { genreBadgeClass } from "../genre-style";
import { copy } from "../i18n";
import type { CollectionMark, FavoriteEntry, ResultWithCache } from "../types";
import { EmptyState } from "./EmptyState";
import { PosterImage } from "./PosterImage";
import { shouldOpenDetailInCurrentTab } from "../detail-link";

interface FavoriteCandidate {
  entry: FavoriteEntry;
  result: ResultWithCache;
  variant?: MediaVariant;
  ready: boolean;
}

const favoriteSections: Array<{
  mark: CollectionMark;
  icon: typeof Star;
  className: string;
}> = [
  { mark: "wantToWatch", icon: Eye, className: "text-sky-200" },
  { mark: "watching", icon: Play, className: "text-sky-200" },
  { mark: "watched", icon: CheckCircle2, className: "text-emerald-200" }
];

export function FavoritesPanel({
  cachedAssets,
  creditPolicy,
  favorites,
  getDetailHref,
  onOpenDetail,
  onRemove,
  onSelect
}: {
  cachedAssets: CacheAsset[];
  creditPolicy: CreditPolicyResponse;
  favorites: FavoriteEntry[];
  getDetailHref: (result: ResultWithCache) => string;
  onOpenDetail: (result: ResultWithCache) => void;
  onRemove: (assetKey: string, mark: CollectionMark) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const cachedByAssetKey = new Map(cachedAssets.map((asset) => [asset.assetKey, asset]));
  const sections = favoriteSections.map((section) => ({
    ...section,
    candidates: favorites
      .filter((entry) => markTimestamp(entry, section.mark))
      .map((entry) => hydrateFavorite(entry, cachedByAssetKey))
  }));
  const defaultSection = sections.find((section) => section.candidates.length > 0)?.mark ?? "wantToWatch";

  if (favorites.length === 0) {
    return (
      <div className="grid gap-3">
        <EmptyState
          icon={<Star className="h-5 w-5" />}
          title={copy.favorites.empty}
          description={copy.favorites.emptyHint}
        />
      </div>
    );
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-2xl shadow-black/20 sm:rounded-lg sm:p-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold leading-tight text-slate-50">{copy.favorites.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{copy.favorites.description}</p>
        </div>

        <Tabs className="min-w-0" defaultValue={defaultSection}>
          <TabsList className="grid w-full min-w-0 grid-cols-3 rounded-xl bg-slate-950/72 sm:flex sm:w-fit sm:rounded-md">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <TabsTrigger
                  className="min-h-11 min-w-0 flex-wrap gap-1 rounded-lg px-1 text-xs data-[state=active]:bg-emerald-400 data-[state=active]:text-slate-950 sm:px-3 sm:text-sm sm:rounded-md"
                  key={section.mark}
                  value={section.mark}
                >
                  <Icon className={`hidden h-4 w-4 sm:block ${section.className}`} />
                  {copy.favorites.sections[section.mark]}
                  <Badge variant="secondary">{section.candidates.length}</Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {sections.map((section) => (
            <TabsContent className="mt-4 min-w-0" key={section.mark} value={section.mark}>
              <FavoriteSection
                creditPolicy={creditPolicy}
                section={section}
                getDetailHref={getDetailHref}
                onOpenDetail={onOpenDetail}
                onRemove={onRemove}
                onSelect={onSelect}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

function markTimestamp(entry: FavoriteEntry, mark: CollectionMark) {
  if (mark === "favorite") {
    return entry.favoriteAt;
  }
  if (mark === "wantToWatch") {
    return entry.wantToWatchAt;
  }
  if (mark === "watching") return entry.watchingAt;
  return entry.watchedAt;
}

function FavoriteSection({
  creditPolicy,
  section,
  getDetailHref,
  onOpenDetail,
  onRemove,
  onSelect
}: {
  creditPolicy: CreditPolicyResponse;
  section: (typeof favoriteSections)[number] & { candidates: FavoriteCandidate[] };
  getDetailHref: (result: ResultWithCache) => string;
  onOpenDetail: (result: ResultWithCache) => void;
  onRemove: (assetKey: string, mark: CollectionMark) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const [limit, updateLimit] = useState(() => readSession(`favorites-count:${historyEntryKey()}`, 50));
  const setLimit = (update: (value: number) => number) => updateLimit(value => { const next = update(value); writeSession(`favorites-count:${historyEntryKey()}`, next); return next; });
  return (
    <div className="min-w-0">
      {section.candidates.length ? (
        <div className="grid min-w-0 gap-3">
          {section.candidates.slice(0, limit).map((candidate) => (
            <FavoriteCard
              candidate={candidate}
              creditPolicy={creditPolicy}
              key={`${section.mark}-${candidate.entry.assetKey}`}
              mark={section.mark}
              getDetailHref={getDetailHref}
              onOpenDetail={onOpenDetail}
              onRemove={onRemove}
              onSelect={onSelect}
            />
          ))}
          {section.candidates.length > limit && <Button variant="outline" onClick={()=>setLimit(count=>count+50)}>加载更多（还有 {section.candidates.length-limit} 部）</Button>}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/45 px-4 py-5 text-sm font-semibold text-slate-500 sm:rounded-md">
          {copy.favorites.sectionEmpty[section.mark]}
        </div>
      )}
    </div>
  );
}

function hydrateFavorite(entry: FavoriteEntry, cachedByAssetKey: Map<string, CacheAsset>): FavoriteCandidate {
  const result = entry.result;
  const variants = result.variants ?? [];
  const hydratedVariants = variants.map((variant) => ({
    ...variant,
    cache: cachedByAssetKey.get(variant.assetKey) ?? variant.cache
  }));
  const readyVariant = hydratedVariants.find((variant) => variant.cache?.status === "ready");
  const variant = readyVariant ?? hydratedVariants[0];

  return {
    entry,
    result: {
      ...result,
      cache: result.cache ?? cachedByAssetKey.get(result.assetKey),
      variants: hydratedVariants
    },
    variant,
    ready: variant?.cache?.status === "ready"
  };
}

function FavoriteCard({
  candidate,
  creditPolicy,
  mark,
  getDetailHref,
  onOpenDetail,
  onRemove,
  onSelect
}: {
  candidate: FavoriteCandidate;
  creditPolicy: CreditPolicyResponse;
  mark: CollectionMark;
  getDetailHref: (result: ResultWithCache) => string;
  onOpenDetail: (result: ResultWithCache) => void;
  onRemove: (assetKey: string, mark: CollectionMark) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const { entry, result, variant, ready } = candidate;
  const unavailableLabel = result.source === "douban" ? "尚未匹配本站影片" : copy.favorites.noPlayableVariant;
  const detailLink = variant ? {
    href: getDetailHref(result),
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (shouldOpenDetailInCurrentTab(event)) { event.preventDefault(); onOpenDetail(result); }
    }
  } : undefined;
  const tags = visibleTags(result.metadata?.genres).slice(0, 4);
  const timestamp = markTimestamp(entry, mark) ?? entry.addedAt;
  const removeLabel = mark === "favorite"
    ? copy.favorites.remove
    : mark === "wantToWatch"
      ? copy.favorites.removeWantToWatch
      : mark === "watching" ? copy.favorites.removeWatching : copy.favorites.removeWatched;
  const stampedLabel = entry.doubanImport && !entry.doubanImport.markedAt ? "豆瓣未提供标记日期" : mark === "favorite"
    ? copy.favorites.addedAt(formatDateTime(timestamp))
    : mark === "wantToWatch"
      ? copy.favorites.wantToWatchAt(formatDateTime(timestamp))
      : mark === "watching" ? copy.favorites.watchingAt(formatDateTime(timestamp)) : copy.favorites.watchedAt(formatDateTime(timestamp));

  return (
    <article className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3 shadow-xl shadow-black/10 sm:grid-cols-[76px_minmax(0,1fr)] sm:rounded-md lg:grid-cols-[84px_minmax(0,1fr)_minmax(280px,0.42fr)]">
      <a {...detailLink} aria-label={variant ? `查看${result.title}详情` : undefined} className="self-start overflow-hidden rounded-lg border border-slate-800 bg-slate-950 sm:rounded-md">
        <MoviePoster result={result} />
      </a>

      <div className="grid min-w-0 content-start gap-2 [overflow-wrap:anywhere]">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold leading-tight text-slate-50"><a {...detailLink}>{result.title}</a></h3>
          <p className="mt-1 text-xs text-slate-500">{metadataLine(result)}</p>
          {directorLine(result) ? (
            <p className="mt-1 text-xs font-semibold text-slate-500">{copy.library.director(directorLine(result))}</p>
          ) : null}
        </div>

        {tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge className={genreBadgeClass(tag)} key={`${result.assetKey}-${tag}`} variant="secondary">{tag}</Badge>
            ))}
          </div>
        ) : null}

        <p className="line-clamp-2 text-sm leading-6 text-slate-400">{bestSummary(result)}</p>
        {entry.doubanImport?.rating != null && <p className="text-sm text-amber-200">我的评分：{entry.doubanImport.rating} / 10</p>}
        {entry.doubanImport?.comment && <p className="whitespace-pre-wrap break-words text-sm text-slate-300">我的短评：{entry.doubanImport.comment}</p>}
        {entry.doubanImport?.tags && <p className="text-xs text-slate-400">我的标签：{entry.doubanImport.tags}</p>}
        <p className="min-w-0 break-words text-xs font-semibold leading-5 text-slate-500">
          <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
          {stampedLabel}
          {variant ? ` / ${variantSpecText(result.title, variant, { compact: true })}` : ` / ${unavailableLabel}`}
          {ready && variant?.cache?.media?.contentLength && !variantHasSizeMetadata(variant) ? ` / ${formatBytes(variant.cache.media.contentLength)}` : ""}
        </p>
      </div>

      <div className="col-span-2 grid min-w-0 content-between gap-3 sm:col-span-1 sm:col-start-2 lg:col-start-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
          {variant && (ready ? <Badge variant="default">{copy.cache.status.ready}</Badge> : <Badge variant="muted">{copy.cache.notCached}</Badge>)}
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => onRemove(entry.assetKey, mark)}
            title={removeLabel}
            aria-label={removeLabel}
          >
            {mark === "favorite" ? (
              <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
            ) : mark === "watching" ? (
              <Play className="h-4 w-4 text-sky-200" />
            ) : mark === "wantToWatch" ? (
              <Eye className="h-4 w-4 text-sky-200" />
            ) : (
              <CheckCircle2 className="h-4 w-4 fill-emerald-300 text-emerald-300" />
            )}
          </Button>
        </div>

        {variant ? (
          <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
          <Button asChild variant="outline" size="sm"><a {...detailLink}>查看详情 · {result.variants?.length} 个规格</a></Button>
          <Button className="justify-center" type="button" size="sm" variant={ready ? "default" : "secondary"} onClick={() => onSelect(result, variant)}>
            <Play className="h-4 w-4" />
            {ready ? copy.watchlist.play : copy.watchlist.prepare}
          </Button>
          </div>
        ) : (
          <Badge className="justify-self-end" variant="danger">
            <Film className="h-3.5 w-3.5" />
            {unavailableLabel}
          </Badge>
        )}
      </div>
    </article>
  );
}

function MoviePoster({ result }: { result: ResultWithCache }) {
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-slate-900">
      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 to-emerald-950 text-3xl font-black text-emerald-100">
        {titleInitial(result.title)}
      </div>
      <PosterImage
        alt={result.title}
        className="absolute inset-0 h-full w-full object-cover"
        result={result}
      />
    </div>
  );
}
