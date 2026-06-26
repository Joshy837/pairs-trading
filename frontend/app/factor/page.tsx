"use client";

import { useState } from "react";
import ResidualStockChart from "@/components/ResidualStockChart";
import ScanProgress from "@/components/ScanProgress";
import Select from "@/components/Select";
import { FactorLoadings, FactorStockResult, LogEntry } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SECTOR_ETFS = [
  { value: "XLK", label: "XLK — Technology" },
  { value: "XLF", label: "XLF — Financials" },
  { value: "XLE", label: "XLE — Energy" },
  { value: "XLV", label: "XLV — Health Care" },
  { value: "XLI", label: "XLI — Industrials" },
  { value: "XLP", label: "XLP — Consumer Staples" },
  { value: "XLU", label: "XLU — Utilities" },
  { value: "XLY", label: "XLY — Consumer Disc." },
  { value: "XLB", label: "XLB — Materials" },
  { value: "XLRE", label: "XLRE — Real Estate" },
  { value: "XLC", label: "XLC — Communication" },
] as const;

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel rounded-xl shadow-sm border border-divider p-5">
      {title && <h2 className="text-sm font-semibold text-subtle mb-4">{title}</h2>}
      {children}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-surface rounded-lg p-3 border border-divider">
      <div className="label mb-1">{label}</div>
      <div className="text-lg font-semibold font-mono text-subtle leading-tight">{value}</div>
      {sub && <div className="text-xs text-faint mt-0.5">{sub}</div>}
    </div>
  );
}

function coef(n: number, decimals: number): string {
  const abs = Math.abs(n).toFixed(decimals);
  return n < 0 ? `− ${abs}` : `+ ${abs}`;
}

function RegressionCard({
  ticker,
  loadings,
  sectorEtf,
}: {
  ticker: string;
  loadings: FactorLoadings;
  sectorEtf: string;
}) {
  const r2Pct = (loadings.r_squared * 100).toFixed(1);
  const alphaStr =
    loadings.alpha >= 0
      ? loadings.alpha.toFixed(6)
      : `−${Math.abs(loadings.alpha).toFixed(6)}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold font-mono text-subtle">{ticker}</span>
        <span className="text-xs text-muted">
          R² ={" "}
          <span
            className={`font-mono font-semibold ${
              loadings.r_squared >= 0.5 ? "text-subtle" : "text-amber-400"
            }`}
          >
            {r2Pct}%
          </span>
          <span className="text-faint ml-1">variance explained by factors</span>
        </span>
      </div>

      {/* Equation block */}
      <div className="bg-surface rounded-lg px-4 py-3 font-mono text-xs overflow-x-auto whitespace-nowrap">
        <span className="text-muted">R</span>
        <sub className="text-muted">{ticker}</sub>
        <span className="text-muted"> = </span>
        <span className="text-subtle">{alphaStr}</span>
        <span className="text-muted"> {coef(loadings.market, 3)}</span>
        <span className="text-muted">&middot;R</span>
        <sub className="text-muted">SPY</sub>
        <span className="text-muted"> {coef(loadings.sector, 3)}</span>
        <span className="text-muted">&middot;R</span>
        <sub className="text-muted">{sectorEtf}</sub>
        <span className="text-muted"> {coef(loadings.momentum, 6)}</span>
        <span className="text-muted">&middot;R</span>
        <sub className="text-muted">Mom</sub>
        <span className="text-muted"> + </span>
        <span className="text-primary font-semibold">ε</span>
      </div>

      {/* Loading table */}
      <table className="w-full text-xs">
        <tbody>
          {[
            { label: "Market β (SPY)", value: loadings.market.toFixed(4) },
            { label: `Sector β (${sectorEtf})`, value: loadings.sector.toFixed(4) },
            { label: "Momentum β", value: loadings.momentum.toFixed(6) },
            { label: "Alpha (α)", value: loadings.alpha.toFixed(6) },
          ].map(({ label, value }) => (
            <tr key={label} className="border-t border-divider">
              <td className="py-1.5 text-muted">{label}</td>
              <td className="py-1.5 text-right font-mono text-subtle">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-faint">
        ε is the idiosyncratic residual — {ticker}&apos;s daily move after stripping out what
        market, sector, and momentum would predict. This is what you&apos;re trading.
      </p>
    </div>
  );
}

function TradeRow({
  action,
  instrument,
  weight,
  reason,
}: {
  action: "Long" | "Short";
  instrument: string;
  weight: string;
  reason: string;
}) {
  return (
    <tr className="border-t border-divider">
      <td className="py-2 pr-3">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
            action === "Long" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
          }`}
        >
          {action}
        </span>
      </td>
      <td className="py-2 pr-4 font-mono text-xs font-semibold text-subtle">{instrument}</td>
      <td className="py-2 pr-4 font-mono text-xs text-subtle">{weight}</td>
      <td className="py-2 text-xs text-muted">{reason}</td>
    </tr>
  );
}

export default function FactorPage() {
  const [ticker, setTicker] = useState("AAPL");
  const [sectorEtf, setSectorEtf] = useState("XLK");
  const [lookbackDays, setLookbackDays] = useState(730);
  const [zscoreWindow, setZscoreWindow] = useState(30);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<FactorStockResult | null>(null);

  function addLog(entry: LogEntry) {
    setLogEntries((prev) => [...prev, entry]);
  }

  async function run() {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setLogEntries([]);

    try {
      const res = await fetch(`${API}/api/factor-stock/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          sector_etf: sectorEtf,
          lookback_days: lookbackDays,
          zscore_window: zscoreWindow,
        }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { detail?: string }).detail ?? "Request failed.");
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
              addLog({
                kind: "header",
                text: `Fetching  ${(event.tickers as string[]).join(" · ")}`,
              });
              break;
            case "step":
              addLog({ kind: event.kind as LogEntry["kind"], text: event.text as string });
              break;
            case "regression": {
              const r2 = (event.r_squared as number) * 100;
              addLog({
                kind: "pass",
                text: event.ticker as string,
                detail: `R² ${r2.toFixed(1)}%  β_mkt ${(event.market as number).toFixed(3)}  β_sec ${(event.sector as number).toFixed(3)}  β_mom ${(event.momentum as number).toFixed(3)}`,
              });
              break;
            }
            case "adf_result": {
              const pv = event.p_value as number;
              const stationary = event.is_stationary as boolean;
              addLog({
                kind: stationary ? "pass" : "fail",
                text: "Residual ADF",
                detail: `p = ${pv.toFixed(4)}  ${stationary ? "stationary ✓" : "non-stationary"}`,
              });
              break;
            }
            case "complete":
              addLog({ kind: "summary", text: "Analysis complete" });
              setResult(event.result as FactorStockResult);
              break;
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

  const loadings = result?.factor_loadings;
  const z = result?.current_zscore ?? null;
  const signalLabel =
    z === null ? null : z < -2 ? "BUY ε" : z > 2 ? "SELL ε" : "FLAT";

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-subtle">Factor Analysis</h1>
        <p className="text-xs text-faint mt-1">
          Decompose a stock&apos;s returns into systematic factor exposures, then trade the
          idiosyncratic residual — the gap between what the stock does and what its factors predict.
        </p>
      </div>

      {/* Inputs */}
      <Card title="Parameters">
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              maxLength={10}
              className="w-28 border border-divider bg-surface text-subtle rounded-md px-3 py-2 text-base font-mono font-semibold uppercase tracking-widest placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <div className="flex items-center gap-2">
              <label className="label">Sector ETF</label>
              <Select value={sectorEtf} onChange={setSectorEtf} options={SECTOR_ETFS} />
            </div>

            <button
              onClick={run}
              disabled={loading || !ticker}
              className="px-5 py-2 bg-primary text-subtle text-sm font-medium rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {loading ? "Analyzing…" : "Run Analysis"}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="label mb-1 block">Lookback — {lookbackDays} days</label>
              <input
                type="range"
                min={365}
                max={1825}
                step={30}
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-faint mt-0.5">
                <span>1 yr</span>
                <span>5 yr</span>
              </div>
            </div>

            <div>
              <label className="label mb-1 block">Z-Score Window — {zscoreWindow} days</label>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={zscoreWindow}
                onChange={(e) => setZscoreWindow(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-faint mt-0.5">
                <span>10</span>
                <span>120</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-faint">
            Momentum factor: SPY 12-minus-1-month return. Minimum 1-year lookback required.
          </p>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {logEntries.length > 0 && <ScanProgress entries={logEntries} scanning={loading} />}

      {result && loadings && (
        <>
          {/* ── Step 1: Factor model ── */}
          <Card title="Step 1 — Factor Model Fit">
            <RegressionCard
              ticker={result.ticker}
              loadings={loadings}
              sectorEtf={result.sector_etf}
            />
          </Card>

          {/* ── Step 2: Residual mean reversion ── */}
          <div>
            <p className="section-heading mb-3">Step 2 — Idiosyncratic Residual (ε)</p>
            <div className="space-y-4">
              {/* Verdict */}
              <div
                className={`rounded-xl px-5 py-4 border ${
                  result.adf.is_stationary
                    ? "bg-green-500/10 border-green-500/20"
                    : "bg-red-500/10 border-red-500/20"
                }`}
              >
                <div
                  className={`text-base font-bold ${
                    result.adf.is_stationary ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {result.adf.is_stationary ? "ε is Mean-Reverting" : "ε is Not Mean-Reverting"}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  ADF p-value = {result.adf.p_value.toFixed(4)}
                  {!result.adf.is_stationary && (
                    <span className="text-amber-400 ml-2">
                      — residual may have a unit root; this ticker&apos;s idiosyncratic component
                      doesn&apos;t revert
                    </span>
                  )}
                </div>
              </div>

              {/* Metric tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric
                  label="Half-Life"
                  value={result.half_life !== null ? `${result.half_life}d` : "N/A"}
                  sub={result.half_life !== null ? "expected reversion" : "residual diverging"}
                />
                <Metric
                  label="Current Z-Score"
                  value={result.current_zscore !== null ? result.current_zscore.toFixed(2) : "—"}
                />
                <Metric
                  label="ADF Statistic"
                  value={result.adf.test_statistic.toFixed(3)}
                  sub={`5% critical: ${result.adf.critical_values["5%"].toFixed(3)}`}
                />
                <Metric
                  label="Data Points"
                  value={result.dates.length}
                  sub={`${result.dates[0].slice(0, 7)} → ${result.dates[result.dates.length - 1].slice(0, 7)}`}
                />
              </div>

              {/* Charts */}
              <Card>
                <ResidualStockChart data={result} zscoreWindow={zscoreWindow} />
              </Card>
            </div>
          </div>

          {/* ── Step 3: Trade construction ── */}
          <Card title="Step 3 — Factor-Neutral Trade Construction">
            <p className="text-xs text-muted mb-1">
              You&apos;re not trading {result.ticker} — you&apos;re trading ε, the gap between what
              it does and what its factors predict. To isolate ε, you must hedge out the systematic
              exposures simultaneously.
            </p>
            <p className="text-xs text-faint mb-5">
              Table below shows the portfolio for going{" "}
              <span className="text-subtle">long</span> ε (z-score unusually low → stock is cheap
              vs. its factors → expect upward reversion). Reverse all signs to short ε.
            </p>

            <div className="overflow-x-auto mb-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-divider">
                    <th className="pb-2 text-left label">Action</th>
                    <th className="pb-2 text-left label">Instrument</th>
                    <th className="pb-2 text-left label">Weight</th>
                    <th className="pb-2 text-left label">Why</th>
                  </tr>
                </thead>
                <tbody>
                  <TradeRow
                    action="Long"
                    instrument={result.ticker}
                    weight="+1"
                    reason="Direct long on the idiosyncratic residual ε"
                  />
                  <TradeRow
                    action={loadings.market >= 0 ? "Short" : "Long"}
                    instrument="SPY"
                    weight={`${loadings.market < 0 ? "+" : "−"}${Math.abs(loadings.market).toFixed(4)}`}
                    reason={`Cancel market β = ${loadings.market.toFixed(4)} — kills systematic market exposure`}
                  />
                  <TradeRow
                    action={loadings.sector >= 0 ? "Short" : "Long"}
                    instrument={result.sector_etf}
                    weight={`${loadings.sector < 0 ? "+" : "−"}${Math.abs(loadings.sector).toFixed(4)}`}
                    reason={`Cancel sector β = ${loadings.sector.toFixed(4)} — kills ${result.sector_etf} sector exposure`}
                  />
                </tbody>
              </table>
            </div>

            <p className="text-xs text-faint mb-5">
              Momentum is a derived signal, not a tradeable asset — residual momentum exposure is
              accepted. Alpha (α) is a constant and doesn&apos;t create factor risk.
            </p>

            {/* Current signal */}
            {z !== null && (
              <div
                className={`rounded-lg px-4 py-4 border ${
                  signalLabel === "BUY ε"
                    ? "bg-green-500/10 border-green-500/20"
                    : signalLabel === "SELL ε"
                    ? "bg-red-500/10 border-red-500/20"
                    : "bg-surface border-divider"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Current signal</span>
                  <span
                    className={`text-sm font-bold font-mono ${
                      signalLabel === "BUY ε"
                        ? "text-green-400"
                        : signalLabel === "SELL ε"
                        ? "text-red-400"
                        : "text-muted"
                    }`}
                  >
                    {signalLabel}
                  </span>
                </div>
                <div className="text-xs text-faint mt-1">
                  z = {z.toFixed(3)} · Entry threshold: ±2σ (typical)
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
