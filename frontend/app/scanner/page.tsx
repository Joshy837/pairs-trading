"use client";

import Link from "next/link";
import { useState } from "react";
import MultiTickerInput from "@/components/MultiTickerInput";
import PairMatrix from "@/components/PairMatrix";
import PairTable from "@/components/PairTable";
import { ScanPairResult, ScanResponse } from "@/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DEFAULT_TICKERS = ["KO", "PEP", "MCD", "YUM"];

const PRESET_GROUPS = [
  { label: "Consumer", tickers: ["KO", "PEP", "MCD", "YUM", "SBUX"] },
  { label: "Energy", tickers: ["XOM", "CVX", "COP", "PSX", "VLO"] },
  { label: "Tech", tickers: ["AAPL", "MSFT", "GOOGL", "META", "AMZN"] },
  { label: "Finance", tickers: ["JPM", "BAC", "GS", "MS", "WFC"] },
];

function pairKey(t1: string, t2: string): string {
  return [t1, t2].sort().join(":");
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel rounded-xl shadow-sm border border-divider p-5">
      {title && <h2 className="text-sm font-semibold text-subtle mb-4">{title}</h2>}
      {children}
    </div>
  );
}

export default function ScannerPage() {
  const [tickers, setTickers] = useState<string[]>(DEFAULT_TICKERS);
  const [lookbackDays, setLookbackDays] = useState(365);
  const [zscoreWindow, setZscoreWindow] = useState(30);
  const [qualityFilter, setQualityFilter] = useState<"all" | "stable">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "table">("matrix");

  async function handleScan() {
    setError(null);
    setResult(null);
    setSelectedKey(null);
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers,
          lookback_days: lookbackDays,
          zscore_window: zscoreWindow,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? "Scan failed.");
      setResult(json as ScanResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
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

  return (
    <div className="min-h-screen bg-surface">
      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">
        {/* Control panel */}
        <Card>
          <div className="space-y-4">
            <MultiTickerInput
              tickers={tickers}
              loading={loading}
              onChange={setTickers}
              onSubmit={handleScan}
            />

            {/* Preset groups */}
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

            {/* Lookback + z-score window + sector filter */}
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
            </div>
          </div>
        </Card>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div className="space-y-5 animate-pulse">
            <div className="bg-panel rounded-xl border border-divider h-72" />
            <div className="bg-panel rounded-xl border border-divider h-48" />
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && !error && (
          <div className="rounded-xl border border-dashed border-divider py-14 px-8 text-center">
            <p className="text-sm font-medium text-subtle mb-1">Add tickers and scan</p>
            <p className="text-xs text-muted max-w-sm mx-auto">
              Tests all pair combinations for cointegration. Click a result to open it in the
              backtester.
            </p>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="space-y-5">
            {/* Selected pair detail */}
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

            {/* View toggle + results card */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-subtle">
                    {filteredPairs.length}
                    {filteredPairs.length !== result.pairs.length && `/${result.pairs.length}`} pairs
                    {" · "}
                    {filteredPairs.filter((p) => p.is_cointegrated).length} cointegrated
                  </h2>
                  {/* Quality filter chips */}
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
          </div>
        )}
      </main>
    </div>
  );
}
