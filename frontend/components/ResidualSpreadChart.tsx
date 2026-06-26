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
import { FactorAnalysisResult } from "@/types";
import { CHART_AXIS, CHART_COLORS } from "@/lib/tokens";

interface Props {
  data: FactorAnalysisResult;
}

export default function ResidualSpreadChart({ data }: Props) {
  const chartData = data.dates.map((date, i) => ({
    date,
    spread: data.spread[i] !== null ? Number(data.spread[i]?.toFixed(6)) : undefined,
    zscore: data.zscore[i] !== null ? Number(data.zscore[i]?.toFixed(4)) : undefined,
  }));

  const interval = Math.max(1, Math.floor(chartData.length / 7));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-muted mb-2">
          Residual Spread — ε₁ − β·ε₂ (factor-neutral daily returns)
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
            <XAxis dataKey="date" interval={interval} tick={CHART_AXIS} tickLine={false} />
            <YAxis tick={CHART_AXIS} tickLine={false} width={70} tickFormatter={(v) => v.toFixed(4)} />
            <Tooltip
              formatter={(v: number) => [v?.toFixed(6), "Residual Spread"]}
              labelStyle={{ fontSize: CHART_AXIS.fontSize }}
              contentStyle={{ fontSize: CHART_AXIS.fontSize }}
            />
            <ReferenceLine y={0} stroke={CHART_COLORS.zero} />
            <Line
              type="monotone"
              dataKey="spread"
              stroke={CHART_COLORS.spread}
              dot={false}
              strokeWidth={1.5}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="text-xs font-medium text-muted mb-2">
          Z-Score of Residual Spread
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
            <XAxis dataKey="date" interval={interval} tick={CHART_AXIS} tickLine={false} />
            <YAxis tick={CHART_AXIS} tickLine={false} width={40} />
            <Tooltip
              formatter={(v: number) => [v?.toFixed(3), "Z-Score"]}
              labelStyle={{ fontSize: CHART_AXIS.fontSize }}
              contentStyle={{ fontSize: CHART_AXIS.fontSize }}
            />
            <ReferenceLine y={0} stroke={CHART_COLORS.zero} />
            <ReferenceLine y={2} stroke={CHART_COLORS.entry} strokeDasharray="5 3" strokeWidth={1.5} />
            <ReferenceLine y={-2} stroke={CHART_COLORS.entry} strokeDasharray="5 3" strokeWidth={1.5} />
            <Line
              type="monotone"
              dataKey="zscore"
              stroke={CHART_COLORS.zscore}
              dot={false}
              strokeWidth={1.5}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
