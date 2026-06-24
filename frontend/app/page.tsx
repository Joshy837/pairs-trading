"use client";

import { useState } from "react";
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
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel rounded-xl shadow-sm border border-divider p-5">
      <h2 className="text-sm font-semibold text-subtle mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function Page() {
  const [ticker1, setTicker1] = useState("KO");
  const [ticker2, setTicker2] = useState("PEP");
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

      // Parse both responses; surface the first error found
      const [analysisJson, backtestJson] = await Promise.all([
        analysisRes.json(),
        backtestRes.json(),
      ]);

      if (!analysisRes.ok) {
        throw new Error(analysisJson.detail ?? "Analysis request failed.");
      }
      if (!backtestRes.ok) {
        throw new Error(backtestJson.detail ?? "Backtest request failed.");
      }

      setAnalysis(analysisJson as AnalysisResult);
      setBacktest(backtestJson as BacktestResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pairs Trading Dashboard</h1>
        <p className="text-sm text-muted mt-1">
          Statistical arbitrage backtester — cointegration tests, spread analysis, and equity simulation
        </p>
      </div>

      {/* Input + Parameters */}
      <Card title="Ticker Pair">
        <div className="space-y-5">
          <TickerInput
            ticker1={ticker1}
            ticker2={ticker2}
            loading={loading}
            onChange={(t1, t2) => { setTicker1(t1); setTicker2(t2); }}
            onSubmit={handleAnalyze}
          />
        </div>
      </Card>

      <Card title="Parameters">
        <ParameterControls params={params} onChange={setParams} />
      </Card>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-panel rounded-xl shadow-sm border border-divider p-8 text-center text-sm text-faint animate-pulse">
          Fetching data and running tests…
        </div>
      )}

      {/* Results — shown once both API calls complete */}
      {analysis && backtest && (
        <div className="space-y-6">
          <Card title={`Cointegration — ${ticker1} / ${ticker2}`}>
            <CointegrationPanel data={analysis} ticker1={ticker1} ticker2={ticker2} />
          </Card>

          <Card title="Spread & Z-Score">
            <SpreadChart
              data={analysis}
              entryZ={params.entry_z}
              exitZ={params.exit_z}
              ticker1={ticker1}
              ticker2={ticker2}
            />
          </Card>

          <Card title="Backtest Performance">
            <div className="space-y-5">
              <ResultsPanel metrics={backtest.metrics} />
              <div>
                <p className="text-xs font-medium text-muted mb-2">Equity Curve (starts at $100)</p>
                <EquityCurve data={backtest} />
              </div>
            </div>
          </Card>

          {backtest.trades.length > 0 && (
            <Card title={`Trade Log (${backtest.trades.length} entries)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-faint border-b border-divider">
                      <th className="pb-2 pr-4 font-medium">Entry Date</th>
                      <th className="pb-2 pr-4 font-medium">Direction</th>
                      <th className="pb-2 pr-4 font-medium">Entry Z</th>
                      <th className="pb-2 pr-4 font-medium">Exit Date</th>
                      <th className="pb-2 font-medium">Exit Z</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtest.trades.map((t, i) => (
                      <tr key={i} className="border-t border-divider">
                        <td className="py-1.5 pr-4 font-mono">{t.date}</td>
                        <td className="py-1.5 pr-4">
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                              t.type === "long"
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {t.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 font-mono">{t.entry_z}</td>
                        <td className="py-1.5 pr-4 font-mono text-muted">
                          {t.exit_date ?? "—"}
                        </td>
                        <td className="py-1.5 font-mono text-muted">
                          {t.exit_z ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
