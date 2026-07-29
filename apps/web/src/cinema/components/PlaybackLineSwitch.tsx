import { Route } from "lucide-react";
import type { PlaybackLine } from "@wwpdw/shared";
import { playbackLineLabel } from "../playback-line";

const lines: PlaybackLine[] = ["domestic", "international"];

export function PlaybackLineSwitch({
  line,
  onChange
}: {
  line: PlaybackLine;
  onChange: (line: PlaybackLine) => void;
}) {
  return (
    <div
      className="flex h-9 shrink-0 items-center rounded-md border border-slate-700 bg-slate-950 p-0.5 shadow-inner shadow-black/25"
      role="group"
      aria-label="播放线路"
      title="播放线路"
    >
      <span className="hidden items-center gap-1.5 px-2 text-[11px] font-bold text-slate-500 xl:flex">
        <Route className="h-3.5 w-3.5" />
        线路
      </span>
      {lines.map((option) => {
        const active = line === option;
        const label = playbackLineLabel(option);
        return (
        <button
          className={`h-7 min-w-10 rounded-[0.3rem] px-2 text-xs font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
            active
              ? "bg-emerald-300 text-slate-950 shadow-sm shadow-emerald-950/30"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          }`}
          key={option}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
        );
      })}
    </div>
  );
}
