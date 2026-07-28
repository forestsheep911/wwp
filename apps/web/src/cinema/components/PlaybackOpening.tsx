import { Clapperboard, Loader2, RadioTower, ShieldCheck } from "lucide-react";

export function PlaybackOpening({ restoringSession = false }: { restoringSession?: boolean }) {
  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-slate-950 px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(16,185,129,0.13),transparent_34%),linear-gradient(180deg,#020617_0%,#07111f_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

      <section
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-950/88 px-6 py-10 text-center shadow-2xl shadow-black/60 backdrop-blur-xl sm:px-10 sm:py-12"
        role="status"
        aria-live="polite"
      >
        <div className="relative mx-auto grid h-24 w-24 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full border border-emerald-300/20 [animation-duration:2.4s]" />
          <span className="absolute inset-2 rounded-full border border-emerald-300/25 bg-emerald-400/5" />
          <Clapperboard className="relative h-10 w-10 text-emerald-200" />
          <Loader2 className="absolute -bottom-0.5 -right-0.5 h-7 w-7 animate-spin rounded-full bg-slate-950 p-1 text-emerald-300" />
        </div>

        <p className="mt-7 text-xs font-black tracking-[0.3em] text-emerald-300">WWP 家庭影院</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-50 sm:text-3xl">正在打开播放器</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">
          {restoringSession
            ? "正在恢复登录状态，随后会自动确认播放席位。"
            : "正在确认播放席位与本机媒体，完成后会自动开始。"}
        </p>

        <div className="mx-auto mt-8 grid max-w-sm gap-3 text-left sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/7 px-4 py-3">
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" />
            <span className="text-xs font-semibold text-slate-300">
              {restoringSession ? "恢复安全会话" : "登录状态已确认"}
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3">
            <RadioTower className="h-5 w-5 shrink-0 animate-pulse text-sky-300" />
            <span className="text-xs font-semibold text-slate-300">连接本机播放服务</span>
          </div>
        </div>

        <div className="mx-auto mt-8 h-1.5 max-w-sm overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-2/5 animate-[playback-opening_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-emerald-400 via-emerald-200 to-sky-300" />
        </div>
        <p className="mt-4 text-xs font-medium text-slate-500">请保持此标签页打开</p>
      </section>
    </main>
  );
}
