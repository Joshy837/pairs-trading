"use client";

import { KeyboardEvent, useState } from "react";

const MAX_TICKERS = 12;

interface Props {
  tickers: string[];
  loading: boolean;
  onChange: (tickers: string[]) => void;
  onSubmit: () => void;
}

export default function MultiTickerInput({ tickers, loading, onChange, onSubmit }: Props) {
  const [input, setInput] = useState("");

  function add(raw: string) {
    const val = raw.trim().toUpperCase().replace(/[^A-Z.]/g, "");
    if (!val || tickers.includes(val) || tickers.length >= MAX_TICKERS) return;
    onChange([...tickers, val]);
    setInput("");
  }

  function remove(ticker: string) {
    onChange(tickers.filter((t) => t !== ticker));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === " " || e.key === ",") {
      e.preventDefault();
      add(input);
    } else if (e.key === "Backspace" && !input && tickers.length > 0) {
      onChange(tickers.slice(0, -1));
    }
  }

  const pairCount = (tickers.length * (tickers.length - 1)) / 2;
  const canScan = tickers.length >= 2 && !loading;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 flex flex-wrap gap-1.5 p-2 border border-divider rounded-md bg-surface min-h-[42px] items-center cursor-text">
          {tickers.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/20 text-primary text-xs font-mono rounded"
            >
              {t}
              <button
                onClick={() => remove(t)}
                className="leading-none hover:text-subtle ml-0.5 transition-colors"
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
          {tickers.length < MAX_TICKERS && (
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={onKeyDown}
              onBlur={() => { if (input) add(input); }}
              placeholder={tickers.length === 0 ? "Type ticker and press Enter…" : ""}
              maxLength={10}
              className="flex-1 min-w-[140px] bg-transparent text-subtle text-xs font-mono uppercase tracking-widest placeholder:text-faint outline-none py-0.5"
            />
          )}
        </div>
        <button
          onClick={onSubmit}
          disabled={!canScan}
          className="px-5 py-2 bg-primary text-white text-sm font-medium rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {loading ? "Scanning…" : `Scan ${pairCount} pair${pairCount !== 1 ? "s" : ""}`}
        </button>
      </div>
      <p className="text-xs text-faint">
        {tickers.length}/{MAX_TICKERS} tickers · Enter or Space to add · Backspace to remove last
      </p>
    </div>
  );
}
