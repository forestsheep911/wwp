import { useEffect, useRef } from "react";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import type { SearchResult } from "@wwpdw/shared";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { directDownloadName, triggerDirectDownload } from "../download";
import { formatLongDate } from "../format";
import { copy } from "../i18n";

export interface DirectDownloadDialogState {
  assetKey: string;
  title: string;
  status: "loading" | "ready" | "error";
  downloadUrl?: string;
  expiresAt?: string;
  error?: string;
  target?: SearchResult;
  autoDownload?: boolean;
}

export function DirectDownloadDialog({
  state,
  onOpenChange,
  onDownloadAgain
}: {
  state?: DirectDownloadDialogState;
  onOpenChange: (open: boolean) => void;
  onDownloadAgain: () => void;
}) {
  const triggeredDownloadRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state?.status === "loading") {
      triggeredDownloadRef.current = undefined;
      return;
    }
    if (state?.status !== "ready" || !state.downloadUrl) return;
    if (state.autoDownload === false) return;
    const triggerKey = `${state.assetKey}:${state.downloadUrl}`;
    if (triggeredDownloadRef.current === triggerKey) return;
    triggeredDownloadRef.current = triggerKey;
    triggerDirectDownload(state.downloadUrl, state.title);
  }, [state?.assetKey, state?.autoDownload, state?.downloadUrl, state?.status, state?.title]);

  if (!state) return null;

  const fileName = directDownloadName(state.title);
  const title = state.status === "loading"
    ? copy.download.preparing
    : state.status === "error"
      ? copy.download.failed
      : copy.download.ready;
  const description = state.status === "loading"
    ? copy.download.preparingDescription
    : state.status === "error"
      ? copy.download.failedDescription
      : copy.download.directDescription;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div className="grid min-h-36 place-items-center rounded-xl border border-slate-800 bg-slate-950/70">
            <div className="grid place-items-center gap-3 text-sm font-semibold text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-300" />
              {copy.download.refreshingLink}
            </div>
          </div>
        ) : state.status === "error" ? (
          <div className="grid gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-rose-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-5 w-5" />
              {copy.download.failed}
            </div>
            <p className="text-sm leading-6 text-rose-200">{state.error}</p>
          </div>
        ) : state.downloadUrl ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="line-clamp-2 font-semibold leading-6 text-slate-100">{state.title}</p>
              <p className="mt-1 break-all text-xs leading-5 text-slate-500">{fileName}</p>
              {state.expiresAt ? (
                <p className="mt-2 text-xs text-amber-200">{copy.download.expiresAt(formatLongDate(state.expiresAt))}</p>
              ) : null}
            </div>
            <Button className="w-full" size="lg" type="button" onClick={onDownloadAgain}>
              <Download className="h-5 w-5" />
              {copy.download.freeDownload}
            </Button>
            <p className="text-xs leading-5 text-slate-500">
              {copy.download.directFallback}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
