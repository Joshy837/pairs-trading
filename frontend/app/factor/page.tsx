"use client";

import { useState } from "react";
import ResidualSpreadChart from "@/components/ResidualSpreadChart";
import ScanProgress from "@/components/ScanProgress";
import { FactorAnalysisResult, LogEntry } from "@/types";

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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr className="border-t border-divider">
      <td className="py-1.5 pr-4 text-xs text-muted whitespace-nowrap">{label}</td>
      <td className="py-1.5 text-xs font-mono text-subtle">{value}</td>
    </tr>
  );
}

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${
        ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
      }`}
    >
      {ok ? yes : no}
    </span>
  );
}

export default function FactorPage() {
  const [ticker1, setTicker1] = useState("KO");
  const [ticker2, setTicker2] = useState("PEP");
  const [sectorEtf, setSectorEtf] = useState("XLP");
  const [lookbackDays, setLookbackDays] = useState(730);
  const [zscoreWindow, setZscoreWindow] = useState(30);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<FactorAnalysisResult | null>(null);

  function addLog(entry: LogEntry) {
    setLogEntries((prev) => [...prev, entry]);
  }

  async function run() {
    if (!ticker1 || !ticker2) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setLogEntries([]);

    try {
      const res = await fetch(`${API}/api/factor-analyze/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker1: ticker1.toUpperCase(),
          ticker2: ticker2.toUpperCase(),
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
              const t = event.ticker as string;
              const r2 = (event.r_squared as number) * 100;
              addLog({
                kind: "pass",
                text: t,
                detail: `R² ${r2.toFixed(1)}%  β_mkt ${(event.market as number).toFixed(3)}  β_sec ${(event.sector as number).toFixed(3)}  β_mom ${(event.momentum as number).toFixed(3)}`,
              });
              break;
            }

            case "adf_result": {
              const pv = event.p_value as number;
              const stationary = event.is_stationary as boolean;
              addLog({
                kind: stationary ? "pass" : "fail",
                text: `Residual spread ADF`,
                detail: `p = ${pv.toFixed(4)}  ${stationary ? "stationary ✓" : "non-stationary"}`,
              });
              break;
            }

            case "complete":
              addLog({ kind: "summary", text: "Analysis complete" });
              setResult(event.result as FactorAnalysisResult);
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

  const l1 = result?.factor_loadings.ticker1;
  const l2 = result?.factor_loadings.ticker2;

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-subtle">Factor Pairs Analysis</h1>
        <p className="text-xs text-faint mt-1">
          3-factor model: market (SPY) · sector ETF · momentum. Tests if the factor-neutral residual spread mean-reverts.
        </p>
      </div>

      {/* Inputs */}
      <Card title="Pair &amp; Parameters">
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ticker1}
                onChange={(e) => setTicker1(e.target.value.toUpperCase())}
                placeholder="KO"
                maxLength={10}
                className="w-24 border border-divider bg-surface text-subtle rounded-md px-3 py-2 text-base font-mono font-semibold uppercase tracking-widest placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-sm font-medium text-muted select-none">vs</span>
              <input
                type="text"
                value={ticker2}
                onChange={(e) => setTicker2(e.target.value.toUpperCase())}
                placeholder="PEP"
                maxLength={10}
                className="w-24 border border-divider bg-surface text-subtle rounded-md px-3 py-2 text-base font-mono font-semibold uppercase tracking-widest placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="label">Sector ETF</label>
              <select
                value={sectorEtf}
                onChange={(e) => setSectorEtf(e.target.value)}
                className="border border-divider bg-surface text-subtle rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {SECTOR_ETFS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <button
              onClick={run}
              disabled={loading || !ticker1 || !ticker2}
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
                <span>1 yr</span><span>5 yr</span>
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
                <span>10</span><span>120</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-faint">
            Momentum factor: SPY 12-minus-1-month return. Minimum 1-year lookback required for momentum warmup.
          </p>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Progress log */}
      {logEntries.length > 0 && (
        <ScanProgress entries={logEntries} scanning={loading} />
      )}

      {result && (
        <>
          {/* Factor Loadings */}
          <Card title="Factor Loadings">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-divider">
                    <th className="pb-2 text-left label">Ticker</th>
                    <th className="pb-2 text-right label">β Market</th>
                    <th className="pb-2 text-right label">β Sector</th>
                    <th className="pb-2 text-right label">β Momentum</th>
                    <th className="pb-2 text-right label">α</th>
                    <th className="pb-2 text-right label">R²</th>
                  </tr>
                </thead>
                <tbody>
                  {([{ ticker: result.ticker1, l: l1 }, { ticker: result.ticker2, l: l2 }]).map(
                    ({ ticker, l }) =>
                      l ? (
                        <tr key={ticker} className="border-t border-divider">
                          <td className="py-2 font-mono font-semibold text-subtle">{ticker}</td>
                          <td className="py-2 text-right font-mono text-subtle">{l.market.toFixed(4)}</td>
                          <td className="py-2 text-right font-mono text-subtle">{l.sector.toFixed(4)}</td>
                          <td className="py-2 text-right font-mono text-subtle">{l.momentum.toFixed(4)}</td>
                          <td className="py-2 text-right font-mono text-subtle">{l.alpha.toFixed(6)}</td>
                          <td className="py-2 text-right font-mono text-subtle">{(l.r_squared * 100).toFixed(1)}%</td>
                        </tr>
                      ) : null
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-faint mt-3">
              Factors: SPY (market) · {sectorEtf} (sector) · SPY 12-1mo momentum. R² = fraction of return variance explained by factors.
            </p>
          </Card>

          {/* Cointegration stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Card title="Residual Spread — ADF Test">
              <div
                className={`rounded-lg p-3 text-center mb-4 ${
                  result.adf.is_stationary
                    ? "bg-green-500/10 border border-green-500/20"
                    : "bg-red-500/10 border border-red-500/20"
                }`}
              >
                <div className={`text-base font-bold ${result.adf.is_stationary ? "text-green-400" : "text-red-400"}`}>
                  {result.adf.is_stationary ? "Mean-Reverting" : "Not Mean-Reverting"}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Residual spread — hedge ratio β = {result.hedge_ratio}
                </div>
              </div>
              <table className="w-full">
                <tbody>
                  <Row label="Test statistic" value={result.adf.test_statistic.toFixed(4)} />
                  <Row label="p-value" value={result.adf.p_value.toFixed(4)} />
                  <Row label="Critical 1%" value={result.adf.critical_values["1%"].toFixed(4)} />
                  <Row label="Critical 5%" value={result.adf.critical_values["5%"].toFixed(4)} />
                  <Row
                    label="Result"
                    value={<Badge ok={result.adf.is_stationary} yes="Stationary" no="Non-stationary" />}
                  />
                </tbody>
              </table>
            </Card>

            <Card title="Mean Reversion Stats">
              <table className="w-full">
                <tbody>
                  <Row
                    label="Half-life"
                    value={
                      result.half_life !== null
                        ? `${result.half_life} days`
                        : <span className="text-faint">N/A — spread diverging</span>
                    }
                  />
                  <Row
                    label="Current z-score"
                    value={result.current_zscore !== null ? result.current_zscore.toFixed(3) : "—"}
                  />
                  <Row label="Data points" value={result.dates.length} />
                  <Row label="Window start" value={result.dates[0]} />
                  <Row label="Window end" value={result.dates[result.dates.length - 1]} />
                </tbody>
              </table>
              {!result.adf.is_stationary && (
                <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded p-3 mt-4">
                  The factor-neutral residual spread is not stationary. The pair may not have a genuine idiosyncratic relationship beyond common factor exposure.
                </p>
              )}
            </Card>
          </div>

          {/* Charts */}
          <Card title="Residual Spread &amp; Z-Score">
            <ResidualSpreadChart data={result} />
          </Card>
        </>
      )}
    </div>
  );
}
