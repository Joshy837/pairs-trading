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
import { FactorStockResult } from "@/types";
import { CHART_AXIS, CHART_COLORS } from "@/lib/tokens";

interface Props {
  data: FactorStockResult;
  zscoreWindow: number;
}

export default function ResidualStockChart({ data, zscoreWindow }: Props) {
  const chartData = data.dates.map((date, i) => ({
    date,
    residual:
      data.residual[i] != null
        ? Number(((data.residual[i] as number) * 100).toFixed(4))
        : undefined,
    zscore:
      data.zscore[i] != null
        ? Number((data.zscore[i] as number).toFixed(4))
        : undefined,
  }));

  const interval = Math.max(1, Math.floor(chartData.length / 7));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-muted mb-2">
          Idiosyncratic Return ε — factor-neutral daily return (%)
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
            <XAxis dataKey="date" interval={interval} tick={CHART_AXIS} tickLine={false} />
            <YAxis
              tick={CHART_AXIS}
              tickLine={false}
              width={54}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
            <Tooltip
              formatter={(v: number) => [`${v.toFixed(3)}%`, "ε"]}
              labelStyle={{ fontSize: CHART_AXIS.fontSize }}
              contentStyle={{ fontSize: CHART_AXIS.fontSize }}
            />
            <ReferenceLine y={0} stroke={CHART_COLORS.zero} />
            <Line
              type="monotone"
              dataKey="residual"
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
          Rolling Z-Score of ε ({zscoreWindow}-day window)
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
