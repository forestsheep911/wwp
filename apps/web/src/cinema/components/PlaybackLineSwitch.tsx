import { Check, ChevronDown, Globe2, Route } from "lucide-react";
import type { PlaybackLine, PlaybackLinePreference } from "@wwpdw/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu";
import { playbackLineLabel } from "../playback-line";

const options: Array<{
  value: PlaybackLinePreference;
  label: string;
  detail: string;
}> = [
  { value: "auto", label: "自动选择", detail: "按设备时区建议线路" },
  { value: "domestic", label: "国内 OSS", detail: "国内访问优先" },
  { value: "international", label: "国际 Azure", detail: "海外访问优先" }
];

export function PlaybackLineSwitch({
  preference,
  resolvedLine,
  onChange
}: {
  preference: PlaybackLinePreference;
  resolvedLine: PlaybackLine;
  onChange: (preference: PlaybackLinePreference) => void;
}) {
  const label = playbackLineLabel(resolvedLine);
  const automatic = preference === "auto";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="fixed bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom)+0.75rem)] left-3 z-[160] flex min-h-10 items-center gap-2 rounded-full border border-sky-300/35 bg-slate-950/94 px-3 py-2 text-sky-100 shadow-xl shadow-black/30 backdrop-blur-md transition-colors hover:border-sky-200/60 hover:bg-slate-900 sm:bottom-4 sm:left-5"
          type="button"
          aria-label={`播放线路：${automatic ? `自动，当前${label}` : label}`}
          title="切换播放线路"
        >
          <Route className="h-4 w-4" />
          <span className="text-xs font-black tracking-wide">{label}</span>
          {automatic ? <span className="hidden text-[10px] font-bold text-sky-300/70 min-[390px]:inline">自动</span> : null}
          <ChevronDown className="h-3.5 w-3.5 opacity-65" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="mb-2 w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-sky-300" />
          播放线路
        </DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs leading-relaxed text-slate-400">
          准备、状态和播放会始终使用同一条线路。切换不会自动复制已有影片。
        </p>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            className="items-start gap-2"
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
              {preference === option.value ? <Check className="h-4 w-4 text-emerald-300" /> : null}
            </span>
            <span className="grid gap-0.5">
              <span className="font-semibold">
                {option.label}
                {option.value === "auto" ? `（当前 ${label}）` : ""}
              </span>
              <span className="text-xs text-slate-400">{option.detail}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
