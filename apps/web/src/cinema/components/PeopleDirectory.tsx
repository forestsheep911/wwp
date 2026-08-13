import { ArrowUpRight, BookOpenText, RefreshCw, Search, UsersRound } from "lucide-react";
import type { PublicPersonSummary } from "@wwpdw/shared";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { personDepartmentLabel } from "../person-route";

export function PeopleDirectory({
  people,
  total,
  workRelationshipCount,
  query,
  loading,
  loadingMore,
  hasMore,
  error,
  onQueryChange,
  onLoadMore,
  onOpenPerson,
  onRetry
}: {
  people: PublicPersonSummary[];
  total: number;
  workRelationshipCount: number;
  query: string;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  onQueryChange: (query: string) => void;
  onLoadMore: () => void;
  onOpenPerson: (personId: string) => void;
  onRetry: () => void;
}) {
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5" aria-label="人物索引">
      <header className="relative overflow-hidden rounded-2xl border border-amber-200/15 bg-[radial-gradient(circle_at_82%_12%,rgba(251,191,36,0.14),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-5 shadow-2xl shadow-black/20 sm:p-7">
        <div className="pointer-events-none absolute -right-8 top-0 text-[9rem] font-black leading-none text-white/[0.025] sm:text-[13rem]">人</div>
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.26em] text-amber-200/70"><BookOpenText className="h-4 w-4" />People Index · 创作人索引</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-50 sm:text-5xl">从一个人，重新进入电影。</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">导演、编剧与卡司会逐步连成一张作品地图。关系先完整保存，人物小传与译名则在核对后慢慢补齐。</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <IndexStat label="已建档" value={total} />
            <IndexStat label="作品关系" value={workRelationshipCount} />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-800/90 bg-slate-950/75 p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 flex-1 sm:max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="h-11 w-full rounded-lg border border-slate-800 bg-slate-950 pl-10 pr-3 text-sm text-slate-100 outline-none transition focus:border-amber-300/45 focus:ring-2 focus:ring-amber-300/10"
            placeholder="搜索中文名、英文名或代表作"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <p className="text-xs text-slate-500">已加载 {people.length} / {total} 位</p>
      </div>

      {error ? (
        <div className="grid min-h-56 place-items-center gap-3 rounded-xl border border-rose-400/25 bg-rose-400/5 p-6 text-center">
          <div><p className="font-bold text-rose-100">人物索引暂时无法读取</p><p className="mt-2 text-sm text-rose-200/70">{error}</p></div>
          <Button onClick={onRetry} variant="outline"><RefreshCw className="h-4 w-4" />重试</Button>
        </div>
      ) : loading && people.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <PersonCardSkeleton key={index} />)}</div>
      ) : people.length === 0 ? (
        <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-center"><div><UsersRound className="mx-auto h-9 w-9 text-slate-700" /><p className="mt-3 font-bold text-slate-300">没有匹配的人物</p><p className="mt-1 text-sm text-slate-500">换一个姓名或作品关键词试试。</p></div></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => <PersonCard key={person.personId} person={person} onOpen={() => onOpenPerson(person.personId)} />)}
        </div>
      )}

      {hasMore && !error ? (
        <div className="flex justify-center pt-1">
          <Button onClick={onLoadMore} variant="outline" disabled={loadingMore || loading}>
            {loadingMore ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            {loadingMore ? "正在加载" : `继续加载（剩余 ${Math.max(0, total - people.length)} 位）`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PersonCard({ person, onOpen }: { person: PublicPersonSummary; onOpen: () => void }) {
  const alternate = [person.names.english, person.names.original]
    .find((name) => name && name !== person.names.primary);
  const biographyLabels = [
    person.biographyLanguages.some((language) => language.startsWith("zh")) ? "中" : undefined,
    person.biographyLanguages.some((language) => language.startsWith("en")) ? "EN" : undefined
  ].filter(Boolean);
  return (
    <button className="group grid min-h-44 grid-cols-[88px_minmax(0,1fr)] gap-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/72 p-3 text-left transition duration-300 hover:-translate-y-0.5 hover:border-amber-300/35 hover:bg-slate-900/80 hover:shadow-xl hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60" onClick={onOpen} type="button">
      <div className="relative h-full min-h-36 overflow-hidden rounded-lg border border-slate-800 bg-[linear-gradient(145deg,#172033,#090d16)]">
        {person.profileUrl ? <img className="h-full w-full object-cover grayscale-[15%] transition duration-500 group-hover:scale-[1.04] group-hover:grayscale-0" src={person.profileUrl} alt="" /> : <div className="grid h-full place-items-center text-3xl font-black text-slate-600">{person.names.primary?.slice(0, 1) ?? "?"}</div>}
        <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-950 to-transparent" />
      </div>
      <div className="flex min-w-0 flex-col py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><h2 className="truncate text-lg font-black text-slate-50">{person.names.primary}</h2>{alternate ? <p className="mt-0.5 truncate text-xs text-slate-500">{alternate}</p> : null}</div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-700 transition group-hover:text-amber-200" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">{person.departments.slice(0, 3).map((department) => <Badge key={department} variant="secondary">{personDepartmentLabel(department)}</Badge>)}</div>
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{person.representativeWorks.join(" · ") || "作品关系正在整理"}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px]">
          <span className={person.dataStatus === "verified" ? "text-emerald-300" : "text-amber-200/75"}>{person.dataStatus === "verified" ? "资料已核对" : "资料补充中"}</span>
          <span className="text-slate-600">{person.workCount} 部作品{biographyLabels.length ? ` · 小传 ${biographyLabels.join("/")}` : ""}</span>
        </div>
      </div>
    </button>
  );
}

function IndexStat({ label, value }: { label: string; value: number }) {
  return <div className="min-w-24 rounded-lg border border-white/10 bg-black/15 px-3 py-2"><p className="text-2xl font-black text-amber-100">{value}</p><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p></div>;
}

function PersonCardSkeleton() {
  return <div className="grid min-h-44 animate-pulse grid-cols-[88px_minmax(0,1fr)] gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="rounded-lg bg-slate-900" /><div className="grid content-start gap-3 py-2"><div className="h-5 w-2/3 rounded bg-slate-900" /><div className="h-3 w-1/2 rounded bg-slate-900" /><div className="mt-2 h-16 rounded bg-slate-900/70" /></div></div>;
}
