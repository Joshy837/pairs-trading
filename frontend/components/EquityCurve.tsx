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
import { CHART_AXIS, CHART_COLORS } from "@/lib/tokens";

interface Props {
  data: { dates: string[]; equity_curve: (number | null)[]; benchmark?: (number | null)[] | null };
}

export default function EquityCurve({ data }: Props) {
  const hasBenchmark = Array.isArray(data.benchmark);

  const chartData = data.dates
    .map((date, i) => ({
      date,
      equity: data.equity_curve[i] != null ? Number(data.equity_curve[i]!.toFixed(2)) : undefined,
      ...(hasBenchmark && {
        benchmark: data.benchmark![i] != null ? Number(data.benchmark![i]!.toFixed(2)) : undefined,
      }),
    }))
    .filter((d) => d.equity !== undefined);

  const interval = Math.max(1, Math.floor(chartData.length / 7));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="date" interval={interval} tick={CHART_AXIS} tickLine={false} />
        <YAxis
          tick={CHART_AXIS}
          tickLine={false}
          width={55}
          tickFormatter={(v) => `$${v}`}
          domain={["auto", "auto"]}
        />
        <Tooltip
          formatter={(v: number) => `$${v?.toFixed(2)}`}
          labelStyle={{ fontSize: CHART_AXIS.fontSize }}
          contentStyle={{ fontSize: CHART_AXIS.fontSize }}
        />
        <ReferenceLine y={100} stroke={CHART_COLORS.zero} strokeDasharray="4 3" />
        {hasBenchmark && (
          <Line
            type="monotone"
            dataKey="benchmark"
            name="SPY"
            stroke={CHART_COLORS.benchmark}
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            connectNulls={false}
          />
        )}
        <Line
          type="monotone"
          dataKey="equity"
          name="Portfolio"
          stroke={CHART_COLORS.equity}
          dot={false}
          strokeWidth={2}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
