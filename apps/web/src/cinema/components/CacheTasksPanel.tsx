import { useMemo, useState } from "react";
import { Database, Loader2, Play, RefreshCw, Route } from "lucide-react";
import type { CacheAsset, CreditPolicyResponse, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Progress } from "../../components/ui/progress";
import {
  cacheErrorLabel,
  formatBytes,
  formatDateTime,
  jobMessageLabel,
  jobStatusLabel,
  jobVariant,
  mediaQuality
} from "../format";
import { copy } from "../i18n";
import { formatCreditAmount, playbackCreditCost, type TrackedCacheItem } from "../types";
import { EmptyState } from "./EmptyState";
import { MediaDiagnosticsView } from "./MediaDiagnosticsView";
import { PreparedLineBadges } from "./PreparedLineBadges";

type MainTab = "preparing" | "ready";
type ReadyTab = "mine" | "public";

export function CacheTasksPanel({
  cachedAssets,
  creditPolicy,
  currentMemberId,
  loadingCached,
  preparingItems,
  onOpenPlayer,
  onRefreshCached
}: {
  cachedAssets: CacheAsset[];
  creditPolicy: CreditPolicyResponse;
  currentMemberId?: string;
  loadingCached: boolean;
  preparingItems: TrackedCacheItem[];
  onOpenPlayer: (assetKey: string, result?: SearchResult) => void;
  onRefreshCached: () => void;
}) {
  const [mainTab, setMainTab] = useState<MainTab>("preparing");
  const [readyTab, setReadyTab] = useState<ReadyTab>("mine");
  const readyAssets = useMemo(
    () => cachedAssets.filter((asset) => asset.status === "ready"),
    [cachedAssets]
  );
  const myAssets = useMemo(
    () => currentMemberId
      ? readyAssets.filter((asset) => asset.requestedByMemberId === currentMemberId)
      : [],
    [currentMemberId, readyAssets]
  );
  const publicAssets = useMemo(
    () => readyAssets.filter((asset) => !currentMemberId || asset.requestedByMemberId !== currentMemberId),
    [currentMemberId, readyAssets]
  );
  const shownReadyAssets = readyTab === "mine" ? myAssets : publicAssets;

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-50">{copy.tasks.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{copy.tasks.description}</p>
        </div>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefreshCached} disabled={loadingCached}>
          <RefreshCw className={`h-4 w-4 ${loadingCached ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </div>

      <div className="flex w-full rounded-xl border border-slate-800 bg-slate-950 p-1 sm:w-fit sm:rounded-md">
        <TaskTabButton active={mainTab === "preparing"} onClick={() => setMainTab("preparing")}>
          {copy.tasks.preparing}
          <Badge variant={preparingItems.length ? "warning" : "secondary"}>{preparingItems.length}</Badge>
        </TaskTabButton>
        <TaskTabButton active={mainTab === "ready"} onClick={() => setMainTab("ready")}>
          {copy.tasks.cached}
          <Badge variant="secondary">{readyAssets.length}</Badge>
        </TaskTabButton>
      </div>

      {mainTab === "preparing" ? (
        <PreparingList
          creditPolicy={creditPolicy}
          items={preparingItems}
          onOpenPlayer={onOpenPlayer}
        />
      ) : (
        <div className="grid gap-4">
          <div className="flex w-full rounded-xl border border-slate-800 bg-slate-950 p-1 sm:w-fit sm:rounded-md">
            <TaskTabButton active={readyTab === "mine"} onClick={() => setReadyTab("mine")}>
              {copy.tasks.mine}
              <Badge variant="secondary">{myAssets.length}</Badge>
            </TaskTabButton>
            <TaskTabButton active={readyTab === "public"} onClick={() => setReadyTab("public")}>
              {copy.tasks.publicPool}
              <Badge variant="secondary">{publicAssets.length}</Badge>
            </TaskTabButton>
          </div>
          <ReadyAssetList
            assets={shownReadyAssets}
            creditPolicy={creditPolicy}
            loading={loadingCached}
            onOpen={onOpenPlayer}
          />
        </div>
      )}
    </section>
  );
}

function TaskTabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      className="min-h-11 flex-1 rounded-lg sm:min-h-8 sm:flex-none sm:rounded-md"
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function PreparingList({
  creditPolicy,
  items,
  onOpenPlayer
}: {
  creditPolicy: CreditPolicyResponse;
  items: TrackedCacheItem[];
  onOpenPlayer: (assetKey: string, result?: SearchResult) => void;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<Database className="h-5 w-5" />} title={copy.tasks.noPreparing} />;
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {items.map(({ job, asset, result }) => (
        <Card key={job.id} className="min-w-0 overflow-hidden rounded-xl sm:rounded-lg">
          <CardContent className="grid gap-3 p-4">
            <div className="grid gap-2 sm:flex sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-50">{job.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{jobMessageLabel(job)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={job.line === "domestic" ? "default" : "secondary"}>
                  {job.line === "domestic" ? "国内线路" : "国际线路"}
                </Badge>
                <Badge variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
              </div>
            </div>
            <Progress value={job.progress} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-200">{job.progress}%</span>
              <span className="text-slate-500">{formatDateTime(job.lastRequestedAt ?? job.createdAt)}</span>
            </div>
            {job.error ? <p className="text-xs font-semibold text-rose-300">{cacheErrorLabel(job.error)}</p> : null}
            {asset?.media ? <MediaDiagnosticsView media={asset.media} /> : null}
            {asset?.status === "ready" ? (
              <Button className="w-full sm:w-auto" type="button" size="sm" onClick={() => onOpenPlayer(asset.assetKey, result)}>
                <Play className="h-4 w-4" />
                {creditPolicy.billingEnabled
                  ? formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)
                  : copy.watchlist.play}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ReadyAssetList({
  assets,
  creditPolicy,
  loading,
  onOpen
}: {
  assets: CacheAsset[];
  creditPolicy: CreditPolicyResponse;
  loading: boolean;
  onOpen: (assetKey: string) => void;
}) {
  if (assets.length === 0 && loading) {
    return <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title={copy.tasks.loadingCached} />;
  }

  if (assets.length === 0) {
    return <EmptyState icon={<Database className="h-5 w-5" />} title={copy.tasks.emptyCached} />;
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {assets.map((asset) => (
        <Card key={asset.assetKey} className="min-w-0 overflow-hidden rounded-xl sm:rounded-lg">
          <CardContent className="grid min-w-0 gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 truncate font-semibold text-slate-50">{asset.title}</p>
                {asset.requestedByMemberName ? <Badge variant="muted">{asset.requestedByMemberName}</Badge> : null}
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-400 sm:leading-normal">
                {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)} / {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
              </p>
              <div className="mt-2">
                <PreparedLineBadges asset={asset} />
              </div>
            </div>
            <Button className="w-full shrink-0 sm:w-auto" type="button" onClick={() => onOpen(asset.assetKey)}>
              <Route className="h-4 w-4" />
              {creditPolicy.billingEnabled
                ? formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)
                : "选择线路播放"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
