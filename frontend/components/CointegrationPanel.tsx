"use client";

import { AnalysisResult } from "@/types";

interface Props {
  data: AnalysisResult;
  ticker1: string;
  ticker2: string;
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr className="border-t border-divider">
      <td className="py-1.5 pr-4 text-xs text-muted whitespace-nowrap">{label}</td>
      <td className="py-1.5 text-xs font-mono text-subtle">{value}</td>
    </tr>
  );
}

export default function CointegrationPanel({ data, ticker1, ticker2 }: Props) {
  const { adf, johansen, hedge_ratio, is_cointegrated, half_life } = data;

  return (
    <div className="space-y-4">
      {/* Verdict */}
      <div
        className={`rounded-lg p-4 text-center ${
          is_cointegrated
            ? "bg-green-500/10 border border-green-500/20"
            : "bg-red-500/10 border border-red-500/20"
        }`}
      >
        <div className={`text-lg font-bold ${is_cointegrated ? "text-green-400" : "text-red-400"}`}>
          {is_cointegrated ? "Cointegrated" : "Not Cointegrated"}
        </div>
        <div className="text-xs text-muted mt-0.5">
          {ticker1} / {ticker2} — Hedge ratio β = {hedge_ratio}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* ADF Test */}
        <div>
          <h3 className="section-heading mb-2">ADF Test (Engle-Granger)</h3>
          <table className="w-full">
            <tbody>
              <Row label="Test statistic" value={adf.test_statistic.toFixed(4)} />
              <Row label="p-value" value={adf.p_value.toFixed(4)} />
              <Row label="Critical 1%" value={adf.critical_values["1%"].toFixed(4)} />
              <Row label="Critical 5%" value={adf.critical_values["5%"].toFixed(4)} />
              <Row
                label="Result"
                value={<Badge ok={adf.is_stationary} yes="Stationary" no="Non-stationary" />}
              />
            </tbody>
          </table>
        </div>

        {/* Johansen Test */}
        <div>
          <h3 className="section-heading mb-2">Johansen Test (Trace)</h3>
          <table className="w-full">
            <tbody>
              <Row label="Trace statistic" value={johansen.trace_statistic.toFixed(4)} />
              <Row label="Critical value 95%" value={johansen.critical_value_95.toFixed(4)} />
              <Row
                label="Result"
                value={
                  <Badge ok={johansen.is_cointegrated} yes="Cointegrated" no="No cointegration" />
                }
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* Half-life */}
      <div className="flex items-center justify-between rounded-md bg-surface px-3 py-2">
        <span className="text-xs text-muted">Half-life of mean reversion</span>
        {half_life !== null && half_life !== undefined ? (
          <span className="text-xs font-mono font-semibold text-subtle">{half_life.toFixed(1)} trading days</span>
        ) : (
          <span className="text-xs font-mono text-faint">— (spread not mean-reverting)</span>
        )}
      </div>

      {!is_cointegrated && (
        <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded p-3">
          Neither test finds cointegration at the 95% level. Backtest results may not be
          statistically meaningful.
        </p>
      )}
    </div>
  );
}
