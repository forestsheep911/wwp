import { useMemo, useState } from "react";
import { CheckCircle2, Database, Loader2, Play, RefreshCw } from "lucide-react";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-50">{copy.tasks.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{copy.tasks.description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefreshCached} disabled={loadingCached}>
          <RefreshCw className={`h-4 w-4 ${loadingCached ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </div>

      <div className="flex w-full rounded-md border border-slate-800 bg-slate-950 p-1 sm:w-fit">
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
          <div className="flex w-full rounded-md border border-slate-800 bg-slate-950 p-1 sm:w-fit">
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
      className="flex-1 sm:flex-none"
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
        <Card key={job.id} className="min-w-0 overflow-hidden">
          <CardContent className="grid gap-3 p-4">
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
              <span className="text-slate-500">{formatDateTime(job.lastRequestedAt ?? job.createdAt)}</span>
            </div>
            {job.error ? <p className="text-xs font-semibold text-rose-300">{cacheErrorLabel(job.error)}</p> : null}
            {asset?.media ? <MediaDiagnosticsView media={asset.media} /> : null}
            {asset?.status === "ready" ? (
              <Button type="button" size="sm" onClick={() => onOpenPlayer(asset.assetKey, result)}>
                <Play className="h-4 w-4" />
                {formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
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
        <Card key={asset.assetKey} className="min-w-0 overflow-hidden">
          <CardContent className="grid min-w-0 gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 truncate font-semibold text-slate-50">{asset.title}</p>
                {asset.requestedByMemberName ? <Badge variant="muted">{asset.requestedByMemberName}</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)} / {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
              </p>
            </div>
            <Button className="w-full shrink-0 sm:w-auto" type="button" onClick={() => onOpen(asset.assetKey)}>
              <CheckCircle2 className="h-4 w-4" />
              {formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
