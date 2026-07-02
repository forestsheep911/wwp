import { CalendarDays, Film, Play, Star } from "lucide-react";
import type { CacheAsset, CreditPolicyResponse, MediaVariant } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  bestSummary,
  directorLine,
  displayVariantLabel,
  formatBytes,
  formatDateTime,
  metadataLine,
  visibleTags
} from "../format";
import { genreBadgeClass } from "../genre-style";
import { copy } from "../i18n";
import type { FavoriteEntry, ResultWithCache } from "../types";
import { formatCreditAmount, playbackCreditCost } from "../types";
import { EmptyState } from "./EmptyState";

interface FavoriteCandidate {
  entry: FavoriteEntry;
  result: ResultWithCache;
  variant?: MediaVariant;
  ready: boolean;
}

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
  onRemove: (assetKey: string) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const cachedByAssetKey = new Map(cachedAssets.map((asset) => [asset.assetKey, asset]));
  const candidates = favorites.map((entry) => hydrateFavorite(entry, cachedByAssetKey));

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
      <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-black/20">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">
            <Star className="h-3.5 w-3.5 fill-current" />
            {copy.favorites.count(favorites.length)}
          </Badge>
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold leading-tight text-slate-50">{copy.favorites.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{copy.favorites.description}</p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {candidates.map((candidate) => (
          <FavoriteCard
            candidate={candidate}
            creditPolicy={creditPolicy}
            key={candidate.entry.assetKey}
            onRemove={onRemove}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
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
  onRemove,
  onSelect
}: {
  candidate: FavoriteCandidate;
  creditPolicy: CreditPolicyResponse;
  onRemove: (assetKey: string) => void;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const { entry, result, variant, ready } = candidate;
  const tags = visibleTags(result.metadata?.genres).slice(0, 4);

  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <h3 className="line-clamp-2 font-semibold leading-6 text-slate-50">{result.title}</h3>
            <p className="mt-1 text-sm text-slate-400">{metadataLine(result)}</p>
            {directorLine(result) ? (
              <p className="mt-1 text-xs font-semibold text-slate-500">{copy.library.director(directorLine(result))}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onRemove(entry.assetKey)}
              title={copy.favorites.remove}
              aria-label={copy.favorites.remove}
            >
              <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
            </Button>
            {ready ? <Badge variant="default">{copy.cache.status.ready}</Badge> : <Badge variant="muted">{copy.cache.notCached}</Badge>}
          </div>
        </div>

        {tags.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge className={genreBadgeClass(tag)} key={`${result.assetKey}-${tag}`} variant="secondary">{tag}</Badge>
            ))}
          </div>
        ) : null}

        <p className="line-clamp-2 text-sm leading-6 text-slate-400">{bestSummary(result)}</p>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <p className="min-w-0 truncate text-xs font-semibold text-slate-500">
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
            {copy.favorites.addedAt(formatDateTime(entry.addedAt))}
            {variant ? ` / ${displayVariantLabel(result.title, variant.label)}` : ` / ${copy.favorites.noPlayableVariant}`}
            {ready && variant?.cache?.media?.contentLength ? ` / ${formatBytes(variant.cache.media.contentLength)}` : ""}
          </p>
          {variant ? (
            <Button type="button" size="sm" variant={ready ? "default" : "secondary"} onClick={() => onSelect(result, variant)}>
              <Play className="h-4 w-4" />
              {ready
                ? formatCreditAmount(playbackCreditCost(variant.cache?.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)
                : `${copy.watchlist.prepare} ${formatCreditAmount(creditPolicy.cacheCredits, creditPolicy.unitSymbol)}`}
            </Button>
          ) : (
            <Badge variant="danger">
              <Film className="h-3.5 w-3.5" />
              {copy.favorites.noPlayableVariant}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
