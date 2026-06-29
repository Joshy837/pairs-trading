"use client";

import Link from "next/link";
import { useState } from "react";
import EquityCurve from "@/components/EquityCurve";
import ParameterControls from "@/components/ParameterControls";
import ScanProgress from "@/components/ScanProgress";
import { LogEntry, Parameters, PortfolioPairBreakdown, PortfolioResult, ScanPairResult, SizingMethod } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const UNIVERSES = [
  { key: "djia",     label: "Dow Jones 30",  count: 30 },
  { key: "sp100",    label: "S&P 100",       count: 100 },
  { key: "nasdaq100",label: "NASDAQ 100",    count: 100 },
  { key: "sp500",    label: "S&P 500",       count: "~420" },
] as const;

type UniverseKey = (typeof UNIVERSES)[number]["key"];

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
  max_holding_days: 60,
  halflife_multiplier: 2.0,
};

function pairKey(t1: string, t2: string) {
  return `${t1}:${t2}`;
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

function MetricTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-surface rounded-lg p-4 border border-divider">
      <p className="label mb-1">{label}</p>
      <p className={`text-xl font-semibold font-mono ${color ?? "text-subtle"}`}>{value}</p>
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

function buildBtBody(
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

export default function UniversePage() {
  // Step 01: scan
  const [universe, setUniverse] = useState<UniverseKey>("sp100");
  const [topN, setTopN] = useState(50);
  const [corrThreshold, setCorrThreshold] = useState(0.5);
  const [scanLookback, setScanLookback] = useState(365);
  const [scanZWindow, setScanZWindow] = useState(30);

  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [scanResults, setScanResults] = useState<ScanPairResult[] | null>(null);
  const [scanMeta, setScanMeta] = useState<{ label: string } | null>(null);

  // Pair selection (feeds into step 02 + 03)
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set());

  // Scan table sort
  const [sortKey, setSortKey] = useState<keyof ScanPairResult>("pvalue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Step 02: backtest
  const [btParams, setBtParams] = useState<Parameters>(DEFAULT_BT_PARAMS);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [btResult, setBtResult] = useState<PortfolioResult | null>(null);

  // Step 03: portfolio simulation
  const [sizingMethod, setSizingMethod] = useState<SizingMethod>("equal");
  const [ptLoading, setPtLoading] = useState(false);
  const [ptError, setPtError] = useState<string | null>(null);
  const [ptResult, setPtResult] = useState<PortfolioResult | null>(null);

  function addLog(entry: LogEntry) {
    setLogEntries((prev) => [...prev, entry]);
  }

  function toggleSort(key: keyof ScanPairResult) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function togglePair(key: string) {
    setSelectedPairs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setBtResult(null);
    setPtResult(null);
  }

  function selectAll() {
    if (!scanResults) return;
    setSelectedPairs(new Set(scanResults.map((p) => pairKey(p.ticker1, p.ticker2))));
    setBtResult(null);
    setPtResult(null);
  }

  function clearSelection() {
    setSelectedPairs(new Set());
    setBtResult(null);
    setPtResult(null);
  }

  const sortedScanResults = scanResults
    ? [...scanResults].sort((a, b) => {
        const av = (a[sortKey] as number) ?? (sortDir === "asc" ? Infinity : -Infinity);
        const bv = (b[sortKey] as number) ?? (sortDir === "asc" ? Infinity : -Infinity);
        return sortDir === "asc" ? av - bv : bv - av;
      })
    : [];

  async function handleScan() {
    setScanError(null);
    setScanResults(null);
    setScanMeta(null);
    setLogEntries([]);
    setSelectedPairs(new Set());
    setBtResult(null);
    setPtResult(null);
    setScanLoading(true);

    try {
      const res = await fetch(`${API}/api/universe/scan/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe,
          top_n: topN,
          corr_threshold: corrThreshold,
          lookback_days: scanLookback,
          zscore_window: scanZWindow,
        }),
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
              addLog({ kind: "summary", text: `${event.significant} pairs pass BH threshold` });
              break;
            case "complete": {
              const pairs = event.pairs as ScanPairResult[];
              addLog({ kind: "summary", text: `Done — ${pairs.length} pair${pairs.length !== 1 ? "s" : ""} found` });
              setScanResults(pairs);
              setScanMeta({ label: event.label as string });
              setSelectedPairs(new Set(pairs.map((p) => pairKey(p.ticker1, p.ticker2))));
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

  async function handleBacktest() {
    if (!scanResults || selectedPairs.size < 2) return;
    const pairs = scanResults.filter((p) => selectedPairs.has(pairKey(p.ticker1, p.ticker2)));

    setBtLoading(true);
    setBtError(null);
    setBtResult(null);
    setPtResult(null);

    try {
      const res = await fetch(`${API}/api/portfolio/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildBtBody(pairs, btParams, "equal"),
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
    if (!scanResults || selectedPairs.size < 2) return;
    const pairs = scanResults.filter((p) => selectedPairs.has(pairKey(p.ticker1, p.ticker2)));

    setPtLoading(true);
    setPtError(null);
    setPtResult(null);

    try {
      const res = await fetch(`${API}/api/portfolio/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildBtBody(pairs, btParams, sizingMethod),
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

  function SortHeader({ col, label }: { col: keyof ScanPairResult; label: string }) {
    const active = sortKey === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        className={`px-3 py-2 text-xs font-medium uppercase tracking-wide cursor-pointer select-none transition-colors text-right ${
          active ? "text-primary" : "text-muted hover:text-subtle"
        }`}
      >
        {label}
        {active && <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </th>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">

        {/* Step 01: Scan */}
        <Card step="01" title="Scan Universe">
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
              <div className="space-y-1">
                <p className="label">Lookback</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min={90} max={1825} step={30}
                    value={scanLookback}
                    onChange={(e) => setScanLookback(Number(e.target.value))}
                    className="w-36 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted w-14">{scanLookback}d</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="label">Z-Score Window</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min={10} max={120} step={5}
                    value={scanZWindow}
                    onChange={(e) => setScanZWindow(Number(e.target.value))}
                    className="w-36 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted w-14">{scanZWindow}d</span>
                </div>
              </div>
            </div>

            <div className="pt-1 border-t border-divider">
              <button
                onClick={handleScan}
                disabled={scanLoading}
                className="px-5 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-subtle text-sm font-medium rounded-md transition-colors"
              >
                {scanLoading ? "Scanning…" : "Scan Universe"}
              </button>
            </div>
          </div>
        </Card>

        {scanError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            {scanError}
          </div>
        )}

        {logEntries.length > 0 && <ScanProgress entries={logEntries} scanning={scanLoading} />}

        {!scanResults && !scanLoading && logEntries.length === 0 && !scanError && (
          <div className="rounded-xl border border-dashed border-divider py-14 px-8 text-center">
            <p className="text-sm font-medium text-subtle mb-1">Select a universe and scan</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              Finds all cointegrated pairs in the universe. Select pairs to proceed to backtest.
            </p>
          </div>
        )}

        {/* Scan results table */}
        {scanResults && scanResults.length === 0 && (
          <div className="rounded-xl border border-dashed border-divider py-10 px-8 text-center">
            <p className="text-sm font-medium text-subtle mb-1">No cointegrated pairs found</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              Lower the correlation threshold or use a longer lookback window.
            </p>
          </div>
        )}

        {scanResults && scanResults.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-subtle">
                  {scanResults.length} cointegrated pair{scanResults.length !== 1 ? "s" : ""} — {scanMeta?.label}
                </h2>
                <p className="text-xs text-muted mt-0.5">ranked by p-value · click headers to sort · select pairs for backtest</p>
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
                    <SortHeader col="pvalue" label="p-val" />
                    <SortHeader col="adjusted_pvalue" label="adj p-val" />
                    <SortHeader col="half_life" label="HL (d)" />
                    <SortHeader col="correlation" label="ρ" />
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">β</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Stable</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {sortedScanResults.map((pair, i) => {
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
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.pvalue.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.adjusted_pvalue.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.half_life != null ? fmt(pair.half_life, 1) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.correlation != null ? pair.correlation.toFixed(2) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted">{pair.hedge_ratio.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-mono ${
                            pair.is_stable === true ? "text-green-400" :
                            pair.is_stable === false ? "text-red-400" :
                            "text-faint"
                          }`}>
                            {pair.is_stable === true ? "Yes" : pair.is_stable === false ? "No" : "—"}
                          </span>
                        </td>
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
          </Card>
        )}

        {/* Step 02: Backtest */}
        {scanResults && scanResults.length > 0 && (
          <Card step="02" title="Backtest">
            <ParameterControls params={btParams} onChange={setBtParams} />

            <div className="mt-5 pt-4 border-t border-divider flex flex-wrap items-center gap-3">
              <button
                onClick={handleBacktest}
                disabled={btLoading || selectedPairs.size < 2}
                className="px-5 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-subtle text-sm font-medium rounded-md transition-colors"
              >
                {btLoading ? "Running backtests…" : `Backtest ${selectedPairs.size} pair${selectedPairs.size !== 1 ? "s" : ""}`}
              </button>
              {selectedPairs.size < 2 && (
                <p className="text-xs text-faint">Select at least 2 pairs above</p>
              )}
              {btError && <p className="text-xs text-red-400">{btError}</p>}
            </div>

            {btResult && (
              <div className="mt-5 pt-4 border-t border-divider">
                <h3 className="section-heading mb-3">Per-Pair Results</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-divider">
                        <th className="px-3 py-2 text-left text-faint font-medium">Pair</th>
                        <th className="px-3 py-2 text-right text-faint font-medium">Sharpe</th>
                        <th className="px-3 py-2 text-right text-faint font-medium">Return</th>
                        <th className="px-3 py-2 text-right text-faint font-medium">Max DD</th>
                        <th className="px-3 py-2 text-right text-faint font-medium">Trades</th>
                        <th className="px-3 py-2 text-right text-faint font-medium">Win %</th>
                        <th className="px-3 py-2 text-right text-faint font-medium">PF</th>
                        <th className="px-3 py-2 text-right text-faint font-medium">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {btResult.pairs.map((p: PortfolioPairBreakdown) => (
                        <tr key={`${p.ticker1}:${p.ticker2}`} className="border-b border-divider/40 hover:bg-surface/50 transition-colors">
                          <td className="px-3 py-2 text-subtle">{p.ticker1} / {p.ticker2}</td>
                          <td className={`px-3 py-2 text-right ${p.metrics.sharpe_ratio >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {p.metrics.sharpe_ratio.toFixed(2)}
                          </td>
                          <td className={`px-3 py-2 text-right ${p.metrics.total_return >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {fmtPct(p.metrics.total_return)}
                          </td>
                          <td className="px-3 py-2 text-right text-red-400">{fmtPct(p.metrics.max_drawdown)}</td>
                          <td className="px-3 py-2 text-right text-muted">{p.metrics.num_trades}</td>
                          <td className="px-3 py-2 text-right text-muted">{p.metrics.win_rate != null ? fmtPct(p.metrics.win_rate) : "—"}</td>
                          <td className="px-3 py-2 text-right text-muted">{fmt(p.metrics.profit_factor)}</td>
                          <td className="px-3 py-2 text-right text-muted">{(p.weight * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Step 03: Portfolio Simulation */}
        {btResult && (
          <Card step="03" title="Portfolio Simulation">
            <div className="flex flex-wrap items-center gap-4 mb-5">
              <div className="flex items-center gap-3">
                <span className="label">Sizing Method</span>
                <div className="flex items-center rounded-md border border-divider overflow-hidden">
                  {(
                    [
                      { key: "equal" as SizingMethod, label: "Equal Weight" },
                      { key: "inverse_vol" as SizingMethod, label: "Inverse Vol" },
                      { key: "signal_strength" as SizingMethod, label: "Signal Strength" },
                    ]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => { setSizingMethod(key); setPtResult(null); }}
                      className={`px-3 py-1 text-xs font-medium transition-colors border-r border-divider last:border-r-0 ${
                        sizingMethod === key
                          ? "bg-primary/20 text-primary"
                          : "text-muted hover:text-subtle hover:bg-surface/60"
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
                className="px-5 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-subtle text-sm font-medium rounded-md transition-colors"
              >
                {ptLoading ? "Simulating…" : "Run Portfolio Simulation"}
              </button>
              {ptError && <p className="text-xs text-red-400">{ptError}</p>}
            </div>

            {ptResult && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  <MetricTile
                    label="Portfolio Sharpe"
                    value={ptResult.portfolio_metrics.sharpe_ratio.toFixed(2)}
                    color={ptResult.portfolio_metrics.sharpe_ratio >= 0 ? "text-green-400" : "text-red-400"}
                  />
                  <MetricTile
                    label="Total Return"
                    value={fmtPct(ptResult.portfolio_metrics.total_return)}
                    color={ptResult.portfolio_metrics.total_return >= 0 ? "text-green-400" : "text-red-400"}
                  />
                  <MetricTile
                    label="Max Drawdown"
                    value={fmtPct(ptResult.portfolio_metrics.max_drawdown)}
                    color="text-red-400"
                  />
                  <MetricTile
                    label="Total Trades"
                    value={String(ptResult.portfolio_metrics.total_trades)}
                    sub={`across ${ptResult.pairs.length} pairs`}
                  />
                </div>

                <Card title="Portfolio Equity Curve">
                  <EquityCurve
                    data={{
                      dates: ptResult.dates,
                      equity_curve: ptResult.portfolio_equity,
                    }}
                  />
                </Card>

                <div className="mt-5">
                  <Card title="Per-Pair Breakdown">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-divider">
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide">Pair</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Weight</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Sharpe</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Return</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Drawdown</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Trades</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">Win %</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase tracking-wide">PF</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-divider">
                          {ptResult.pairs.map((p: PortfolioPairBreakdown) => (
                            <tr key={`${p.ticker1}:${p.ticker2}`} className="hover:bg-surface/60 transition-colors">
                              <td className="px-3 py-2">
                                <span className="font-mono font-semibold text-subtle">{p.ticker1}</span>
                                <span className="text-faint mx-1">/</span>
                                <span className="font-mono font-semibold text-subtle">{p.ticker2}</span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-muted">{(p.weight * 100).toFixed(1)}%</td>
                              <td className={`px-3 py-2 text-right font-mono ${p.metrics.sharpe_ratio >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {p.metrics.sharpe_ratio.toFixed(2)}
                              </td>
                              <td className={`px-3 py-2 text-right font-mono ${p.metrics.total_return >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {fmtPct(p.metrics.total_return)}
                              </td>
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
              </>
            )}
          </Card>
        )}

      </main>
    </div>
  );
}
