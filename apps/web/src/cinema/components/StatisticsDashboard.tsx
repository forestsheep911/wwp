import { useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarRange,
  ChartNoAxesCombined,
  ChartPie,
  Clapperboard,
  Database,
  Globe2,
  Layers3,
  MapPinned,
  Play,
  RefreshCw,
  Tags,
  UsersRound
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";
import { errorMessage, getSiteStatistics } from "../../api";
import { Button } from "../../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import type { SiteStatisticItem, SiteStatistics } from "../site-statistics";

const numberFormat = new Intl.NumberFormat("zh-CN");
const countChartConfig = {
  count: { label: "收录", color: "var(--chart-1)" }
} satisfies ChartConfig;
const typeChartConfig = {
  movie: { label: "电影", color: "var(--chart-1)" },
  television: { label: "电视", color: "var(--chart-2)" }
} satisfies ChartConfig;

export function StatisticsDashboard() {
  const [statistics, setStatistics] = useState<SiteStatistics>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    getSiteStatistics()
      .then(setStatistics)
      .catch((loadError) => setError(errorMessage(loadError, "统计信息加载失败。")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !statistics) return <StatisticsLoading />;
  if (!statistics) {
    return (
      <section className="mx-auto grid min-h-[55vh] max-w-6xl place-items-center">
        <div className="grid max-w-md justify-items-center gap-4 text-center">
          <ChartNoAxesCombined className="h-10 w-10 text-slate-600" />
          <div>
            <h1 className="text-xl font-bold text-slate-100">暂时无法读取统计</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
          </div>
          <Button type="button" variant="outline" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </div>
      </section>
    );
  }

  const { totals } = statistics;
  return (
    <section className="mx-auto grid w-full max-w-[1480px] gap-5 pb-8" aria-label="片库统计">
      <header className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 px-6 py-7 shadow-2xl shadow-black/20 sm:px-8 sm:py-9">
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-emerald-300/8 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300">收藏地图</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">片库统计</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">从完整索引读取的收录规模、内容结构与即刻播放状态。</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <Database className="h-4 w-4 text-emerald-300" />
            <span>索引更新 {formatTimestamp(statistics.latestIndexedAt ?? statistics.generatedAt)}</span>
            <button className="grid h-8 w-8 place-items-center rounded-full hover:bg-slate-900 hover:text-slate-100" type="button" title="刷新统计" onClick={load}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <MetricCard icon={<Layers3 />} label="总收录" value={totals.titles} accent="text-emerald-200" />
        <MetricCard icon={<Clapperboard />} label="媒体规格" value={totals.variants} />
        <MetricCard icon={<Play />} label="即刻播放" value={totals.instantPlay} accent="text-amber-200" />
        <MetricCard icon={<UsersRound />} label="人物" value={totals.people} />
        <MetricCard icon={<Tags />} label="题材种类" value={totals.genreCount} />
        <MetricCard icon={<Globe2 />} label="国家/地区" value={totals.countryCount} />
        <MetricCard icon={<Building2 />} label="制作公司" value={totals.companyCount} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <DashboardPanel icon={<ChartPie />} title="内容构成" detail="电影 + 电视 = 总收录">
          <TypeComposition statistics={statistics} />
        </DashboardPanel>
        <DashboardPanel icon={<CalendarRange />} title="年代分布" detail="按首映年份">
          <DecadeChart items={statistics.decades} />
        </DashboardPanel>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <DashboardPanel icon={<ChartNoAxesCombined />} title="题材分布" detail={`${statistics.genres.length} 个题材`}>
          <RankedBars items={statistics.genres} />
        </DashboardPanel>
        <DashboardPanel icon={<MapPinned />} title="国家与地区" detail="收录数量前 10">
          <CountryGrid items={statistics.countries} />
        </DashboardPanel>
      </div>

      <DashboardPanel
        icon={<Building2 />}
        title="制作公司分布"
        detail={`已录入 ${numberFormat.format(totals.companyCoveredTitles)} / ${numberFormat.format(totals.titles)} 部`}
      >
        <CompanyDistribution statistics={statistics} />
      </DashboardPanel>
    </section>
  );
}

function MetricCard({ icon, label, value, accent = "text-slate-100" }: { icon: ReactNode; label: string; value: number; accent?: string }) {
  return (
    <article className="group rounded-xl border border-slate-800 bg-slate-950/72 p-4 transition-colors hover:border-slate-700">
      <div className="flex items-center justify-between text-slate-600">
        <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/50 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <strong className={`mt-4 block text-2xl font-black tabular-nums ${accent}`}>{numberFormat.format(value)}</strong>
      <span className="mt-1 block text-xs font-semibold text-slate-500">{label}</span>
    </article>
  );
}

function DashboardPanel({ icon, title, detail, children }: { icon: ReactNode; title: string; detail: string; children: ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/72 p-5 shadow-xl shadow-black/10 sm:p-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-emerald-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          <h2 className="text-sm font-bold text-slate-100">{title}</h2>
        </div>
        <span className="text-[11px] font-semibold text-slate-600">{detail}</span>
      </header>
      {children}
    </article>
  );
}

function TypeComposition({ statistics }: { statistics: SiteStatistics }) {
  const total = Math.max(1, statistics.totals.titles);
  const items = [
    { key: "movie", label: "电影", count: statistics.totals.movies, fill: "var(--color-movie)" },
    { key: "television", label: "电视", count: statistics.totals.series, fill: "var(--color-television)" }
  ];
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="relative mx-auto h-56 w-full max-w-72">
        <ChartContainer className="h-full w-full" config={typeChartConfig}>
          <PieChart accessibilityLayer>
            <ChartTooltip content={<ChartTooltipContent valueFormatter={(value) => numberFormat.format(Number(value))} />} />
            <Pie
              data={items}
              dataKey="count"
              innerRadius={62}
              isAnimationActive={false}
              nameKey="label"
              outerRadius={88}
              paddingAngle={2}
              stroke="var(--chart-grid)"
              strokeWidth={2}
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <strong className="text-2xl font-black tabular-nums text-slate-100">{numberFormat.format(statistics.totals.titles)}</strong>
          <span className="mt-1 text-[10px] font-semibold tracking-wide text-slate-500">总收录</span>
        </div>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <div className="rounded-lg border border-slate-800/80 bg-slate-900/45 px-3 py-3" key={item.key}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-400"><i className="h-2 w-2 rounded-full" style={{ background: item.fill }} />{item.label}</span>
              <strong className="text-sm tabular-nums text-slate-200">{numberFormat.format(item.count)}</strong>
            </div>
            <span className="mt-1 block text-right text-[10px] tabular-nums text-slate-600">{(item.count / total * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecadeChart({ items }: { items: SiteStatisticItem[] }) {
  const visible = [...items]
    .filter((item) => item.count > 0)
    .sort((left, right) => decadeSortValue(left.label) - decadeSortValue(right.label));
  return (
    <ChartContainer className="h-56 w-full" config={countChartConfig}>
      <BarChart accessibilityLayer data={visible} margin={{ top: 18, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 5" />
        <XAxis axisLine={false} dataKey="label" interval={0} tickFormatter={shortDecade} tickLine={false} tickMargin={10} />
        <ChartTooltip cursor={{ fill: "rgb(15 23 42 / 0.7)" }} content={<ChartTooltipContent valueFormatter={(value) => numberFormat.format(Number(value))} />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[5, 5, 2, 2]}>
          <LabelList dataKey="count" fill="var(--chart-label)" fontSize={10} formatter={(value) => numberFormat.format(Number(value))} position="top" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function RankedBars({ items }: { items: SiteStatisticItem[] }) {
  return (
    <ChartContainer className="w-full" config={countChartConfig} style={{ height: Math.max(368, items.length * 34) }}>
      <BarChart accessibilityLayer data={items} layout="vertical" margin={{ top: 0, right: 42, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 5" />
        <XAxis hide type="number" />
        <YAxis axisLine={false} dataKey="label" tickLine={false} tickMargin={10} type="category" width={52} />
        <ChartTooltip cursor={{ fill: "rgb(15 23 42 / 0.7)" }} content={<ChartTooltipContent valueFormatter={(value) => numberFormat.format(Number(value))} />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[0, 5, 5, 0]}>
          <LabelList dataKey="count" fill="var(--chart-label)" fontSize={11} formatter={(value) => numberFormat.format(Number(value))} position="right" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function CompanyDistribution({ statistics }: { statistics: SiteStatistics }) {
  const { totals, companies } = statistics;
  const coverage = totals.titles > 0 ? totals.companyCoveredTitles / totals.titles * 100 : 0;

  if (companies.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">制作公司数据尚未录入。</p>;
  }

  return (
    <div className="grid gap-7 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="rounded-xl border border-slate-800 bg-slate-900/45 p-5">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500">当前数据覆盖率</span>
        <strong className="mt-3 block text-3xl font-black tabular-nums text-emerald-200">{coverage.toFixed(1)}%</strong>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="制作公司数据覆盖率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage}>
          <span className="block h-full rounded-full bg-emerald-300" style={{ width: `${coverage}%` }} />
        </div>
        <p className="mt-4 text-xs leading-6 text-slate-500">仅统计已填写制作公司字段的作品；随着元数据补充，排行和覆盖率会自动更新。</p>
      </aside>
      <ChartContainer className="w-full" config={countChartConfig} style={{ height: Math.max(240, companies.length * 34) }}>
        <BarChart accessibilityLayer data={companies} layout="vertical" margin={{ top: 0, right: 42, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 5" />
          <XAxis hide type="number" />
          <YAxis axisLine={false} dataKey="label" tickLine={false} tickMargin={10} type="category" width={150} />
          <ChartTooltip cursor={{ fill: "rgb(15 23 42 / 0.7)" }} content={<ChartTooltipContent valueFormatter={(value) => numberFormat.format(Number(value))} />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={[0, 5, 5, 0]}>
            <LabelList dataKey="count" fill="var(--chart-label)" fontSize={11} formatter={(value) => numberFormat.format(Number(value))} position="right" />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function CountryGrid({ items }: { items: SiteStatisticItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/45 px-3 py-2.5" key={item.label}>
          <span className="truncate text-xs font-semibold text-slate-400">{item.label}</span>
          <strong className="ml-3 text-xs tabular-nums text-slate-200">{numberFormat.format(item.count)}</strong>
        </div>
      ))}
    </div>
  );
}

function StatisticsLoading() {
  return (
    <section className="mx-auto grid w-full max-w-[1480px] animate-pulse gap-5" aria-label="正在加载片库统计">
      <div className="h-40 rounded-2xl border border-slate-800 bg-slate-950/72" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div className="h-28 rounded-xl bg-slate-900/70" key={index} />)}</div>
      <div className="grid gap-5 xl:grid-cols-2"><div className="h-80 rounded-2xl bg-slate-900/60" /><div className="h-80 rounded-2xl bg-slate-900/60" /></div>
    </section>
  );
}

function formatTimestamp(value?: string) {
  if (!value) return "未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function shortDecade(label: string) {
  if (label === "1949 年以前") return "<1950";
  if (label === "未知") return "未知";
  return label.slice(2, 4) + "s";
}

function decadeSortValue(label: string) {
  if (label === "未知") return 0;
  if (label === "1949 年以前") return 1;
  const year = Number(label.match(/\d{4}/u)?.[0]);
  return Number.isFinite(year) ? year : 0;
}
