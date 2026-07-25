import { Search, Sparkles } from "lucide-react";

export function DiscoverSearchHero({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-emerald-300/20 bg-slate-900 px-4 py-5 shadow-xl shadow-black/20 sm:hidden">
      <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-emerald-300/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-emerald-300">
          <Sparkles className="h-4 w-4" />
          全库发现
        </div>
        <h1 className="mt-2 text-2xl font-semibold leading-tight text-slate-50">今天想看什么？</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">搜片名、导演或演员，也可以继续用下面的条件慢慢筛。</p>
        <button
          className="mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-left text-base text-slate-400 shadow-inner shadow-black/25 transition active:scale-[0.99] active:border-emerald-300/40"
          type="button"
          onClick={onOpenSearch}
        >
          <Search className="h-5 w-5 shrink-0 text-emerald-300" />
          搜索整个影视库
        </button>
      </div>
    </section>
  );
}
