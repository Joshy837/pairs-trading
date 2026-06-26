"use client";

import { BacktestMetrics } from "@/types";

interface Props {
  metrics: BacktestMetrics;
}

function MetricBox({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  const color =
    positive === undefined ? "text-subtle" : positive ? "text-green-400" : "text-red-400";

  return (
    <div className="bg-surface rounded-lg p-4 text-center">
      <div className="label mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-xs text-faint mt-0.5">{sub}</div>}
    </div>
  );
}

export default function ResultsPanel({ metrics }: Props) {
  const {
    sharpe_ratio,
    calmar_ratio,
    max_drawdown,
    total_return,
    num_trades,
    win_rate,
    avg_trade_duration,
    profit_factor,
  } = metrics;

  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

  const profitFactorDisplay =
    profit_factor !== null
      ? profit_factor.toFixed(2)
      : win_rate !== null
      ? "∞"
      : "—";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MetricBox
        label="Sharpe Ratio"
        value={sharpe_ratio.toFixed(2)}
        sub="annualised"
        positive={sharpe_ratio > 0}
      />
      <MetricBox
        label="Calmar Ratio"
        value={calmar_ratio !== null ? calmar_ratio.toFixed(2) : "—"}
        sub="ann. return / max DD"
        positive={calmar_ratio !== null ? calmar_ratio > 0 : undefined}
      />
      <MetricBox
        label="Total Return"
        value={fmtPct(total_return)}
        positive={total_return > 0}
      />
      <MetricBox
        label="Max Drawdown"
        value={fmtPct(max_drawdown)}
        positive={max_drawdown > -0.1}
      />
      <MetricBox
        label="# Trades"
        value={String(num_trades)}
        sub="round trips"
      />
      <MetricBox
        label="Win Rate"
        value={win_rate !== null ? fmtPct(win_rate) : "—"}
        positive={win_rate !== null ? win_rate >= 0.5 : undefined}
      />
      <MetricBox
        label="Avg Duration"
        value={avg_trade_duration !== null ? `${avg_trade_duration}d` : "—"}
        sub="trading days"
      />
      <MetricBox
        label="Profit Factor"
        value={profitFactorDisplay}
        sub="gross profit / loss"
        positive={
          profit_factor !== null
            ? profit_factor > 1
            : win_rate !== null
            ? true
            : undefined
        }
      />
    </div>
  );
}
