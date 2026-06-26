"use client";

import { useState, useRef, useEffect } from "react";

export interface SelectOption {
  value: string;
  /** Format: "TICKER — Label" or just "Label" — ticker is extracted before " — " if present */
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: readonly SelectOption[];
  /** Min width of the trigger button, e.g. "11rem" */
  minWidth?: string;
}

export default function Select({ value, onChange, options, minWidth = "11rem" }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function displayLabel(label: string) {
    const parts = label.split(" — ");
    return parts.length > 1 ? parts.slice(1).join(" — ") : label;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ minWidth }}
        className="flex items-center gap-2 border border-divider bg-surface text-subtle rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary hover:border-primary/50 transition-colors"
      >
        <span className="font-mono font-semibold text-primary text-xs">{selected?.value}</span>
        <span className="flex-1 text-left text-subtle truncate">
          {selected ? displayLabel(selected.label) : ""}
        </span>
        <svg
          className={`w-4 h-4 text-muted shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-full min-w-[13rem] bg-panel border border-divider rounded-lg shadow-xl py-1 overflow-hidden">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                  isSelected
                    ? "bg-primary/10 text-subtle"
                    : "text-muted hover:bg-divider/40 hover:text-subtle"
                }`}
              >
                <span className={`font-mono font-semibold text-xs w-10 shrink-0 ${isSelected ? "text-primary" : "text-faint"}`}>
                  {opt.value}
                </span>
                <span className="truncate">{displayLabel(opt.label)}</span>
                {isSelected && (
                  <svg className="ml-auto w-3.5 h-3.5 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
