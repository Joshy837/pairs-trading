"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AnalysisResult } from "@/types";
import { CHART_AXIS, CHART_COLORS } from "@/lib/tokens";

interface Props {
  data: AnalysisResult;
  insampleEndDate?: string;
}

export default function HedgeStabilityChart({ data, insampleEndDate }: Props) {
  if (!data.rolling_hedge || data.rolling_hedge.every((v) => v === null)) return null;

  const chartData = data.dates.map((date, i) => ({
    date,
    beta: data.rolling_hedge![i] !== null ? Number((data.rolling_hedge![i] as number).toFixed(4)) : undefined,
  }));

  const interval = Math.max(1, Math.floor(chartData.length / 7));

  return (
    <div>
      <p className="text-xs font-medium text-muted mb-2">
        Rolling Hedge Ratio (β) &nbsp;
        <span className="text-faint">{data.rolling_hedge_window}-day window</span>
        &nbsp;·&nbsp;
        <span className="text-faint">dashed = fixed β {data.hedge_ratio.toFixed(4)}</span>
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
          <XAxis dataKey="date" interval={interval} tick={CHART_AXIS} tickLine={false} />
          <YAxis tick={CHART_AXIS} tickLine={false} width={60} />
          <Tooltip
            formatter={(v: number) => [v?.toFixed(4), "β (rolling)"]}
            labelStyle={{ fontSize: CHART_AXIS.fontSize }}
            contentStyle={{ fontSize: CHART_AXIS.fontSize }}
          />
          {/* Fixed hedge ratio from full in-sample OLS */}
          <ReferenceLine
            y={data.hedge_ratio}
            stroke={CHART_COLORS.zero}
            strokeDasharray="6 3"
            strokeWidth={1.5}
          />
          {insampleEndDate && (
            <ReferenceLine
              x={insampleEndDate}
              stroke={CHART_COLORS.zero}
              strokeDasharray="6 3"
              label={{ value: "OOS →", fill: "#9ca3af", fontSize: 9, position: "insideTopRight" }}
            />
          )}
          <Line
            type="monotone"
            dataKey="beta"
            stroke={CHART_COLORS.spread}
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
