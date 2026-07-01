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
  return action === "cache" ? "准备视频" : "播放视频";
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
    return `${hours} 小时 ${minutes} 分钟`;
  }
  if (hours > 0) {
    return `${hours} 小时`;
  }
  return `${minutes} 分钟`;
}

function explanation(preview: CreditPreviewResponse, policy: CreditPolicyResponse) {
  const unit = preview.unitSymbol || policy.unitSymbol;
  const credits = formatCreditAmount(preview.credits, unit);
  if (preview.action === "cache") {
    if (preview.freeReason === "cache_active") {
      return "服务器已经在准备这个视频，本次点击不会重复扣费。";
    }
    if (preview.freeReason === "cache_ready") {
      return "这个视频已经准备好，可以进入播放确认。";
    }
    if (preview.freeReason === "admin") {
      return "管理员账号准备视频不会扣除 🍀。";
    }
    return `让服务器准备这个视频，需要花费 ${credits}。准备完成后会再确认播放花费。`;
  }

  if (preview.freeReason === "playback_replay") {
    const remaining = formatRemainingTime(preview.windowExpiresAt);
    return remaining
      ? `这个视频已经在免费重看窗口内，本次播放免费，还剩 ${remaining}。`
      : "这个视频已经在免费重看窗口内，本次播放免费。";
  }
  if (preview.freeReason === "admin") {
    return "管理员账号播放视频不会扣除 🍀。";
  }
  return `这个视频已经准备好，开始播放需要花费 ${credits}。首次点击后，${policy.playbackReplayFreeHours} 小时内重看同一视频免费。`;
}

function freeReasonLabel(reason?: CreditPreviewResponse["freeReason"]) {
  switch (reason) {
    case "admin":
      return "管理员免费";
    case "cache_ready":
      return "已准备好";
    case "cache_active":
      return "准备中";
    case "playback_replay":
      return "重看免费";
    default:
      return undefined;
  }
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
            确认花费
          </DialogTitle>
          <DialogDescription>
            {preview ? actionLabel(preview.action) : "正在确认本次花费"}
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
                    余额 {formatCreditAmount(preview.remaining, unit)}
                  </Badge>
                ) : null}
                {preview.remainingAfter !== undefined && preview.chargeable ? (
                  <Badge variant="muted">
                    扣后 {formatCreditAmount(preview.remainingAfter, unit)}
                  </Badge>
                ) : null}
              </div>
              {freeReason ? (
                <Badge variant="muted">{freeReason}</Badge>
              ) : null}
              {!preview.canAfford ? (
                <p className="mt-3 rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">
                  {unit} 不够了，请先找管理员补充。
                </p>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
                取消
              </Button>
              <Button type="button" onClick={onConfirm} disabled={loading || !preview.canAfford}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {preview.chargeable ? `花费 ${costLabel}` : "继续"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-4 py-6 text-sm font-semibold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在确认花费
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
