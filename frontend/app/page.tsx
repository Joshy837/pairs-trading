"use client";

import { useEffect, useState } from "react";
import CointegrationPanel from "@/components/CointegrationPanel";
import EquityCurve from "@/components/EquityCurve";
import ParameterControls from "@/components/ParameterControls";
import ResultsPanel from "@/components/ResultsPanel";
import SpreadChart from "@/components/SpreadChart";
import TickerInput from "@/components/TickerInput";
import { AnalysisResult, BacktestResult, Parameters } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DEFAULT_PARAMS: Parameters = {
  lookback_days: 365,
  zscore_window: 30,
  entry_z: 2.0,
  exit_z: 0.5,
  stop_z: 4.0,
  transaction_cost_bps: 5,
  insample_pct: 70,
};

const PRESET_PAIRS = [
  ["KO", "PEP"],
  ["GLD", "SLV"],
  ["XOM", "CVX"],
  ["MSFT", "GOOGL"],
] as const;

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel rounded-xl shadow-sm border border-divider p-5">
      {title && <h2 className="text-sm font-semibold text-subtle mb-4">{title}</h2>}
      {children}
    </div>
  );
}

export default function Page() {
  const [ticker1, setTicker1] = useState("KO");
  const [ticker2, setTicker2] = useState("PEP");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t1 = p.get("t1");
    const t2 = p.get("t2");
    if (t1) setTicker1(t1.toUpperCase());
    if (t2) setTicker2(t2.toUpperCase());
  }, []);
  const [params, setParams] = useState<Parameters>(DEFAULT_PARAMS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);

  async function handleAnalyze() {
    setError(null);
    setAnalysis(null);
    setBacktest(null);
    setLoading(true);

    const body = JSON.stringify({
      ticker1,
      ticker2,
      ...params,
      insample_pct: params.insample_pct / 100,
    });

    try {
      const [analysisRes, backtestRes] = await Promise.all([
        fetch(`${API}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
        fetch(`${API}/api/backtest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
      ]);

      const [analysisJson, backtestJson] = await Promise.all([
        analysisRes.json(),
        backtestRes.json(),
      ]);

      if (!analysisRes.ok) throw new Error(analysisJson.detail ?? "Analysis request failed.");
      if (!backtestRes.ok) throw new Error(backtestJson.detail ?? "Backtest request failed.");

      setAnalysis(analysisJson as AnalysisResult);
      setBacktest(backtestJson as BacktestResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">
        {/* Merged control panel */}
        <div className="bg-panel rounded-xl shadow-sm border border-divider overflow-hidden">
          <div className="px-5 py-4">
            <TickerInput
              ticker1={ticker1}
              ticker2={ticker2}
              loading={loading}
              onChange={(t1, t2) => {
                setTicker1(t1);
                setTicker2(t2);
              }}
              onSubmit={handleAnalyze}
            />
          </div>
          <div className="border-t border-divider px-5 py-4">
            <p className="label mb-3">Parameters</p>
            <ParameterControls params={params} onChange={setParams} />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Skeleton while loading */}
        {loading && (
          <div className="space-y-5 animate-pulse">
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-5">
              <div className="bg-panel rounded-xl border border-divider h-64" />
              <div className="bg-panel rounded-xl border border-divider h-64" />
            </div>
            <div className="bg-panel rounded-xl border border-divider h-72" />
          </div>
        )}

        {/* Empty state */}
        {!analysis && !loading && !error && (
          <div className="rounded-xl border border-dashed border-divider py-14 px-8 text-center">
            <p className="text-sm font-medium text-subtle mb-1">Select a pair to begin</p>
            <p className="text-xs text-muted mb-6 max-w-sm mx-auto">
              Tests for cointegration, then simulates a z-score mean-reversion strategy over your
              chosen window.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {PRESET_PAIRS.map(([a, b]) => (
                <button
                  key={`${a}-${b}`}
                  onClick={() => {
                    setTicker1(a);
                    setTicker2(b);
                  }}
                  className="px-3 py-1.5 text-xs font-mono bg-surface border border-divider rounded-md hover:border-primary hover:text-primary transition-colors"
                >
                  {a} / {b}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {analysis && backtest && (
          <div className="space-y-5">
            {/* Cointegration + Spread side by side on lg */}
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-5">
              <Card title="Cointegration Tests">
                <CointegrationPanel data={analysis} ticker1={ticker1} ticker2={ticker2} />
              </Card>
              <Card title="Spread & Z-Score">
                <SpreadChart
                  data={analysis}
                  entryZ={params.entry_z}
                  exitZ={params.exit_z}
                  stopZ={params.stop_z}
                  insampleEndDate={backtest?.insample_end_date}
                  ticker1={ticker1}
                  ticker2={ticker2}
                />
              </Card>
            </div>

            {/* Backtest */}
            <Card title="Backtest Performance">
              <div className="space-y-5">
                <ResultsPanel metrics={backtest.metrics} />
                <div>
                  <p className="text-xs font-medium text-muted mb-2">
                    Equity Curve (starts at $100)
                  </p>
                  <EquityCurve data={backtest} insampleEndDate={backtest.insample_end_date} />
                </div>
              </div>
            </Card>

            {/* Trade log */}
            {backtest.trades.length > 0 && (
              <Card title={`Trade Log — ${backtest.trades.length} entries`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-faint border-b border-divider">
                        <th className="pb-2 pr-4 font-medium">Entry Date</th>
                        <th className="pb-2 pr-4 font-medium">Direction</th>
                        <th className="pb-2 pr-4 font-medium">Entry Z</th>
                        <th className="pb-2 pr-4 font-medium">Exit Date</th>
                        <th className="pb-2 pr-4 font-medium">Exit Z</th>
                        <th className="pb-2 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtest.trades.map((t, i) => {
                        const duration = t.exit_date
                          ? Math.round(
                              (new Date(t.exit_date).getTime() - new Date(t.date).getTime()) /
                                86400000
                            )
                          : null;
                        return (
                          <tr key={i} className="border-t border-divider">
                            <td className="py-1.5 pr-4 font-mono text-muted">{t.date}</td>
                            <td className="py-1.5 pr-4">
                              <span
                                className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                                  t.type === "long"
                                    ? "bg-green-500/15 text-green-400"
                                    : "bg-red-500/15 text-red-400"
                                }`}
                              >
                                {t.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-1.5 pr-4 font-mono text-muted">{t.entry_z}</td>
                            <td className="py-1.5 pr-4 font-mono text-muted">
                              {t.exit_date ?? "—"}
                            </td>
                            <td className="py-1.5 pr-4 font-mono">
                              {t.exit_z !== undefined ? (
                                <span className={t.stop_triggered ? "text-amber-400" : "text-muted"}>
                                  {t.exit_z}
                                  {t.stop_triggered && (
                                    <span className="ml-1 text-xs font-semibold">STOP</span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="py-1.5 font-mono text-muted">
                              {duration !== null ? `${duration}d` : "open"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
