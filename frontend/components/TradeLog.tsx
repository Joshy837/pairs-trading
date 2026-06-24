"use client";

import { useMemo, useState } from "react";
import { Trade } from "@/types";

type SortKey = "date" | "type" | "entry_z" | "exit_date" | "exit_z" | "pnl" | "duration";
type SortDir = "asc" | "desc";

function tradeDuration(t: Trade): number {
  if (!t.exit_date) return -1;
  return new Date(t.exit_date).getTime() - new Date(t.date).getTime();
}

function exportCSV(trades: Trade[]) {
  const headers = ["Entry Date", "Direction", "Entry Z", "Exit Date", "Exit Z", "P&L", "Duration (days)", "Stop"];
  const rows = trades.map((t) => {
    const days = t.exit_date ? Math.round(tradeDuration(t) / 86400000) : "";
    const pnl =
      t.pnl !== null && t.pnl !== undefined
        ? ((t.pnl as number) * 100).toFixed(2) + "%"
        : "";
    return [t.date, t.type, t.entry_z, t.exit_date ?? "", t.exit_z ?? "", pnl, days, t.stop_triggered ? "YES" : "NO"];
  });
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trade_log.csv";
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  trades: Trade[];
}

export default function TradeLog({ trades }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...trades].sort((a, b) => {
      let av: number | string | null | undefined;
      let bv: number | string | null | undefined;

      if (sortKey === "duration") {
        av = tradeDuration(a);
        bv = tradeDuration(b);
      } else if (sortKey === "pnl") {
        av = a.pnl ?? -Infinity;
        bv = b.pnl ?? -Infinity;
      } else {
        av = a[sortKey as keyof Trade] as string | number | undefined;
        bv = b[sortKey as keyof Trade] as string | number | undefined;
      }

      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [trades, sortKey, sortDir]);

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-faint ml-0.5">↕</span>;
    return <span className="text-primary ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function Th({ col, label }: { col: SortKey; label: string }) {
    return (
      <th
        className="pb-2 pr-4 font-medium cursor-pointer hover:text-subtle transition-colors select-none whitespace-nowrap"
        onClick={() => handleSort(col)}
      >
        {label}
        <SortIcon col={col} />
      </th>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{trades.length} trades</p>
        <button
          onClick={() => exportCSV(sorted)}
          className="text-xs px-3 py-1.5 rounded-md border border-divider text-muted hover:text-subtle hover:border-primary transition-colors"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-faint border-b border-divider">
              <Th col="date" label="Entry Date" />
              <Th col="type" label="Direction" />
              <Th col="entry_z" label="Entry Z" />
              <Th col="exit_date" label="Exit Date" />
              <Th col="exit_z" label="Exit Z" />
              <Th col="pnl" label="P&L" />
              <Th col="duration" label="Duration" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const days = t.exit_date ? Math.round(tradeDuration(t) / 86400000) : null;
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
                  <td className="py-1.5 pr-4 font-mono text-muted">{t.exit_date ?? "—"}</td>
                  <td className="py-1.5 pr-4 font-mono">
                    {t.exit_z !== undefined ? (
                      <span className={t.stop_triggered ? "text-amber-400" : "text-muted"}>
                        {t.exit_z}
                        {t.stop_triggered && (
                          <span className="ml-1 font-semibold">STOP</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 font-mono">
                    {t.pnl !== null && t.pnl !== undefined ? (
                      <span className={(t.pnl as number) >= 0 ? "text-green-400" : "text-red-400"}>
                        {(t.pnl as number) >= 0 ? "+" : ""}
                        {((t.pnl as number) * 100).toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-muted">open</span>
                    )}
                  </td>
                  <td className="py-1.5 font-mono text-muted">
                    {days !== null ? `${days}d` : "open"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
