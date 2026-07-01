import { Database, Play } from "lucide-react";
import type { CreditPolicyResponse, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Progress } from "../../components/ui/progress";
import {
  cacheErrorLabel,
  formatDateTime,
  jobMessageLabel,
  jobStatusLabel,
  jobVariant
} from "../format";
import { formatCreditAmount, playbackCreditCost, type TrackedCacheItem } from "../types";
import { MediaDiagnosticsView } from "./MediaDiagnosticsView";

export function StatusPanel({
  creditPolicy,
  items,
  onOpenPlayer
}: {
  creditPolicy: CreditPolicyResponse;
  items: TrackedCacheItem[];
  onOpenPlayer: (assetKey: string, result?: SearchResult) => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="sticky top-5 flex max-h-[calc(100vh-2.5rem)] flex-col overflow-hidden">
        <CardHeader className="shrink-0 pr-16">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-emerald-300" />
            当前准备任务
          </CardTitle>
          <CardDescription>本次浏览器还没有正在准备的影片</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="sticky top-5 flex max-h-[calc(100vh-2.5rem)] flex-col overflow-hidden">
      <CardHeader className="shrink-0 pr-16">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="min-w-0 truncate">当前准备任务</span>
          <Badge className="shrink-0" variant="secondary">{items.length} 项</Badge>
        </CardTitle>
        <CardDescription>本次浏览器发起的准备任务</CardDescription>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-3">
        {items.map(({ job, asset, result }) => (
          <div key={job.id} className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-3">
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
              {job.resolve ? (
                <span className="text-slate-500">{job.resolve.layer} / {job.resolve.kind}</span>
              ) : (
                <span className="text-slate-500">{formatDateTime(job.lastRequestedAt ?? job.createdAt)}</span>
              )}
            </div>
            {job.error ? <p className="text-xs font-semibold text-rose-300">{cacheErrorLabel(job.error)}</p> : null}
            {asset?.media ? <MediaDiagnosticsView media={asset.media} /> : null}
            {asset?.status === "ready" ? (
              <Button type="button" size="sm" onClick={() => onOpenPlayer(asset.assetKey, result)}>
                <Play className="h-4 w-4" />
                {formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
