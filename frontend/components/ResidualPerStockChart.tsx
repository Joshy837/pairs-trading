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

const RESID2_COLOR = CHART_COLORS.equity;

interface Props {
  data: FactorAnalysisResult;
}

export default function ResidualPerStockChart({ data }: Props) {
  const chartData = data.dates.map((date, i) => ({
    date,
    resid1: data.resid1[i] != null ? Number(((data.resid1[i] as number) * 100).toFixed(4)) : undefined,
    resid2: data.resid2[i] != null ? Number(((data.resid2[i] as number) * 100).toFixed(4)) : undefined,
  }));

  const interval = Math.max(1, Math.floor(chartData.length / 7));

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="w-5 h-0.5 inline-block rounded" style={{ background: CHART_COLORS.spread }} />
          ε₁ {data.ticker1}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="w-5 h-0.5 inline-block rounded" style={{ background: RESID2_COLOR }} />
          ε₂ {data.ticker2}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
          <XAxis dataKey="date" interval={interval} tick={CHART_AXIS} tickLine={false} />
          <YAxis
            tick={CHART_AXIS}
            tickLine={false}
            width={50}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          />
          <Tooltip
            formatter={(v: number, name: string) => [
              `${v.toFixed(3)}%`,
              name === "resid1" ? `ε₁ (${data.ticker1})` : `ε₂ (${data.ticker2})`,
            ]}
            labelStyle={{ fontSize: CHART_AXIS.fontSize }}
            contentStyle={{
              fontSize: CHART_AXIS.fontSize,
              background: "#1f2937",
              border: "1px solid #374151",
            }}
          />
          <ReferenceLine y={0} stroke={CHART_COLORS.zero} />
          <Line
            type="monotone"
            dataKey="resid1"
            stroke={CHART_COLORS.spread}
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="resid2"
            stroke={RESID2_COLOR}
            dot={false}
            strokeWidth={1.5}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
