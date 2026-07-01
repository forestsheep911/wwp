import { useState } from "react";
import { CheckCircle2, ChevronDown, ListChecks, Play } from "lucide-react";
import type { CreditPolicyResponse, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import { jobMessageLabel, jobStatusLabel, jobVariant } from "../format";
import { formatCreditAmount, playbackCreditCost, type TrackedCacheItem } from "../types";

export function TaskDock({
  creditPolicy,
  items,
  onOpenPlayer,
  onOpenTasks
}: {
  creditPolicy: CreditPolicyResponse;
  items: TrackedCacheItem[];
  onOpenPlayer: (assetKey: string, result?: SearchResult) => void;
  onOpenTasks: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activeItems = items.filter(({ job }) => job.status !== "ready" && job.status !== "failed");
  const readyItems = items.filter(({ asset }) => asset?.status === "ready");

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-[95] w-[min(22rem,calc(100vw-2rem))]">
      {open ? (
        <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2.5">
            <button
              className="flex min-w-0 items-center gap-2 text-left"
              type="button"
              onClick={onOpenTasks}
              title="查看全部任务"
            >
              <ListChecks className="h-4 w-4 shrink-0 text-emerald-300" />
              <span className="truncate text-sm font-semibold text-slate-50">缓存任务</span>
              <Badge variant={activeItems.length ? "warning" : "secondary"}>{activeItems.length}</Badge>
            </button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} title="收起">
              <ChevronDown className="h-4 w-4" />
              <span className="sr-only">收起任务浮窗</span>
            </Button>
          </div>
          <div className="grid max-h-[55vh] gap-2 overflow-y-auto p-2">
            {items.slice(0, 4).map(({ job, asset, result }) => (
              <div key={job.id} className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/80 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-semibold text-slate-50">{job.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{jobMessageLabel(job)}</p>
                  </div>
                  <Badge variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                </div>
                <Progress value={job.progress} />
                {asset?.status === "ready" ? (
                  <Button type="button" size="sm" onClick={() => onOpenPlayer(asset.assetKey, result)}>
                    <Play className="h-4 w-4" />
                    {formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
                  </Button>
                ) : null}
              </div>
            ))}
            {items.length > 4 ? (
              <Button type="button" variant="outline" size="sm" onClick={onOpenTasks}>
                查看全部 {items.length} 项
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button
          className="ml-auto h-11 border border-emerald-300/25 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur"
          type="button"
          variant="secondary"
          onClick={() => setOpen(true)}
        >
          {readyItems.length ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <ListChecks className="h-4 w-4 text-emerald-200" />}
          准备中
          <Badge variant={activeItems.length ? "warning" : "secondary"}>{activeItems.length}</Badge>
        </Button>
      )}
    </div>
  );
}
