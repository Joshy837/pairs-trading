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
  entryZ: number;
  exitZ: number;
  stopZ?: number;
  insampleEndDate?: string;
  ticker1: string;
  ticker2: string;
}

export default function SpreadChart({ data, entryZ, exitZ, stopZ, insampleEndDate, ticker1, ticker2 }: Props) {
  const chartData = data.dates.map((date, i) => ({
    date,
    spread: data.spread[i] !== null ? Number(data.spread[i]?.toFixed(4)) : undefined,
    zscore: data.zscore[i] !== null ? Number(data.zscore[i]?.toFixed(4)) : undefined,
  }));

  const interval = Math.max(1, Math.floor(chartData.length / 7));

  return (
    <div className="space-y-6">
      {/* Spread */}
      <div>
        <p className="text-xs font-medium text-muted mb-2">
          Spread — {ticker1} − β·{ticker2}
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
            <XAxis dataKey="date" interval={interval} tick={CHART_AXIS} tickLine={false} />
            <YAxis tick={CHART_AXIS} tickLine={false} width={60} />
            <Tooltip
              formatter={(v: number) => [v?.toFixed(4), "Spread"]}
              labelStyle={{ fontSize: CHART_AXIS.fontSize }}
              contentStyle={{ fontSize: CHART_AXIS.fontSize }}
            />
            {insampleEndDate && (
              <ReferenceLine
                x={insampleEndDate}
                stroke={CHART_COLORS.zero}
                strokeDasharray="6 3"
              />
            )}
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

      {/* Z-Score */}
      <div>
        <p className="text-xs font-medium text-muted mb-2">
          Z-Score &nbsp;
          <span className="text-red-500">— entry ±{entryZ}</span>
          &nbsp;
          <span className="text-green-600">— exit ±{exitZ}</span>
          {stopZ !== undefined && (
            <>&nbsp;<span className="text-amber-500">— stop ±{stopZ}</span></>
          )}
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
            <ReferenceLine
              y={entryZ}
              stroke={CHART_COLORS.entry}
              strokeDasharray="5 3"
              strokeWidth={1.5}
            />
            <ReferenceLine
              y={-entryZ}
              stroke={CHART_COLORS.entry}
              strokeDasharray="5 3"
              strokeWidth={1.5}
            />
            <ReferenceLine
              y={exitZ}
              stroke={CHART_COLORS.exit}
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <ReferenceLine
              y={-exitZ}
              stroke={CHART_COLORS.exit}
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            {stopZ !== undefined && (
              <>
                <ReferenceLine y={stopZ} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
                <ReferenceLine y={-stopZ} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
              </>
            )}
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
