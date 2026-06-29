"use client";

import Link from "next/link";
import { useState } from "react";
import EquityCurve from "@/components/EquityCurve";
import ParameterControls from "@/components/ParameterControls";
import ScanProgress from "@/components/ScanProgress";
import { LogEntry, Parameters, PortfolioResult, UniversePairResult } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const UNIVERSES = [
  { key: "djia", label: "Dow Jones 30", count: 30 },
  { key: "sp100", label: "S&P 100", count: 100 },
  { key: "nasdaq100", label: "NASDAQ 100", count: 100 },
  { key: "sp500", label: "S&P 500", count: "~420" },
] as const;

type UniverseKey = (typeof UNIVERSES)[number]["key"];

const DEFAULT_PARAMS: Parameters = {
  lookback_days: 365,
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
  max_holding_days: 60,
  halflife_multiplier: 2.0,
};

function pairKey(t1: string, t2: string) {
  return `${t1}:${t2}`;
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel rounded-xl shadow-sm border border-divider p-5">
      {title && <h2 className="text-sm font-semibold text-subtle mb-4">{title}</h2>}
      {children}
    </div>
  );
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface rounded-lg p-4 border border-divider">
      <p className="label mb-1">{label}</p>
      <p className="text-xl font-semibold font-mono text-subtle">{value}</p>
      {sub && <p className="text-xs text-faint mt-0.5">{sub}</p>}
    </div>
  );
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return (n * 100).toFixed(1) + "%";
}

function SharpeCell({ v }: { v: number }) {
  const cls = v >= 1.5 ? "text-green-400" : v >= 0.5 ? "text-subtle" : "text-red-400";
  return <span className={cls}>{v.toFixed(2)}</span>;
}

function ReturnCell({ v }: { v: number }) {
  return <span className={v >= 0 ? "text-green-400" : "text-red-400"}>{fmtPct(v)}</span>;
}

export default function UniversePage() {
  const [universe, setUniverse] = useState<UniverseKey>("sp100");
  const [topN, setTopN] = useState(50);
  const [corrThreshold, setCorrThreshold] = useState(0.5);
  const [params, setParams] = useState<Parameters>(DEFAULT_PARAMS);

  // Scan state
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<UniversePairResult[] | null>(null);
  const [resultMeta, setResultMeta] = useState<{ label: string; total: number } | null>(null);

  // Table sort
  const [sortKey, setSortKey] = useState<keyof UniversePairResult>("sharpe_ratio");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Portfolio sim state
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set());
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [portfolioResult, setPortfolioResult] = useState<PortfolioResult | null>(null);

  function addLog(entry: LogEntry) {
    setLogEntries((prev) => [...prev, entry]);
  }

  function toggleSort(key: keyof UniversePairResult) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function togglePair(key: string) {
    setSelectedPairs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setPortfolioResult(null);
  }

  function selectAll() {
    if (!results) return;
    setSelectedPairs(new Set(results.map((p) => pairKey(p.ticker1, p.ticker2))));
    setPortfolioResult(null);
  }

  function clearSelection() {
    setSelectedPairs(new Set());
    setPortfolioResult(null);
  }

  const sorted = results
    ? [...results].sort((a, b) => {
        const av = (a[sortKey] as number) ?? -Infinity;
        const bv = (b[sortKey] as number) ?? -Infinity;
        return sortDir === "desc" ? bv - av : av - bv;
      })
    : [];

  function buildBody() {
    return {
      universe,
      top_n: topN,
      corr_threshold: corrThreshold,
      lookback_days: params.lookback_days,
      zscore_window: params.zscore_window,
      entry_z: params.entry_z,
      exit_z: params.exit_z,
      stop_z: params.stop_z,
      transaction_cost_bps: params.transaction_cost_bps,
      insample_pct: params.insample_pct / 100,
      use_kalman: params.use_kalman,
      use_regime: params.use_regime,
      use_log_prices: params.use_log_prices,
      use_vol_target: params.use_vol_target,
      max_holding_days: params.max_hold_mode === "custom" ? params.max_holding_days : null,
      use_halflife_hold: params.max_hold_mode === "auto",
      halflife_multiplier: params.halflife_multiplier,
    };
  }

  async function handleScan() {
    setScanError(null);
    setResults(null);
    setResultMeta(null);
    setLogEntries([]);
    setSelectedPairs(new Set());
    setPortfolioResult(null);
    setScanLoading(true);

    try {
      const res = await fetch(`${API}/api/universe/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { detail?: string }).detail ?? "Scan failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
              addLog({ kind: "info", text: `Downloading prices for ${event.label} (${event.count} tickers)…` });
              break;
            case "fetch_done":
              addLog({ kind: "info", text: `${event.loaded} tickers loaded` });
              break;
            case "correlation_done":
              addLog({ kind: "header", text: `Correlation filter  ρ ≥ ${corrThreshold.toFixed(2)}` });
              addLog({ kind: "summary", text: `${event.passed} / ${event.total_pairs} pairs passed` });
              if (event.passed > 0) addLog({ kind: "header", text: `Cointegration  (ADF · ${event.passed} pairs)` });
              break;
            case "coint_progress":
              addLog({ kind: "info", text: `  ADF tested ${event.done} / ${event.total} pairs…` });
              break;
            case "coint_done":
              addLog({ kind: "summary", text: `${event.cointegrated} cointegrated pairs found` });
              break;
            case "bh_correction":
              addLog({ kind: "info", text: "Benjamini-Hochberg correction applied" });
              addLog({ kind: "summary", text: `${event.significant} pairs pass BH threshold — running backtests…` });
              if (event.significant > 0) addLog({ kind: "header", text: `Backtesting  (${event.significant} pairs)` });
              break;
            case "backtest_progress":
              addLog({ kind: "info", text: `  Backtested ${event.done} / ${event.total} pairs…` });
              break;
            case "complete": {
              const n = (event.pairs as UniversePairResult[]).length;
              addLog({ kind: "summary", text: `Done — showing top ${n} of ${event.total_backtested} backtested pairs` });
              setResults(event.pairs as UniversePairResult[]);
              setResultMeta({ label: event.label as string, total: event.total_backtested as number });
              break;
            }
            case "error":
              throw new Error(event.message as string);
          }
        }
      }
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setScanLoading(false);
    }
  }

  async function handlePortfolioRun() {
    if (selectedPairs.size < 2 || !results) return;
    setPortfolioError(null);
    setPortfolioResult(null);
    setPortfolioLoading(true);

    const pairs = results
      .filter((p) => selectedPairs.has(pairKey(p.ticker1, p.ticker2)))
      .map((p) => ({ ticker1: p.ticker1, ticker2: p.ticker2 }));

    try {
      const res = await fetch(`${API}/api/portfolio/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs, ...buildBody() }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error((json as { detail?: string }).detail ?? "Portfolio backtest failed.");
      setPortfolioResult(json as PortfolioResult);
    } catch (err: unknown) {
      setPortfolioError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setPortfolioLoading(false);
    }
  }

  function SortHeader({ col, label }: { col: keyof UniversePairResult; label: string }) {
    const active = sortKey === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        className={`px-3 py-2 text-xs font-medium uppercase tracking-wide cursor-pointer select-none transition-colors text-right ${
          active ? "text-primary" : "text-muted hover:text-subtle"
        }`}
      >
        {label}
        {active && <span className="ml-1 text-primary">{sortDir === "desc" ? "↓" : "↑"}</span>}
      </th>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">

        {/* Universe selector */}
        <Card title="Universe Scanner">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <p className="label">Universe</p>
              <div className="flex flex-wrap gap-2">
                {UNIVERSES.map(({ key, label, count }) => (
                  <button
                    key={key}
                    onClick={() => setUniverse(key)}
                    disabled={scanLoading}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      universe === key
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-surface border-divider text-muted hover:border-primary/40 hover:text-subtle"
                    }`}
                  >
                    {label}
                    <span className="ml-1.5 text-faint font-mono">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-6 pt-1 border-t border-divider">
              <div className="space-y-1">
                <p className="label">Top N Results</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min={5} max={200} step={5} value={topN}
                    onChange={(e) => setTopN(Number(e.target.value))}
                    className="w-36 accent-primary"
                  />
                  <input
                    type="number" min={5} max={500} value={topN}
                    onChange={(e) => { const v = Math.max(5, Math.min(500, Number(e.target.value))); if (!isNaN(v)) setTopN(v); }}
                    className="w-14 text-right text-xs font-mono text-subtle bg-panel border border-transparent hover:border-divider focus:border-primary focus:outline-none rounded px-1 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <p className="label">Corr Threshold</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min={0} max={95} step={5}
                    value={Math.round(corrThreshold * 100)}
                    onChange={(e) => setCorrThreshold(Number(e.target.value) / 100)}
                    className="w-36 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted w-14">ρ ≥ {corrThreshold.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Backtest parameters */}
        <Card title="Backtest Parameters">
          <ParameterControls params={params} onChange={setParams} />
          <div className="mt-5 pt-4 border-t border-divider flex justify-end">
            <button
              onClick={handleScan}
              disabled={scanLoading}
              className="px-5 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-subtle text-sm font-medium rounded-md transition-colors"
            >
              {scanLoading ? "Running…" : "Run Universe Scan"}
            </button>
          </div>
        </Card>

        {/* Scan error */}
        {scanError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            {scanError}
          </div>
        )}

        {/* Progress log */}
        {logEntries.length > 0 && <ScanProgress entries={logEntries} scanning={scanLoading} />}

        {/* Empty state */}
        {!results && !scanLoading && logEntries.length === 0 && !scanError && (
          <div className="rounded-xl border border-dashed border-divider py-14 px-8 text-center">
            <p className="text-sm font-medium text-subtle mb-1">Select a universe and run</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              Scans all pairs for cointegration, backtests each surviving pair, and ranks by Sharpe.
              Select pairs from the results to run a portfolio simulation.
            </p>
          </div>
        )}

        {/* No results */}
        {results && results.length === 0 && (
          <div className="rounded-xl border border-dashed border-divider py-10 px-8 text-center">
            <p className="text-sm font-medium text-subtle mb-1">No pairs survived all filters</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              Lower the correlation threshold or use a larger lookback window.
            </p>
          </div>
        )}

        {/* Results table */}
        {results && results.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-subtle">
                  Top {results.length} pairs — {resultMeta?.label}
                </h2>
                <p className="text-xs text-muted mt-0.5">
                  {resultMeta?.total} pairs backtested · ranked by Sharpe · click headers to sort
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-faint">{selectedPairs.size} selected</span>
                <button
                  onClick={selectAll}
                  className="px-2.5 py-1 text-xs text-muted border border-divider rounded hover:text-subtle hover:border-primary/40 transition-colors"
                >
                  Select all
                </button>
                <button
                  onClick={clearSelection}
                  className="px-2.5 py-1 text-xs text-muted border border-divider rounded hover:text-subtle hover:border-primary/40 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-divider">
                    <th className="px-3 py-2 w-6" />
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide w-6">#</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide">Pair</th>
                    <SortHeader col="sharpe_ratio" label="Sharpe" />
                    <SortHeader col="total_return" label="Return" />
                    <SortHeader col="max_drawdown" label="Drawdown" />
                    <SortHeader col="num_trades" label="Trades" />
                    <SortHeader col="win_rate" label="Win %" />
                    <SortHeader col="profit_factor" label="PF" />
                    <SortHeader col="pvalue" label="p-val" />
                    <SortHeader col="half_life" label="HL (d)" />
                    <SortHeader col="correlation" label="ρ" />
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {sorted.map((pair, i) => {
                    const key = pairKey(pair.ticker1, pair.ticker2);
                    const checked = selectedPairs.has(key);
                    return (
                      <tr
                        key={key}
                        className={`transition-colors cursor-pointer ${checked ? "bg-primary/5" : "hover:bg-surface/60"}`}
                        onClick={() => togglePair(key)}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePair(key)}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-primary"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-faint">{i + 1}</td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-semibold text-subtle">{pair.ticker1}</span>
                          <span className="text-faint mx-1">/</span>
                          <span className="font-mono font-semibold text-subtle">{pair.ticker2}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono"><SharpeCell v={pair.sharpe_ratio} /></td>
                        <td className="px-3 py-2 text-right font-mono"><ReturnCell v={pair.total_return} /></td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{fmtPct(pair.max_drawdown)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.num_trades}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.win_rate != null ? fmtPct(pair.win_rate) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{fmt(pair.profit_factor)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.pvalue.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.half_life ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.correlation != null ? pair.correlation.toFixed(2) : "—"}</td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <Link
                            href={`/?t1=${pair.ticker1}&t2=${pair.ticker2}`}
                            className="px-2.5 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors whitespace-nowrap"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Portfolio sim trigger */}
            <div className="mt-4 pt-4 border-t border-divider flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {selectedPairs.size < 2
                  ? "Select at least 2 pairs to run a portfolio simulation"
                  : `${selectedPairs.size} pairs selected — equal-weight, independent`}
              </p>
              <button
                onClick={handlePortfolioRun}
                disabled={selectedPairs.size < 2 || portfolioLoading}
                className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-40 text-subtle text-xs font-medium rounded-md transition-colors"
              >
                {portfolioLoading ? "Simulating…" : "Run Portfolio Simulation"}
              </button>
            </div>
          </Card>
        )}

        {/* Portfolio error */}
        {portfolioError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            {portfolioError}
          </div>
        )}

        {/* Portfolio results */}
        {portfolioResult && (
          <div className="space-y-5">
            {/* Metric tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricTile
                label="Portfolio Sharpe"
                value={portfolioResult.portfolio_metrics.sharpe_ratio.toFixed(2)}
              />
              <MetricTile
                label="Total Return"
                value={fmtPct(portfolioResult.portfolio_metrics.total_return)}
              />
              <MetricTile
                label="Max Drawdown"
                value={fmtPct(portfolioResult.portfolio_metrics.max_drawdown)}
              />
              <MetricTile
                label="Total Trades"
                value={String(portfolioResult.portfolio_metrics.total_trades)}
                sub={`across ${portfolioResult.pairs.length} pairs`}
              />
            </div>

            {/* Equity curve */}
            <Card title="Portfolio Equity Curve">
              <EquityCurve
                data={{
                  dates: portfolioResult.dates,
                  equity_curve: portfolioResult.portfolio_equity,
                }}
              />
            </Card>

            {/* Per-pair breakdown */}
            <Card title="Per-Pair Breakdown">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-divider">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide">Pair</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Sharpe</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Return</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Drawdown</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Trades</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Win %</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">PF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {portfolioResult.pairs.map((p) => (
                      <tr key={pairKey(p.ticker1, p.ticker2)} className="hover:bg-surface/60 transition-colors">
                        <td className="px-3 py-2">
                          <span className="font-mono font-semibold text-subtle">{p.ticker1}</span>
                          <span className="text-faint mx-1">/</span>
                          <span className="font-mono font-semibold text-subtle">{p.ticker2}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono"><SharpeCell v={p.metrics.sharpe_ratio} /></td>
                        <td className="px-3 py-2 text-right font-mono"><ReturnCell v={p.metrics.total_return} /></td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{fmtPct(p.metrics.max_drawdown)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{p.metrics.num_trades}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{p.metrics.win_rate != null ? fmtPct(p.metrics.win_rate) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{fmt(p.metrics.profit_factor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

      </main>
    </div>
  );
}
