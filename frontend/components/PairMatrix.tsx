"use client";

import { ScanPairResult } from "@/types";

interface Props {
  tickers: string[];
  pairs: ScanPairResult[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function pairKey(t1: string, t2: string): string {
  return [t1, t2].sort().join(":");
}

function cellStyle(pvalue: number): string {
  if (pvalue < 0.01) return "bg-green-900/70 text-green-300 border-green-700/40 cursor-pointer hover:brightness-125";
  if (pvalue < 0.05) return "bg-green-900/40 text-green-400 border-green-800/30 cursor-pointer hover:brightness-125";
  if (pvalue < 0.10) return "bg-amber-900/40 text-amber-400 border-amber-800/30 cursor-pointer hover:brightness-125";
  return "bg-panel text-faint border-divider cursor-pointer hover:bg-divider/40";
}

export default function PairMatrix({ tickers, pairs, selectedKey, onSelect }: Props) {
  const lookup = new Map<string, ScanPairResult>();
  for (const p of pairs) {
    lookup.set(pairKey(p.ticker1, p.ticker2), p);
  }

  const cellSize = tickers.length <= 6 ? "w-16 h-14" : tickers.length <= 9 ? "w-13 h-11" : "w-11 h-9";
  const labelSize = tickers.length <= 6 ? "w-16" : tickers.length <= 9 ? "w-13" : "w-11";
  const textSize = tickers.length <= 9 ? "text-xs" : "text-[10px]";

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Column headers */}
        <div className="flex" style={{ paddingLeft: "3rem" }}>
          {tickers.map((t) => (
            <div
              key={t}
              className={`${labelSize} flex-shrink-0 text-center ${textSize} font-mono text-muted py-1 truncate px-0.5`}
            >
              {t}
            </div>
          ))}
        </div>

        {/* Rows */}
        {tickers.map((rowTicker, ri) => (
          <div key={rowTicker} className="flex items-center">
            {/* Row label */}
            <div className="w-12 flex-shrink-0 text-right pr-2 text-xs font-mono text-muted truncate">
              {rowTicker}
            </div>

            {tickers.map((colTicker, ci) => {
              if (ri === ci) {
                return (
                  <div
                    key={colTicker}
                    className={`${cellSize} flex-shrink-0 border border-divider bg-ink/60 m-px rounded-sm`}
                  />
                );
              }

              const key = pairKey(rowTicker, colTicker);
              const pair = lookup.get(key);

              if (!pair) {
                return (
                  <div
                    key={colTicker}
                    className={`${cellSize} flex-shrink-0 border border-divider bg-panel m-px rounded-sm`}
                  />
                );
              }

              const isSelected = selectedKey === key;

              return (
                <div
                  key={colTicker}
                  onClick={() => onSelect(key)}
                  className={`${cellSize} flex-shrink-0 border m-px rounded-sm flex flex-col items-center justify-center transition-all ${cellStyle(pair.pvalue)} ${isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""}`}
                >
                  <span className={`${textSize} font-mono leading-tight`}>
                    {pair.pvalue.toFixed(3)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 pl-12">
          <span className="text-[10px] text-faint">p-value:</span>
          {[
            { label: "< 0.01", cls: "bg-green-900/70 text-green-300" },
            { label: "< 0.05", cls: "bg-green-900/40 text-green-400" },
            { label: "< 0.10", cls: "bg-amber-900/40 text-amber-400" },
            { label: "≥ 0.10", cls: "bg-panel text-faint border border-divider" },
          ].map(({ label, cls }) => (
            <span key={label} className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${cls}`}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
