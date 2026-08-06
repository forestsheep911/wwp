import { CheckCircle2, Download, Globe2, Loader2, MapPin, Play, Sparkles } from "lucide-react";
import type { CacheAssetLookupResponse, PlaybackLine } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";

const lineDetails: Record<PlaybackLine, {
  label: string;
  description: string;
  icon: typeof MapPin;
  accent: string;
}> = {
  domestic: {
    label: "国内线路",
    description: "通常更适合中国大陆网络",
    icon: MapPin,
    accent: "border-emerald-300/45 bg-emerald-300/[0.07] hover:bg-emerald-300/[0.12]"
  },
  international: {
    label: "国际线路",
    description: "通常更适合境外及跨境网络",
    icon: Globe2,
    accent: "border-sky-300/40 bg-sky-300/[0.06] hover:bg-sky-300/[0.11]"
  }
};

export interface PlaybackLineChoice {
  assetKey: string;
  title: string;
  canPrepare: boolean;
  canDownload: boolean;
  loading: boolean;
  error?: string;
  availability?: Partial<Record<PlaybackLine, CacheAssetLookupResponse>>;
}

export function PlaybackLineDialog({
  choice,
  preferredLine,
  onClose,
  onDownload,
  onSelect
}: {
  choice?: PlaybackLineChoice;
  preferredLine: PlaybackLine;
  onClose: () => void;
  onDownload: () => void;
  onSelect: (line: PlaybackLine) => void;
}) {
  return (
    <Dialog open={Boolean(choice)} onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="sm:w-[min(94vw,760px)]">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-emerald-300">
            <Play className="h-4 w-4 fill-current" />
            <span className="text-xs font-black tracking-[0.18em]">播放与下载</span>
          </div>
          <DialogTitle>选择使用方式</DialogTitle>
          <DialogDescription>
            选择一条在线播放线路，或免费下载原始媒体文件。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-800 bg-slate-900/65 px-3 py-2.5">
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-100">{choice?.title}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {(["domestic", "international"] as const).map((line) => {
            const detail = lineDetails[line];
            const Icon = detail.icon;
            const status = choice?.availability?.[line];
            const playable = Boolean(status?.playable);
            const enabled = !choice?.loading && (playable || Boolean(choice?.canPrepare));
            const isPreferred = preferredLine === line;
            return (
              <button
                className={`group relative grid min-h-44 content-between gap-4 rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:border-slate-800 disabled:bg-slate-950/50 disabled:opacity-55 ${detail.accent}`}
                disabled={!enabled}
                key={line}
                type="button"
                onClick={() => onSelect(line)}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-950/80">
                    <Icon className={`h-5 w-5 ${line === "domestic" ? "text-emerald-300" : "text-sky-300"}`} />
                  </span>
                  {isPreferred ? (
                    <Badge variant="muted">
                      <Sparkles className="h-3 w-3" />
                      上次使用
                    </Badge>
                  ) : null}
                </div>
                <div>
                  <p className="font-black text-slate-50">{detail.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{detail.description}</p>
                </div>
                <div className={`flex items-center gap-1.5 text-xs font-bold ${
                  choice?.loading
                    ? "text-slate-400"
                    : playable
                      ? "text-emerald-200"
                      : choice?.canPrepare
                        ? "text-amber-200"
                        : "text-slate-500"
                }`}>
                  {choice?.loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : playable
                      ? <CheckCircle2 className="h-4 w-4" />
                      : <Play className="h-4 w-4" />}
                  {choice?.loading
                    ? "正在检查"
                    : playable
                      ? "已准备，直接播放"
                      : choice?.canPrepare
                        ? "尚未准备，选择后开始准备"
                        : "这条线路尚未准备"}
                </div>
              </button>
            );
          })}

          <button
            className="group relative grid min-h-44 content-between gap-4 rounded-xl border border-amber-300/40 bg-amber-300/[0.06] p-4 text-left transition-all hover:bg-amber-300/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-950/50 disabled:opacity-55"
            disabled={!choice?.canDownload}
            type="button"
            onClick={onDownload}
          >
            <span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-950/80">
              <Download className="h-5 w-5 text-amber-200" />
            </span>
            <div>
              <p className="font-black text-slate-50">免费下载</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">获取这个规格的原始媒体文件</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
              <Download className="h-4 w-4" />
              获取下载地址
            </div>
          </button>
        </div>

        {choice?.error ? (
          <p className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">
            {choice.error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-slate-500">系统会记住上次使用的播放线路，仅作为下次的醒目标记。</p>
          <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
