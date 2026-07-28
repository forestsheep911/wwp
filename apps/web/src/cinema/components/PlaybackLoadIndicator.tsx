import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import type { PlaybackCapacity, PlaybackLoadLevel } from "@wwpdw/shared";
import { getPlaybackCapacity } from "../../api";

const levelCopy: Record<PlaybackLoadLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  full: "满"
};

const levelClass: Record<PlaybackLoadLevel, string> = {
  low: "border-emerald-300/35 bg-emerald-950/92 text-emerald-100",
  medium: "border-amber-300/40 bg-amber-950/92 text-amber-100",
  high: "border-orange-300/45 bg-orange-950/94 text-orange-100",
  full: "border-rose-300/50 bg-rose-950/95 text-rose-100"
};

const dotClass: Record<PlaybackLoadLevel, string> = {
  low: "bg-emerald-300",
  medium: "bg-amber-300",
  high: "bg-orange-300",
  full: "bg-rose-300"
};

export function PlaybackLoadIndicator() {
  const [capacity, setCapacity] = useState<PlaybackCapacity>();

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await getPlaybackCapacity();
        if (!disposed) setCapacity(next);
      } catch {
        // The badge is supplementary and should not cover the site with a network error.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 8_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!capacity?.enabled) return null;

  const detail = capacity.level === "full"
    ? capacity.queued > 0
      ? `${capacity.active}/${capacity.maximum} · ${capacity.queued} 人排队`
      : `${capacity.active}/${capacity.maximum} · 暂无空位`
    : `${capacity.active}/${capacity.maximum} 路`;

  return (
    <div
      className={`fixed bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom)+0.75rem)] right-3 z-[160] flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 shadow-xl shadow-black/30 backdrop-blur-md sm:bottom-4 sm:right-5 ${levelClass[capacity.level]}`}
      role="status"
      aria-live="polite"
      title={`本机播放负载：${levelCopy[capacity.level]}，${detail}`}
    >
      <span className="relative grid h-5 w-5 place-items-center">
        <Activity className="h-4 w-4 opacity-80" />
        <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-slate-950 ${dotClass[capacity.level]}`} />
      </span>
      <span className="text-xs font-black tracking-wide">负载 {levelCopy[capacity.level]}</span>
      <span className="hidden border-l border-current/20 pl-2 text-[11px] font-semibold opacity-80 min-[390px]:inline">
        {detail}
      </span>
    </div>
  );
}
