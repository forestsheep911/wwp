import { useId } from "react";
import type { CompositeRatingValue } from "../composite-rating";

const axes = [
  { source: "douban", label: "豆瓣", max: 10 },
  { source: "imdb", label: "IMDb", max: 10 },
  { source: "rotten", label: "烂番茄新鲜度", max: 100 },
  { source: "metacritic", label: "Metacritic", max: 100 }
] as const;

function point(index: number, radius: number) {
  const angle = index * Math.PI * 2 / axes.length - Math.PI / 2;
  return { x: 180 + Math.cos(angle) * radius, y: 150 + Math.sin(angle) * radius };
}

export function RatingRadar({ ratings }: { ratings: CompositeRatingValue[] }) {
  const titleId = useId();
  const values = axes.map((axis) => {
    const raw = ratings.find((rating) => rating.source === axis.source)?.value;
    const match = raw?.trim().match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(10|100)|%)?$/);
    const value = match ? Number(match[1]) : NaN;
    const max = match?.[2] ? Number(match[2]) : axis.max;
    const valid = Number.isFinite(value) && value >= 0 && value <= max;
    return { ...axis, raw, normalized: valid ? value / max * 100 : undefined };
  });
  const count = values.filter((value) => value.normalized !== undefined).length;
  if (!count) return null;
  const complete = count === axes.length;
  return (
    <section className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-4 sm:px-5" aria-labelledby={titleId}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={titleId} className="text-sm font-semibold text-slate-200">评分雷达</h3>
        <span className="text-xs tabular-nums text-slate-400">{count} / {axes.length} 项</span>
      </div>
      <svg viewBox="0 0 360 300" className="mx-auto block w-full max-w-[380px]" role="img" aria-label={values.map((value) => `${value.label}：${value.normalized === undefined ? "暂无评分" : value.raw}`).join("；")}>
        {[25, 50, 75, 100].map((radius) => (
          <g key={radius}>
            <polygon points={axes.map((_, index) => { const p = point(index, radius); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke="currentColor" className="text-slate-700" />
            <text x={185} y={150 - radius + 12} fontSize="9" fill="currentColor" className="text-slate-500">{radius}</text>
          </g>
        ))}
        {axes.map((axis, index) => { const p = point(index, 100); return <line key={axis.source} x1="180" y1="150" x2={p.x} y2={p.y} stroke="currentColor" className="text-slate-700" />; })}
        {complete && <polygon points={values.map((value, index) => { const p = point(index, value.normalized!); return `${p.x},${p.y}`; }).join(" ")} fill="rgb(52 211 153 / 0.16)" stroke="#6ee7b7" strokeWidth="2" strokeLinejoin="round" />}
        {values.map((value, index) => {
          const label = point(index, 123);
          const p = value.normalized === undefined ? undefined : point(index, value.normalized);
          return <g key={value.source}>
            {p && <circle cx={p.x} cy={p.y} r="4" fill="#6ee7b7" stroke="#0f172a" strokeWidth="2"><title>{value.label}：{value.raw}（归一化 {Math.round(value.normalized!)}）</title></circle>}
            <text x={label.x} y={label.y - 3} textAnchor="middle" fill="currentColor" className="text-slate-300" fontSize="11">{value.label}</text>
            <text x={label.x} y={label.y + 13} textAnchor="middle" fill="currentColor" className={p ? "text-emerald-300" : "text-slate-500"} fontSize="12">{p ? value.raw : "暂无"}</text>
          </g>;
        })}
      </svg>
      <p className="text-xs leading-5 text-slate-400">统一为 100 刻度，标签保留原始分数。烂番茄为好评比例，各平台口径不同。{!complete && "缺失项留空，数据齐全后显示连线。"}</p>
    </section>
  );
}
