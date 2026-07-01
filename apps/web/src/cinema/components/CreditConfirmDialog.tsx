import { Coins, Loader2 } from "lucide-react";
import type { CreditPolicyResponse, CreditPreviewResponse } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { copy, freeReasonLabel } from "../i18n";
import { formatCreditAmount } from "../types";

interface CreditConfirmDialogProps {
  loading: boolean;
  open: boolean;
  policy: CreditPolicyResponse;
  preview?: CreditPreviewResponse;
  onCancel: () => void;
  onConfirm: () => void;
}

function actionLabel(action?: CreditPreviewResponse["action"]) {
  return action === "cache" ? copy.credit.cacheAction : copy.credit.playbackAction;
}

function formatRemainingTime(expiresAt?: string) {
  if (!expiresAt) {
    return "";
  }

  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "";
  }

  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return copy.credit.remainingDuration.hoursMinutes(hours, minutes);
  }
  if (hours > 0) {
    return copy.credit.remainingDuration.hours(hours);
  }
  return copy.credit.remainingDuration.minutes(minutes);
}

function explanation(preview: CreditPreviewResponse, policy: CreditPolicyResponse) {
  const unit = preview.unitSymbol || policy.unitSymbol;
  const credits = formatCreditAmount(preview.credits, unit);
  if (preview.action === "cache") {
    if (preview.freeReason === "cache_active") {
      return copy.credit.explanations.cacheActive;
    }
    if (preview.freeReason === "cache_ready") {
      return copy.credit.explanations.cacheReady;
    }
    if (preview.freeReason === "admin") {
      return copy.credit.explanations.adminCache;
    }
    return copy.credit.explanations.cacheCharge(credits);
  }

  if (preview.freeReason === "playback_replay") {
    const remaining = formatRemainingTime(preview.windowExpiresAt);
    return remaining
      ? copy.credit.explanations.playbackReplayWithTime(remaining)
      : copy.credit.explanations.playbackReplay;
  }
  if (preview.freeReason === "admin") {
    return copy.credit.explanations.adminPlayback;
  }
  return copy.credit.explanations.playbackCharge(credits, policy.playbackReplayFreeHours);
}

export function CreditConfirmDialog({
  loading,
  open,
  policy,
  preview,
  onCancel,
  onConfirm
}: CreditConfirmDialogProps) {
  const unit = preview?.unitSymbol ?? policy.unitSymbol;
  const costLabel = formatCreditAmount(preview?.chargeable ? preview.credits : 0, unit);
  const freeReason = freeReasonLabel(preview?.freeReason);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !loading) {
        onCancel();
      }
    }}>
      <DialogContent className="w-[min(94vw,480px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-300" />
            {copy.credit.confirmTitle}
          </DialogTitle>
          <DialogDescription>
            {preview ? actionLabel(preview.action) : copy.credit.confirming}
          </DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="grid gap-4">
            <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4">
              <p className="line-clamp-2 font-semibold text-slate-50">{preview.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{explanation(preview, policy)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant={preview.chargeable ? "warning" : "secondary"}>
                  {costLabel}
                </Badge>
                {preview.remaining !== undefined ? (
                  <Badge variant={preview.canAfford ? "muted" : "danger"}>
                    {copy.credit.balance(formatCreditAmount(preview.remaining, unit))}
                  </Badge>
                ) : null}
                {preview.remainingAfter !== undefined && preview.chargeable ? (
                  <Badge variant="muted">
                    {copy.credit.afterCharge(formatCreditAmount(preview.remainingAfter, unit))}
                  </Badge>
                ) : null}
              </div>
              {freeReason ? (
                <Badge variant="muted">{freeReason}</Badge>
              ) : null}
              {!preview.canAfford ? (
                <p className="mt-3 rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">
                  {copy.credit.insufficient(unit)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
                {copy.common.cancel}
              </Button>
              <Button type="button" onClick={onConfirm} disabled={loading || !preview.canAfford}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {preview.chargeable ? copy.credit.spend(costLabel) : copy.common.continue}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-4 py-6 text-sm font-semibold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy.credit.confirming}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
