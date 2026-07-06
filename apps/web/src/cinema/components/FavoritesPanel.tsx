import { CalendarDays, CheckCircle2, Eye, Film, Play, Star } from "lucide-react";
import type { CacheAsset, CreditPolicyResponse, MediaVariant } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  bestSummary,
  directorLine,
  displayVariantLabel,
  formatBytes,
  formatDateTime,
  metadataLine,
  titleInitial,
  visibleTags
} from "../format";
import { genreBadgeClass } from "../genre-style";
import { copy } from "../i18n";
import type { CollectionMark, FavoriteEntry, ResultWithCache } from "../types";
import { formatCreditAmount, playbackCreditCost } from "../types";
import { EmptyState } from "./EmptyState";
import { PosterImage } from "./PosterImage";

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
  { mark: "favorite", icon: Star, className: "text-amber-200" },
  { mark: "wantToWatch", icon: Eye, className: "text-sky-200" },
  { mark: "watched", icon: CheckCircle2, className: "text-emerald-200" }
];

export function FavoritesPanel({
  cachedAssets,
  creditPolicy,
  favorites,
  onRemove,
  onSelect
}: {
  cachedAssets: CacheAsset[];
  creditPolicy: CreditPolicyResponse;
  favorites: FavoriteEntry[];
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
  const defaultSection = sections.find((section) => section.candidates.length > 0)?.mark ?? "favorite";

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
    <section className="grid gap-4">
      <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-black/20">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold leading-tight text-slate-50">{copy.favorites.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{copy.favorites.description}</p>
        </div>

        <Tabs defaultValue={defaultSection}>
          <TabsList className="justify-start bg-slate-950/72">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <TabsTrigger
                  className="data-[state=active]:bg-emerald-400 data-[state=active]:text-slate-950"
                  key={section.mark}
                  value={section.mark}
                >
                  <Icon className={`h-4 w-4 ${section.className}`} />
                  {copy.favorites.sections[section.mark]}
                  <Badge variant="secondary">{section.candidates.length}</Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {sections.map((section) => (
            <TabsContent className="mt-4" key={section.mark} value={section.mark}>
              <FavoriteSection
                creditPolicy={creditPolicy}
                section={section}
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
  return entry.watchedAt;
}

function FavoriteSection({
  creditPolicy,
  section,
  onRemove,
  onSelect
}: {
  creditPolicy: CreditPolicyResponse;
  section: (typeof favoriteSections)[number] & { candidates: FavoriteCandidate[] };
  onRemove: (assetKey: string, mark: CollectionMark) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  return (
    <div>
      {section.candidates.length ? (
        <div className="grid gap-3">
          {section.candidates.map((candidate) => (
            <FavoriteCard
              candidate={candidate}
              creditPolicy={creditPolicy}
              key={`${section.mark}-${candidate.entry.assetKey}`}
              mark={section.mark}
              onRemove={onRemove}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-800 bg-slate-950/45 px-4 py-5 text-sm font-semibold text-slate-500">
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
    cache: variant.cache ?? cachedByAssetKey.get(variant.assetKey)
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
  onRemove,
  onSelect
}: {
  candidate: FavoriteCandidate;
  creditPolicy: CreditPolicyResponse;
  mark: CollectionMark;
  onRemove: (assetKey: string, mark: CollectionMark) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const { entry, result, variant, ready } = candidate;
  const tags = visibleTags(result.metadata?.genres).slice(0, 4);
  const timestamp = markTimestamp(entry, mark) ?? entry.addedAt;
  const removeLabel = mark === "favorite"
    ? copy.favorites.remove
    : mark === "wantToWatch"
      ? copy.favorites.removeWantToWatch
      : copy.favorites.removeWatched;
  const stampedLabel = mark === "favorite"
    ? copy.favorites.addedAt(formatDateTime(timestamp))
    : mark === "wantToWatch"
      ? copy.favorites.wantToWatchAt(formatDateTime(timestamp))
      : copy.favorites.watchedAt(formatDateTime(timestamp));

  return (
    <article className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/80 p-3 shadow-xl shadow-black/10 sm:grid-cols-[76px_minmax(0,1fr)] lg:grid-cols-[84px_minmax(0,1fr)_minmax(280px,0.42fr)]">
      <div className="w-[76px] overflow-hidden rounded-md border border-slate-800 bg-slate-950 sm:w-full">
        <MoviePoster result={result} />
      </div>

      <div className="grid min-w-0 content-start gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-semibold leading-tight text-slate-50">{result.title}</h3>
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
        <p className="min-w-0 truncate text-xs font-semibold text-slate-500">
          <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
          {stampedLabel}
          {variant ? ` / ${displayVariantLabel(result.title, variant.label)}` : ` / ${copy.favorites.noPlayableVariant}`}
          {ready && variant?.cache?.media?.contentLength ? ` / ${formatBytes(variant.cache.media.contentLength)}` : ""}
        </p>
      </div>

      <div className="grid content-between gap-3 sm:col-start-2 lg:col-start-auto">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {ready ? <Badge variant="default">{copy.cache.status.ready}</Badge> : <Badge variant="muted">{copy.cache.notCached}</Badge>}
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
            ) : mark === "wantToWatch" ? (
              <Eye className="h-4 w-4 text-sky-200" />
            ) : (
              <CheckCircle2 className="h-4 w-4 fill-emerald-300 text-emerald-300" />
            )}
          </Button>
        </div>

        {variant ? (
          <Button className="justify-self-end" type="button" size="sm" variant={ready ? "default" : "secondary"} onClick={() => onSelect(result, variant)}>
            <Play className="h-4 w-4" />
            {ready
              ? formatCreditAmount(playbackCreditCost(variant.cache?.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)
              : `${copy.watchlist.prepare} ${formatCreditAmount(creditPolicy.cacheCredits, creditPolicy.unitSymbol)}`}
          </Button>
        ) : (
          <Badge className="justify-self-end" variant="danger">
            <Film className="h-3.5 w-3.5" />
            {copy.favorites.noPlayableVariant}
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
