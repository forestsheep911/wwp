import { AlertCircle, Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { directDownloadName } from "../download";
import { formatLongDate } from "../format";
import { copy } from "../i18n";

export interface DirectDownloadDialogState {
  assetKey: string;
  title: string;
  status: "loading" | "ready" | "error";
  downloadUrl?: string;
  notionPageUrl?: string;
  expiresAt?: string;
  error?: string;
}

export function DirectDownloadDialog({
  state,
  onOpenChange
}: {
  state?: DirectDownloadDialogState;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>{state?.status === "loading" ? copy.download.preparing : copy.download.ready}</DialogTitle>
          <DialogDescription>
            {state?.status === "loading"
              ? copy.download.preparingDescription
              : state?.notionPageUrl
                ? copy.download.notionDescription
                : copy.download.directDescription}
          </DialogDescription>
        </DialogHeader>

        {state?.status === "loading" ? (
          <div className="grid min-h-36 place-items-center rounded-xl border border-slate-800 bg-slate-950/70">
            <div className="grid place-items-center gap-3 text-sm font-semibold text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-300" />
              {copy.download.refreshingLink}
            </div>
          </div>
        ) : state?.status === "error" ? (
          <div className="grid gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-rose-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-5 w-5" />
              {copy.download.failed}
            </div>
            <p className="text-sm leading-6 text-rose-200">{state.error}</p>
          </div>
        ) : state?.downloadUrl ? (
          <div className="grid gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="line-clamp-2 font-semibold leading-6 text-slate-100">{state.title}</p>
              <p className="mt-1 break-all text-xs leading-5 text-slate-500">{directDownloadName(state.title)}</p>
              {state.expiresAt ? (
                <p className="mt-2 text-xs text-amber-200">{copy.download.expiresAt(formatLongDate(state.expiresAt))}</p>
              ) : null}
            </div>
            <Button asChild className="w-full" size="lg">
              <a
                href={state.notionPageUrl ?? state.downloadUrl}
                rel="noreferrer"
                referrerPolicy="no-referrer"
              >
                {state.notionPageUrl ? <ExternalLink className="h-5 w-5" /> : <Download className="h-5 w-5" />}
                {state.notionPageUrl ? copy.download.openNotion : copy.download.openFile}
              </a>
            </Button>
            {state.notionPageUrl ? (
              <Button asChild className="w-full" size="lg" variant="outline">
                <a href={state.downloadUrl} rel="noreferrer" referrerPolicy="no-referrer">
                  <Download className="h-5 w-5" />
                  {copy.download.openFile}
                </a>
              </Button>
            ) : null}
            <p className="text-xs leading-5 text-slate-500">
              {state.notionPageUrl ? copy.download.notionInstructions : copy.download.directFallback}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
