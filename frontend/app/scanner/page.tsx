"use client";

import Link from "next/link";
import { useState } from "react";
import EquityCurve from "@/components/EquityCurve";
import MultiTickerInput from "@/components/MultiTickerInput";
import ParameterControls from "@/components/ParameterControls";
import PairMatrix from "@/components/PairMatrix";
import PairTable from "@/components/PairTable";
import ScanProgress from "@/components/ScanProgress";
import { LogEntry, Parameters, PortfolioResult, ScanPairResult, ScanResponse, SizingMethod } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DEFAULT_TICKERS = ["KO", "PEP", "MCD", "YUM"];

const PRESET_GROUPS = [
  { label: "Consumer", tickers: ["KO", "PEP", "MCD", "YUM", "SBUX", "WMT", "COST", "PG", "CL", "KHC"] },
  { label: "Energy", tickers: ["XOM", "CVX", "COP", "PSX", "VLO", "MPC", "SLB", "HAL", "OXY", "EOG"] },
  { label: "Tech", tickers: ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA", "AMD", "INTC", "QCOM", "AVGO"] },
  { label: "Finance", tickers: ["JPM", "BAC", "GS", "MS", "WFC", "C", "BK", "USB", "PNC", "AXP"] },
  { label: "Health", tickers: ["JNJ", "PFE", "UNH", "ABT", "MRK", "LLY", "BMY", "ABBV", "CVS", "HUM"] },
  { label: "Industrials", tickers: ["BA", "CAT", "GE", "HON", "UPS", "FDX", "MMM", "RTX", "LMT", "NOC"] },
];

const DEFAULT_BT_PARAMS: Parameters = {
  lookback_days: 730,
  zscore_window: 30,
  entry_z: 2.0,
  exit_z: 0.5,
  stop_z: 4.0,
  transaction_cost_bps: 5,
  insample_pct: 70,
  use_kalman: false,
  use_regime: false,
  use_log_prices: false,
  use_vol_target: false,
  max_hold_mode: "off",
  max_holding_days: 30,
  halflife_multiplier: 2,
};

function pairKey(t1: string, t2: string): string {
  return [t1, t2].sort().join(":");
}

function Card({ children, step, title }: { children: React.ReactNode; step?: string; title?: string }) {
  return (
    <div className="bg-panel rounded-xl shadow-sm border border-divider p-5">
      {(step || title) && (
        <div className="flex items-center gap-2 mb-4">
          {step && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-semibold text-primary bg-primary/10 border border-primary/20">
              {step}
            </span>
          )}
          {title && <h2 className="text-sm font-semibold text-subtle">{title}</h2>}
        </div>
      )}
      {children}
    </div>
  );
}

function buildPortfolioBody(
  pairs: Array<{ ticker1: string; ticker2: string }>,
  params: Parameters,
  sizing: SizingMethod,
): string {
  const { max_hold_mode, max_holding_days, halflife_multiplier, ...rest } = params;
  return JSON.stringify({
    pairs: pairs.map((p) => ({ ticker1: p.ticker1, ticker2: p.ticker2 })),
    ...rest,
    insample_pct: rest.insample_pct / 100,
    max_holding_days: max_hold_mode === "custom" ? max_holding_days : null,
    use_halflife_hold: max_hold_mode === "auto",
    halflife_multiplier: max_hold_mode === "auto" ? halflife_multiplier : 2,
    sizing_method: sizing,
  });
}

export default function ScannerPage() {
  // Step 1: scan
  const [tickers, setTickers] = useState<string[]>(DEFAULT_TICKERS);
  const [lookbackDays, setLookbackDays] = useState(365);
  const [zscoreWindow, setZscoreWindow] = useState(30);
  const [corrThreshold, setCorrThreshold] = useState(0.5);
  const [sectorFilter, setSectorFilter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "table">("matrix");
  const [qualityFilter, setQualityFilter] = useState<"all" | "stable">("all");

  // Step 2: backtest
  const [btParams, setBtParams] = useState<Parameters>(DEFAULT_BT_PARAMS);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [btResult, setBtResult] = useState<PortfolioResult | null>(null);

  // Step 3: portfolio simulation
  const [sizingMethod, setSizingMethod] = useState<SizingMethod>("equal");
  const [ptLoading, setPtLoading] = useState(false);
  const [ptError, setPtError] = useState<string | null>(null);
  const [ptResult, setPtResult] = useState<PortfolioResult | null>(null);

  function addLog(entry: LogEntry) {
    setLogEntries((prev) => [...prev, entry]);
  }

  async function handleScan() {
    setError(null);
    setResult(null);
    setSelectedKey(null);
    setLogEntries([]);
    setLoading(true);
    setBtResult(null);
    setPtResult(null);

    try {
      const res = await fetch(`${API}/api/scan/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers,
          lookback_days: lookbackDays,
          zscore_window: zscoreWindow,
          corr_threshold: corrThreshold,
          sector_filter: sectorFilter,
        }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { detail?: string }).detail ?? "Scan failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let corrHeaderDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const event = JSON.parse(chunk.slice(6)) as Record<string, any>;

          switch (event.type) {
            case "fetching":
              addLog({ kind: "info", text: `Downloading prices for ${(event.tickers as string[]).join(", ")}…` });
              break;

            case "corr_result": {
              if (!corrHeaderDone) {
                addLog({ kind: "header", text: `Correlation filter  ρ ≥ ${corrThreshold.toFixed(2)}` });
                corrHeaderDone = true;
              }
              const t1 = event.ticker1 as string;
              const t2 = event.ticker2 as string;
              addLog({
                kind: event.passed ? "pass" : "fail",
                text: `${t1} / ${t2}`,
                detail: `ρ = ${(event.corr as number).toFixed(3)}${event.passed ? "" : "  filtered"}`,
              });
              break;
            }

            case "correlation_done":
              addLog({ kind: "summary", text: `${event.passed} / ${event.total} pairs passed` });
              if (event.passed > 0) {
                addLog({ kind: "header", text: `Cointegration  (ADF · ${event.passed} pairs)` });
              }
              break;

            case "coint_result": {
              const t1 = event.ticker1 as string;
              const t2 = event.ticker2 as string;
              const pv = event.pvalue as number | null;
              addLog({
                kind: event.is_cointegrated ? "pass" : "fail",
                text: `${t1} / ${t2}`,
                detail: pv !== null ? `p = ${pv.toFixed(4)}` : "error",
              });
              break;
            }

            case "bh_correction":
              addLog({ kind: "info", text: "Benjamini-Hochberg correction applied" });
              break;

            case "complete": {
              const sig = event.significant as number;
              addLog({ kind: "summary", text: `Done — ${sig} cointegrated pair${sig !== 1 ? "s" : ""} found` });
              setResult({ pairs: event.pairs, tickers: event.tickers, sectors: event.sectors });
              break;
            }

            case "error":
              throw new Error(event.message as string);
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function handleBacktest() {
    if (!result) return;
    const cointPairs = result.pairs.filter((p) => p.is_cointegrated);
    if (cointPairs.length < 2) return;

    setBtLoading(true);
    setBtError(null);
    setBtResult(null);
    setPtResult(null);

    try {
      const res = await fetch(`${API}/api/portfolio/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildPortfolioBody(cointPairs, btParams, "equal"),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { detail?: string }).detail ?? "Backtest failed.");
      setBtResult(json as PortfolioResult);
    } catch (err: unknown) {
      setBtError(err instanceof Error ? err.message : "Backtest failed.");
    } finally {
      setBtLoading(false);
    }
  }

  async function handlePortfolio() {
    if (!result) return;
    const cointPairs = result.pairs.filter((p) => p.is_cointegrated);
    if (cointPairs.length < 2) return;

    setPtLoading(true);
    setPtError(null);
    setPtResult(null);

    try {
      const res = await fetch(`${API}/api/portfolio/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildPortfolioBody(cointPairs, btParams, sizingMethod),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { detail?: string }).detail ?? "Portfolio simulation failed.");
      setPtResult(json as PortfolioResult);
    } catch (err: unknown) {
      setPtError(err instanceof Error ? err.message : "Portfolio simulation failed.");
    } finally {
      setPtLoading(false);
    }
  }

  const selectedPair: ScanPairResult | null =
    selectedKey && result
      ? (result.pairs.find((p) => pairKey(p.ticker1, p.ticker2) === selectedKey) ?? null)
      : null;

  const filteredPairs = result
    ? result.pairs.filter((p) => {
        if (qualityFilter === "stable") return p.is_stable === true;
        return true;
      })
    : [];

  const cointPairs = result ? result.pairs.filter((p) => p.is_cointegrated) : [];

  return (
    <div className="min-h-screen bg-surface">
      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">

        {/* Step 1: Scan */}
        <Card step="01" title="Scan Universe">
          <div className="space-y-4">
            <MultiTickerInput
              tickers={tickers}
              loading={loading}
              onChange={setTickers}
              onSubmit={handleScan}
            />

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-faint">Presets:</span>
              {PRESET_GROUPS.map(({ label, tickers: pts }) => (
                <button
                  key={label}
                  onClick={() => setTickers(pts)}
                  className="px-2.5 py-1 text-xs font-mono text-muted bg-surface border border-divider rounded-md hover:border-primary hover:text-primary transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-6 pt-1 border-t border-divider">
              <div className="space-y-1">
                <p className="label">Lookback</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={90}
                    max={1825}
                    step={30}
                    value={lookbackDays}
                    onChange={(e) => setLookbackDays(Number(e.target.value))}
                    className="w-36 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted w-14">{lookbackDays}d</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="label">Z-Score Window</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={10}
                    max={120}
                    step={5}
                    value={zscoreWindow}
                    onChange={(e) => setZscoreWindow(Number(e.target.value))}
                    className="w-36 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted w-14">{zscoreWindow}d</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="label">Corr Threshold</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={95}
                    step={5}
                    value={Math.round(corrThreshold * 100)}
                    onChange={(e) => setCorrThreshold(Number(e.target.value) / 100)}
                    className="w-36 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted w-14">ρ ≥ {corrThreshold.toFixed(2)}</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="label">Sector Filter</p>
                <button
                  onClick={() => setSectorFilter((v) => !v)}
                  className={`px-3 py-1 text-xs font-mono rounded-md border transition-colors ${
                    sectorFilter
                      ? "bg-primary/20 border-primary/40 text-primary"
                      : "bg-surface border-divider text-muted hover:border-primary/40 hover:text-subtle"
                  }`}
                >
                  {sectorFilter ? "Same sector only" : "All sectors"}
                </button>
              </div>
            </div>
          </div>
        </Card>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {logEntries.length > 0 && (
          <ScanProgress entries={logEntries} scanning={loading} />
        )}

        {!result && !loading && logEntries.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-divider py-14 px-8 text-center">
            <p className="text-sm font-medium text-subtle mb-1">Add tickers and scan</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              Tests all pair combinations for cointegration. Cointegrated pairs proceed to backtest and portfolio simulation.
            </p>
          </div>
        )}

        {result && !loading && (
          <div className="space-y-5">
            {selectedPair && (
              <div className="bg-panel rounded-xl border border-primary/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-mono font-semibold text-subtle">
                    {selectedPair.ticker1}
                    <span className="text-faint font-normal mx-1.5">/</span>
                    {selectedPair.ticker2}
                  </span>
                  <span
                    className={`text-xs font-mono px-2 py-0.5 rounded ${selectedPair.pvalue < 0.05 ? "bg-green-900/50 text-green-300" : "bg-amber-900/50 text-amber-300"}`}
                  >
                    p = {selectedPair.pvalue.toFixed(4)}
                  </span>
                  <span className="text-xs text-faint font-mono">
                    adj = {selectedPair.adjusted_pvalue.toFixed(4)}
                  </span>
                  <span
                    className={`text-xs font-mono px-2 py-0.5 rounded ${
                      selectedPair.is_stable === true
                        ? "bg-green-900/40 text-green-400"
                        : selectedPair.is_stable === false
                        ? "bg-red-900/40 text-red-400"
                        : "bg-panel text-faint border border-divider"
                    }`}
                  >
                    {selectedPair.is_stable === true
                      ? "Stable"
                      : selectedPair.is_stable === false
                      ? "Unstable"
                      : "Stability N/A"}
                  </span>
                  <span className="text-xs text-muted font-mono">
                    β = {selectedPair.hedge_ratio.toFixed(4)}
                  </span>
                  {selectedPair.correlation !== undefined && (
                    <span className="text-xs text-muted font-mono">
                      ρ = {selectedPair.correlation.toFixed(2)}
                    </span>
                  )}
                  {selectedPair.zscore !== null && (
                    <span className="text-xs text-muted font-mono">
                      z = {selectedPair.zscore.toFixed(3)}
                    </span>
                  )}
                  {selectedPair.half_life !== null && (
                    <span className="text-xs text-muted font-mono">
                      HL = {selectedPair.half_life}d
                    </span>
                  )}
                </div>
                <Link
                  href={`/?t1=${selectedPair.ticker1}&t2=${selectedPair.ticker2}`}
                  className="px-4 py-2 bg-primary text-subtle text-xs font-medium rounded-md hover:bg-primary-dark transition-colors whitespace-nowrap"
                >
                  Open in Backtester →
                </Link>
              </div>
            )}

            {result.pairs.length === 0 && (
              <div className="rounded-xl border border-dashed border-divider py-10 px-8 text-center">
                <p className="text-sm font-medium text-subtle mb-1">No pairs passed the correlation filter</p>
                <p className="text-xs text-muted max-w-sm mx-auto">
                  Lower the Corr Threshold (currently ρ ≥ {corrThreshold.toFixed(2)}) or add more tickers from the same sector.
                </p>
              </div>
            )}

            {result.pairs.length > 0 && (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-subtle">
                      {filteredPairs.length}
                      {filteredPairs.length !== result.pairs.length && `/${result.pairs.length}`} pairs
                      {" · "}
                      {filteredPairs.filter((p) => p.is_cointegrated).length} cointegrated
                    </h2>
                    <div className="flex gap-1">
                      {(
                        [
                          { key: "all", label: "All" },
                          { key: "stable", label: "Stable" },
                        ] as const
                      ).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setQualityFilter(key)}
                          className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
                            qualityFilter === key
                              ? "bg-primary/20 text-primary"
                              : "text-faint hover:text-muted"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1 bg-surface rounded-md p-0.5">
                    {(["matrix", "table"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                          view === v ? "bg-primary/20 text-primary" : "text-muted hover:text-subtle"
                        }`}
                      >
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {view === "matrix" ? (
                  <PairMatrix
                    tickers={result.tickers}
                    pairs={result.pairs}
                    filteredKeys={new Set(filteredPairs.map((p) => pairKey(p.ticker1, p.ticker2)))}
                    selectedKey={selectedKey}
                    onSelect={setSelectedKey}
                  />
                ) : (
                  <PairTable
                    pairs={filteredPairs}
                    selectedKey={selectedKey}
                    onSelect={setSelectedKey}
                  />
                )}
              </Card>
            )}
          </div>
        )}

        {/* Step 2: Backtest */}
        {result && !loading && cointPairs.length >= 2 && (
          <Card step="02" title="Backtest">
            <ParameterControls params={btParams} onChange={setBtParams} />

            <div className="mt-5 pt-4 border-t border-divider flex flex-wrap items-center gap-3">
              <button
                onClick={handleBacktest}
                disabled={btLoading}
                className="px-5 py-2 bg-primary text-subtle text-sm font-medium rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {btLoading ? "Running backtests…" : `Backtest ${cointPairs.length} pair${cointPairs.length !== 1 ? "s" : ""}`}
              </button>
              {btError && <p className="text-xs text-red-400">{btError}</p>}
            </div>

            {btResult && (
              <div className="mt-5 pt-4 border-t border-divider">
                <h3 className="section-heading mb-3">Per-Pair Results</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-divider">
                        <th className="text-left py-2 pr-4 text-faint font-medium">Pair</th>
                        <th className="text-right py-2 pr-4 text-faint font-medium">Sharpe</th>
                        <th className="text-right py-2 pr-4 text-faint font-medium">Return</th>
                        <th className="text-right py-2 pr-4 text-faint font-medium">Max DD</th>
                        <th className="text-right py-2 pr-4 text-faint font-medium">Trades</th>
                        <th className="text-right py-2 pr-4 text-faint font-medium">Win Rate</th>
                        <th className="text-right py-2 text-faint font-medium">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {btResult.pairs.map((p) => (
                        <tr
                          key={`${p.ticker1}:${p.ticker2}`}
                          className="border-b border-divider/40 hover:bg-surface/50 transition-colors"
                        >
                          <td className="py-2 pr-4 text-subtle">{p.ticker1} / {p.ticker2}</td>
                          <td className={`py-2 pr-4 text-right ${p.metrics.sharpe_ratio >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {p.metrics.sharpe_ratio.toFixed(2)}
                          </td>
                          <td className={`py-2 pr-4 text-right ${p.metrics.total_return >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {(p.metrics.total_return * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 pr-4 text-right text-red-400">
                            {(p.metrics.max_drawdown * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 pr-4 text-right text-muted">
                            {p.metrics.num_trades}
                          </td>
                          <td className="py-2 pr-4 text-right text-muted">
                            {p.metrics.win_rate !== null ? `${(p.metrics.win_rate * 100).toFixed(0)}%` : "—"}
                          </td>
                          <td className="py-2 text-right text-muted">
                            {(p.weight * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Step 3: Portfolio Simulation */}
        {btResult && (
          <Card step="03" title="Portfolio Simulation">
            <div className="flex flex-wrap items-center gap-4 mb-5">
              <div className="flex items-center gap-3">
                <span className="label">Sizing Method</span>
                <div className="flex items-center rounded-md border border-divider overflow-hidden">
                  {(
                    [
                      { key: "equal" as SizingMethod, label: "Equal" },
                      { key: "inverse_vol" as SizingMethod, label: "Inv. Vol" },
                      { key: "signal_strength" as SizingMethod, label: "Signal" },
                    ]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setSizingMethod(key)}
                      className={`px-3 py-1 text-xs font-medium transition-colors ${
                        sizingMethod === key
                          ? "bg-primary text-subtle"
                          : "bg-surface text-muted hover:text-subtle"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handlePortfolio}
                disabled={ptLoading}
                className="px-5 py-2 bg-primary text-subtle text-sm font-medium rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {ptLoading ? "Simulating…" : "Run Portfolio Simulation"}
              </button>
              {ptError && <p className="text-xs text-red-400">{ptError}</p>}
            </div>

            {ptResult && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                  {[
                    {
                      label: "Portfolio Sharpe",
                      value: ptResult.portfolio_metrics.sharpe_ratio.toFixed(2),
                      color: ptResult.portfolio_metrics.sharpe_ratio >= 0 ? "text-green-400" : "text-red-400",
                    },
                    {
                      label: "Total Return",
                      value: `${(ptResult.portfolio_metrics.total_return * 100).toFixed(1)}%`,
                      color: ptResult.portfolio_metrics.total_return >= 0 ? "text-green-400" : "text-red-400",
                    },
                    {
                      label: "Max Drawdown",
                      value: `${(ptResult.portfolio_metrics.max_drawdown * 100).toFixed(1)}%`,
                      color: "text-red-400",
                    },
                    {
                      label: "Total Trades",
                      value: String(ptResult.portfolio_metrics.total_trades),
                      color: "text-subtle",
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-surface rounded-lg p-3">
                      <p className="label mb-1">{label}</p>
                      <p className={`text-lg font-mono font-semibold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                <EquityCurve
                  data={{
                    dates: ptResult.dates,
                    equity_curve: ptResult.portfolio_equity,
                    benchmark: null,
                  }}
                />

                <div className="mt-5 pt-4 border-t border-divider">
                  <h3 className="section-heading mb-3">Weight Allocation</h3>
                  <div className="flex flex-wrap gap-2">
                    {ptResult.pairs.map((p) => (
                      <div
                        key={`${p.ticker1}:${p.ticker2}`}
                        className="flex items-center gap-2 bg-surface rounded-md px-3 py-1.5"
                      >
                        <span className="text-xs font-mono text-subtle">{p.ticker1}/{p.ticker2}</span>
                        <span className="text-xs font-mono text-muted">{(p.weight * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
