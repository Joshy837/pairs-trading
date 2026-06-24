"use client";

import { useState } from "react";
import { ScanPairResult } from "@/types";

type SortKey = "pvalue" | "hedge_ratio" | "zscore" | "half_life";
type SortDir = "asc" | "desc";

interface Props {
  pairs: ScanPairResult[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function pairKey(t1: string, t2: string): string {
  return [t1, t2].sort().join(":");
}

function pvalueBadge(pvalue: number): string {
  if (pvalue < 0.01) return "bg-green-900/70 text-green-300";
  if (pvalue < 0.05) return "bg-green-900/40 text-green-400";
  if (pvalue < 0.1) return "bg-amber-900/40 text-amber-400";
  return "bg-panel text-faint border border-divider";
}

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <span className="text-faint ml-1">↕</span>;
  return <span className="text-primary ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export default function PairTable({ pairs, selectedKey, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("pvalue");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = [...pairs].sort((a, b) => {
    const aVal = a[sortKey] ?? Infinity;
    const bVal = b[sortKey] ?? Infinity;
    return sortDir === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });

  const thCls =
    "pb-2 pr-4 font-medium text-left select-none cursor-pointer hover:text-subtle transition-colors whitespace-nowrap";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-faint border-b border-divider">
            <th className="pb-2 pr-4 font-medium text-left">Pair</th>
            <th className={thCls} onClick={() => toggleSort("pvalue")}>
              P-Value <SortIcon col="pvalue" sortKey={sortKey} dir={sortDir} />
            </th>
            <th className={thCls} onClick={() => toggleSort("hedge_ratio")}>
              Hedge Ratio <SortIcon col="hedge_ratio" sortKey={sortKey} dir={sortDir} />
            </th>
            <th className={thCls} onClick={() => toggleSort("zscore")}>
              Z-Score <SortIcon col="zscore" sortKey={sortKey} dir={sortDir} />
            </th>
            <th className={thCls} onClick={() => toggleSort("half_life")}>
              Half-Life <SortIcon col="half_life" sortKey={sortKey} dir={sortDir} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((pair) => {
            const key = pairKey(pair.ticker1, pair.ticker2);
            const isSelected = selectedKey === key;
            return (
              <tr
                key={key}
                onClick={() => onSelect(key)}
                className={`border-t border-divider cursor-pointer transition-colors ${
                  isSelected ? "bg-primary/10" : "hover:bg-divider/30"
                }`}
              >
                <td className="py-2 pr-4 font-mono font-semibold text-subtle">
                  {pair.ticker1}
                  <span className="text-faint font-normal mx-1">/</span>
                  {pair.ticker2}
                </td>
                <td className="py-2 pr-4">
                  <span className={`px-1.5 py-0.5 rounded font-mono ${pvalueBadge(pair.pvalue)}`}>
                    {pair.pvalue.toFixed(4)}
                  </span>
                </td>
                <td className="py-2 pr-4 font-mono text-muted">{pair.hedge_ratio.toFixed(4)}</td>
                <td className="py-2 pr-4 font-mono text-muted">
                  {pair.zscore !== null ? pair.zscore.toFixed(3) : "—"}
                </td>
                <td className="py-2 font-mono text-muted">
                  {pair.half_life !== null ? `${pair.half_life}d` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
