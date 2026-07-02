import { Loader2, ReceiptText } from "lucide-react";
import type { MemberCreditUsageResponse } from "@wwpdw/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { Badge } from "../../components/ui/badge";
import { formatDateTime } from "../format";
import { copy, creditReasonLabel } from "../i18n";

interface CreditUsageDialogProps {
  error: string;
  loading: boolean;
  open: boolean;
  usage?: MemberCreditUsageResponse;
  onOpenChange: (open: boolean) => void;
}

export function CreditUsageDialog({
  error,
  loading,
  open,
  usage,
  onOpenChange
}: CreditUsageDialogProps) {
  const entries = usage?.entries ?? [];
  const balance = usage?.member?.credits;
  const unitSymbol = balance?.unitSymbol ?? "🍀";
  const totalSpent = entries.reduce((total, entry) => total + entry.credits, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,720px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-emerald-300" />
            {copy.credit.usageTitle}
          </DialogTitle>
          <DialogDescription>
            {usage?.member
              ? copy.credit.memberUsageDescription(usage.member.name, balance?.remaining ?? 0, balance?.unitSymbol ?? "🍀")
              : copy.credit.usageDescription}
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">{error}</p> : null}

        {loading ? (
          <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/70 px-4 py-6 text-sm font-semibold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy.credit.loadingUsage}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded border border-slate-800 bg-slate-950/70 px-4 py-6 text-sm text-slate-400">
            {copy.credit.noUsage}
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-xs font-semibold text-slate-500">{copy.credit.spent}</p>
                <p className="mt-1 text-lg font-bold text-slate-50">{unitSymbol} {totalSpent}</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-xs font-semibold text-slate-500">{copy.credit.remaining}</p>
                <p className="mt-1 text-lg font-bold text-emerald-200">{unitSymbol} {balance?.remaining ?? 0}</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-xs font-semibold text-slate-500">{copy.credit.entries}</p>
                <p className="mt-1 text-lg font-bold text-slate-50">{entries.length}</p>
              </div>
            </div>

            <div className="max-h-[52vh] overflow-auto rounded border border-slate-800">
              <div className="grid divide-y divide-slate-800">
                {entries.map((entry) => (
                  <div key={entry.id} className="grid gap-2 bg-slate-950/50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-50" title={entry.title}>{entry.title}</p>
                      <p className="mt-1 truncate font-mono text-xs text-slate-500" title={entry.assetKey}>{entry.assetKey}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {formatDateTime(entry.chargedAt)}
                        {entry.windowExpiresAt ? copy.credit.freeReplayUntil(formatDateTime(entry.windowExpiresAt)) : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <Badge variant="secondary">
                        <span aria-hidden="true">{unitSymbol}</span>
                        -{entry.credits}
                      </Badge>
                      <Badge variant="muted">{creditReasonLabel(entry.reason)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
