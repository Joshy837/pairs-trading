"use client";

import { useEffect, useRef } from "react";
import { LogEntry } from "@/types";

interface Props {
  entries: LogEntry[];
  scanning: boolean;
}

const KIND_STYLES: Record<LogEntry["kind"], string> = {
  info:    "text-muted",
  header:  "text-subtle font-semibold mt-2 first:mt-0",
  pass:    "text-green-400",
  fail:    "text-faint",
  summary: "text-primary mt-1",
};

export default function ScanProgress({ entries, scanning }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="bg-panel rounded-xl border border-divider p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-subtle uppercase tracking-wide">
          Scan log
        </span>
        {scanning && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            running
          </span>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto space-y-0.5 font-mono text-xs">
        {entries.map((entry, i) => (
          <div key={i} className={`flex items-baseline gap-3 ${KIND_STYLES[entry.kind]}`}>
            <span className="shrink-0 w-3 text-center select-none">
              {entry.kind === "pass" ? "✓" : entry.kind === "fail" ? "✗" : entry.kind === "summary" ? "→" : ""}
            </span>
            <span className="flex-1">{entry.text}</span>
            {entry.detail && (
              <span className="text-faint tabular-nums">{entry.detail}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
