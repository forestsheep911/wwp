import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Database,
  Dice5,
  Film,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Sparkles
} from "lucide-react";
import type { CacheAsset, CreditPolicyResponse } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { formatBytes, formatDateTime, mediaQuality } from "../format";
import { copy } from "../i18n";
import type { PlaybackHistoryEntry } from "../types";
import { formatCreditAmount, playbackCreditCost } from "../types";
import { EmptyState } from "./EmptyState";

type WatchlistFilter = "all" | "fresh" | "rewatch" | "light" | "feast";
type WatchlistSort = "smart" | "recent" | "size";

interface WatchCandidate {
  asset: CacheAsset;
  size: number;
  lastPlayedAt?: string;
  viewed: boolean;
  score: number;
}

const lightFileBytes = 3 * 1024 * 1024 * 1024;
const feastFileBytes = 8 * 1024 * 1024 * 1024;

const filterOptions: Array<{ id: WatchlistFilter; label: string }> = [
  { id: "all", label: copy.watchlist.filters.all },
  { id: "fresh", label: copy.watchlist.filters.fresh },
  { id: "rewatch", label: copy.watchlist.filters.rewatch },
  { id: "light", label: copy.watchlist.filters.light },
  { id: "feast", label: copy.watchlist.filters.feast }
];

const sortOptions: Array<{ id: WatchlistSort; label: string }> = [
  { id: "smart", label: copy.watchlist.sort.smart },
  { id: "recent", label: copy.watchlist.sort.recent },
  { id: "size", label: copy.watchlist.sort.size }
];

export function WatchlistPanel({
  cachedAssets,
  creditPolicy,
  historyItems,
  loading,
  onOpen,
  onRefresh
}: {
  cachedAssets: CacheAsset[];
  creditPolicy: CreditPolicyResponse;
  historyItems: PlaybackHistoryEntry[];
  loading: boolean;
  onOpen: (assetKey: string) => void;
  onRefresh: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<WatchlistFilter>("all");
  const [activeSort, setActiveSort] = useState<WatchlistSort>("smart");
  const [pickedAssetKey, setPickedAssetKey] = useState<string | undefined>();
  const candidates = useMemo(
    () => buildCandidates(cachedAssets, historyItems),
    [cachedAssets, historyItems]
  );
  const filteredCandidates = useMemo(
    () => sortCandidates(candidates.filter((candidate) => matchesFilter(candidate, activeFilter)), activeSort),
    [activeFilter, activeSort, candidates]
  );
  const pickedCandidate = filteredCandidates.find((candidate) => candidate.asset.assetKey === pickedAssetKey);
  const unseenCount = candidates.filter((candidate) => !candidate.viewed).length;
  const rewatchCount = candidates.length - unseenCount;

  useEffect(() => {
    if (pickedAssetKey && !filteredCandidates.some((candidate) => candidate.asset.assetKey === pickedAssetKey)) {
      setPickedAssetKey(undefined);
    }
  }, [filteredCandidates, pickedAssetKey]);

  function pickRandomCandidate() {
    if (filteredCandidates.length === 0) {
      return;
    }

    const nextCandidate = filteredCandidates[Math.floor(Math.random() * filteredCandidates.length)];
    setPickedAssetKey(nextCandidate.asset.assetKey);
  }

  if (cachedAssets.length === 0 && loading) {
    return <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title={copy.watchlist.loading} />;
  }

  if (candidates.length === 0) {
    return (
      <div className="grid gap-3">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {copy.watchlist.refresh}
          </Button>
        </div>
        <EmptyState icon={<Database className="h-5 w-5" />} title={copy.watchlist.empty} />
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-black/20 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">
              <Sparkles className="h-3.5 w-3.5" />
              {copy.watchlist.available(candidates.length)}
            </Badge>
            <Badge variant="secondary">{copy.watchlist.unseen(unseenCount)}</Badge>
            <Badge variant="muted">{copy.watchlist.rewatch(rewatchCount)}</Badge>
          </div>
          <h2 className="mt-3 text-2xl font-semibold leading-tight text-slate-50">{copy.watchlist.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{copy.watchlist.description}</p>
        </div>
        <div className="grid gap-2 sm:flex lg:justify-end">
          <Button type="button" variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {copy.common.refresh}
          </Button>
          <Button type="button" onClick={pickRandomCandidate} disabled={filteredCandidates.length === 0}>
            <Dice5 className="h-4 w-4" />
            {copy.watchlist.pick}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {filterOptions.map((option) => (
            <Button
              className="flex-none"
              key={option.id}
              type="button"
              size="sm"
              variant={activeFilter === option.id ? "secondary" : "ghost"}
              onClick={() => setActiveFilter(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {sortOptions.map((option) => (
            <Button
              className="flex-none"
              key={option.id}
              type="button"
              size="sm"
              variant={activeSort === option.id ? "secondary" : "ghost"}
              onClick={() => setActiveSort(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {pickedCandidate ? (
        <PickedCandidateCard
          candidate={pickedCandidate}
          creditPolicy={creditPolicy}
          onOpen={onOpen}
        />
      ) : null}

      {filteredCandidates.length === 0 ? (
        <EmptyState icon={<Film className="h-5 w-5" />} title={copy.watchlist.emptyFilter} />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filteredCandidates.map((candidate) => (
            <WatchCandidateCard
              candidate={candidate}
              creditPolicy={creditPolicy}
              key={candidate.asset.assetKey}
              picked={candidate.asset.assetKey === pickedAssetKey}
              onOpen={onOpen}
              onPick={() => setPickedAssetKey(candidate.asset.assetKey)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function buildCandidates(cachedAssets: CacheAsset[], historyItems: PlaybackHistoryEntry[]) {
  const historyByAssetKey = new Map<string, PlaybackHistoryEntry>();
  for (const entry of historyItems) {
    const current = historyByAssetKey.get(entry.assetKey);
    if (!current || timestamp(entry.playedAt) > timestamp(current.playedAt)) {
      historyByAssetKey.set(entry.assetKey, entry);
    }
  }

  return cachedAssets
    .filter((asset) => asset.status === "ready")
    .map((asset) => {
      const historyEntry = historyByAssetKey.get(asset.assetKey);
      const lastPlayedAt = asset.lastPlayedAt ?? historyEntry?.playedAt;
      const size = asset.media?.contentLength ?? 0;
      const viewed = Boolean(lastPlayedAt);
      const cachedAt = timestamp(asset.cachedAt ?? asset.lastRequestedAt);
      const lastPlayedScore = lastPlayedAt ? timestamp(lastPlayedAt) : 0;
      const score = (viewed ? 0 : 10_000_000_000_000) + cachedAt - lastPlayedScore / 3 + Math.min(size, feastFileBytes) / 4096;

      return {
        asset,
        size,
        lastPlayedAt,
        viewed,
        score
      };
    });
}

function sortCandidates(candidates: WatchCandidate[], sort: WatchlistSort) {
  const sorted = [...candidates];
  sorted.sort((left, right) => {
    if (sort === "recent") {
      return timestamp(right.asset.cachedAt ?? right.asset.lastRequestedAt) - timestamp(left.asset.cachedAt ?? left.asset.lastRequestedAt);
    }

    if (sort === "size") {
      return right.size - left.size;
    }

    return right.score - left.score;
  });
  return sorted;
}

function matchesFilter(candidate: WatchCandidate, filter: WatchlistFilter) {
  if (filter === "fresh") {
    return !candidate.viewed;
  }

  if (filter === "rewatch") {
    return candidate.viewed;
  }

  if (filter === "light") {
    return candidate.size > 0 && candidate.size <= lightFileBytes;
  }

  if (filter === "feast") {
    return candidate.size >= feastFileBytes;
  }

  return true;
}

function timestamp(value?: string) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function candidateReason(candidate: WatchCandidate) {
  const cachedRecently = Date.now() - timestamp(candidate.asset.cachedAt ?? candidate.asset.lastRequestedAt) < 7 * 24 * 60 * 60 * 1000;
  if (!candidate.viewed) {
    return copy.watchlist.reasonFresh;
  }

  if (candidate.size >= feastFileBytes) {
    return copy.watchlist.reasonFeast;
  }

  if (candidate.size > 0 && candidate.size <= lightFileBytes) {
    return copy.watchlist.reasonLight;
  }

  if (cachedRecently) {
    return copy.watchlist.reasonRecent;
  }

  return copy.watchlist.reasonRewatch;
}

function PickedCandidateCard({
  candidate,
  creditPolicy,
  onOpen
}: {
  candidate: WatchCandidate;
  creditPolicy: CreditPolicyResponse;
  onOpen: (assetKey: string) => void;
}) {
  return (
    <Card className="border-emerald-300/55 bg-emerald-400/10">
      <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <Badge variant="default">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {copy.watchlist.picked}
          </Badge>
          <h3 className="mt-3 truncate text-xl font-semibold text-slate-50">{candidate.asset.title}</h3>
          <p className="mt-2 text-sm text-slate-300">{candidateReason(candidate)} / {watchMetaLine(candidate)}</p>
        </div>
        <Button type="button" onClick={() => onOpen(candidate.asset.assetKey)}>
          <Play className="h-4 w-4" />
          {formatCreditAmount(playbackCreditCost(candidate.asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
        </Button>
      </CardContent>
    </Card>
  );
}

function WatchCandidateCard({
  candidate,
  creditPolicy,
  picked,
  onOpen,
  onPick
}: {
  candidate: WatchCandidate;
  creditPolicy: CreditPolicyResponse;
  picked: boolean;
  onOpen: (assetKey: string) => void;
  onPick: () => void;
}) {
  return (
    <Card className={picked ? "border-emerald-300/55 bg-emerald-400/10" : undefined}>
      <CardContent className="grid gap-3 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              className="block max-w-full truncate text-left font-semibold text-slate-50 hover:text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              type="button"
              onClick={onPick}
              title={candidate.asset.title}
            >
              {candidate.asset.title}
            </button>
            <p className="mt-1 text-sm text-slate-400">{watchMetaLine(candidate)}</p>
          </div>
          <Badge variant={candidate.viewed ? "muted" : "secondary"}>
            {candidate.viewed
              ? copy.watchlist.lastPlayed(formatDateTime(candidate.lastPlayedAt))
              : copy.watchlist.neverPlayed}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            <Gauge className="h-3.5 w-3.5" />
            {mediaQuality(candidate.asset.media)}
          </Badge>
          <Badge variant="muted">
            <Clock3 className="h-3.5 w-3.5" />
            {copy.watchlist.cachedAt(formatDateTime(candidate.asset.cachedAt ?? candidate.asset.lastRequestedAt))}
          </Badge>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <p className="min-w-0 truncate text-xs font-semibold text-slate-500">{copy.watchlist.source(candidate.asset.source)}</p>
          <Button type="button" variant={picked ? "secondary" : "outline"} size="sm" onClick={onPick}>
            <Dice5 className="h-4 w-4" />
            {copy.watchlist.picked}
          </Button>
          <Button type="button" size="sm" onClick={() => onOpen(candidate.asset.assetKey)}>
            <Play className="h-4 w-4" />
            {formatCreditAmount(playbackCreditCost(candidate.asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function watchMetaLine(candidate: WatchCandidate) {
  return [
    formatBytes(candidate.asset.media?.contentLength),
    candidate.asset.media?.contentType,
    candidate.asset.lastRequestedAt ? copy.watchlist.requestedAt(formatDateTime(candidate.asset.lastRequestedAt)) : undefined
  ].filter(Boolean).join(" / ");
}
