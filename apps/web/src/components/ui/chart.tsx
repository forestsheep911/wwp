import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "../../lib/utils";

export type ChartConfig = Record<string, {
  label?: React.ReactNode;
  color?: string;
}>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used inside ChartContainer");
  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const generatedId = React.useId();
  const chartId = `chart-${id ?? generatedId.replace(/:/g, "")}`;
  const colorVariables = Object.fromEntries(
    Object.entries(config)
      .filter(([, item]) => item.color)
      .map(([key, item]) => [`--color-${key}`, item.color])
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        data-slot="chart"
        className={cn(
          "flex justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-[var(--chart-muted)] [&_.recharts-cartesian-grid_line]:stroke-[var(--chart-grid)] [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-slate-900/70 [&_.recharts-surface]:outline-none",
          className
        )}
        style={{ ...colorVariables, ...style }}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

interface TooltipPayloadItem {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  valueFormatter
}: React.ComponentProps<"div"> & {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  valueFormatter?: (value: string | number) => React.ReactNode;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  return (
    <div className={cn("grid min-w-32 gap-2 rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-2xl shadow-black/40 backdrop-blur", className)}>
      {label !== undefined ? <strong className="font-semibold text-slate-200">{label}</strong> : null}
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? item.name ?? index);
        return (
          <div className="flex items-center justify-between gap-5" key={key}>
            <span className="flex items-center gap-2 text-slate-400">
              <i className="h-2 w-2 rounded-sm" style={{ background: item.color ?? config[key]?.color ?? "var(--color-count)" }} />
              {config[key]?.label ?? item.name ?? "数量"}
            </span>
            <strong className="tabular-nums text-slate-100">
              {item.value !== undefined ? valueFormatter?.(item.value) ?? item.value : "—"}
            </strong>
          </div>
        );
      })}
    </div>
  );
}
