import { useState } from "react";
import { CheckCircle2, ChevronDown, ListChecks, Play } from "lucide-react";
import type { CreditPolicyResponse, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import { trackedCacheNeedsStatusRefresh } from "../cache-flow";
import { jobMessageLabel, jobStatusLabel, jobVariant } from "../format";
import { copy } from "../i18n";
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
  const activeItems = items.filter(trackedCacheNeedsStatusRefresh);
  const readyItems = items.filter(({ asset }) => asset?.status === "ready");

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom)+100vh-100dvh)] right-3 z-[95] w-[min(22rem,calc(100dvw-1.5rem))] sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:right-4 sm:w-[min(22rem,calc(100vw-2rem))]">
      {open ? (
        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur sm:rounded-lg">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2.5">
            <button
              className="flex min-h-11 min-w-0 items-center gap-2 rounded-md text-left"
              type="button"
              onClick={onOpenTasks}
              title={copy.tasks.viewAllTitle}
            >
              <ListChecks className="h-4 w-4 shrink-0 text-emerald-300" />
              <span className="truncate text-sm font-semibold text-slate-50">{copy.tasks.floatingTitle}</span>
              <Badge variant={activeItems.length ? "warning" : "secondary"}>{activeItems.length}</Badge>
            </button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} title={copy.tasks.collapse}>
              <ChevronDown className="h-4 w-4" />
              <span className="sr-only">{copy.tasks.collapseSr}</span>
            </Button>
          </div>
          <div className="grid max-h-[45vh] gap-2 overflow-y-auto p-2 sm:max-h-[55vh]">
            {items.slice(0, 4).map(({ job, asset, result }) => (
              <div key={job.id} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3 sm:rounded-md sm:p-2.5">
                <div className="grid gap-2 sm:flex sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-semibold text-slate-50">{job.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{jobMessageLabel(job)}</p>
                  </div>
                  <Badge variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                </div>
                <Progress value={job.progress} />
                {asset?.status === "ready" ? (
                  <Button className="w-full" type="button" size="sm" onClick={() => onOpenPlayer(asset.assetKey, result)}>
                    <Play className="h-4 w-4" />
                    {formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
                  </Button>
                ) : null}
              </div>
            ))}
            {items.length > 4 ? (
              <Button className="w-full" type="button" variant="outline" size="sm" onClick={onOpenTasks}>
                {copy.tasks.viewAllCount(items.length)}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button
          className="ml-auto min-h-12 rounded-full border border-emerald-300/25 bg-slate-950/95 px-4 shadow-2xl shadow-black/50 backdrop-blur sm:h-11 sm:min-h-0"
          type="button"
          variant="secondary"
          onClick={() => setOpen(true)}
        >
          {readyItems.length ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <ListChecks className="h-4 w-4 text-emerald-200" />}
          {copy.tasks.preparing}
          <Badge variant={activeItems.length ? "warning" : "secondary"}>{activeItems.length}</Badge>
        </Button>
      )}
    </div>
  );
}
