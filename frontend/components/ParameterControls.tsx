"use client";

import { useEffect, useState } from "react";
import { Parameters } from "@/types";

interface Props {
  params: Parameters;
  onChange: (p: Parameters) => void;
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function SliderField({ label, value, min, max, step, unit, onChange }: SliderFieldProps) {
  const [inputVal, setInputVal] = useState(String(value));

  useEffect(() => {
    setInputVal(String(value));
  }, [value]);

  function commitInput(raw: string) {
    const v = Number(raw);
    if (!isNaN(v) && v >= min && v <= max) {
      onChange(v);
    } else {
      setInputVal(String(value));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={(e) => commitInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitInput(inputVal)}
            className="w-14 text-right text-xs font-mono text-subtle bg-panel border border-transparent hover:border-divider focus:border-primary focus:outline-none rounded px-1 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {unit && <span className="text-xs text-faint">{unit.trim()}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-xs text-faint mt-0.5">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

export default function ParameterControls({ params, onChange }: Props) {
  const set = (key: keyof Parameters) => (v: number) => onChange({ ...params, [key]: v });

  return (
    <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      <SliderField
        label="Lookback Window"
        value={params.lookback_days}
        min={90}
        max={1825}
        step={30}
        unit=" days"
        onChange={set("lookback_days")}
      />
      <SliderField
        label="Z-Score Window"
        value={params.zscore_window}
        min={10}
        max={90}
        step={5}
        unit=" days"
        onChange={set("zscore_window")}
      />
      <SliderField
        label="Entry Z-Score"
        value={params.entry_z}
        min={1.0}
        max={3.5}
        step={0.1}
        onChange={set("entry_z")}
      />
      <SliderField
        label="Exit Z-Score"
        value={params.exit_z}
        min={0.0}
        max={1.5}
        step={0.1}
        onChange={set("exit_z")}
      />
      <SliderField
        label="Stop-Loss Z"
        value={params.stop_z}
        min={2.5}
        max={6.0}
        step={0.5}
        onChange={set("stop_z")}
      />
      <SliderField
        label="Transaction Cost"
        value={params.transaction_cost_bps}
        min={0}
        max={50}
        step={1}
        unit=" bps"
        onChange={set("transaction_cost_bps")}
      />
      <SliderField
        label="In-Sample Split"
        value={params.insample_pct}
        min={50}
        max={90}
        step={5}
        unit="%"
        onChange={set("insample_pct")}
      />
    </div>

    <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
      <div className="flex items-center gap-3">
        <span className="label">Hedge Method</span>
        <div className="flex items-center rounded-md border border-divider overflow-hidden">
          <button
            onClick={() => onChange({ ...params, use_kalman: false })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              !params.use_kalman
                ? "bg-primary text-subtle"
                : "bg-surface text-muted hover:text-subtle"
            }`}
          >
            OLS
          </button>
          <button
            onClick={() => onChange({ ...params, use_kalman: true })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              params.use_kalman
                ? "bg-primary text-subtle"
                : "bg-surface text-muted hover:text-subtle"
            }`}
          >
            Kalman Filter
          </button>
        </div>
        <span className="text-xs text-faint">
          {params.use_kalman
            ? "Time-varying β updated each day — no lookahead bias"
            : "Static β estimated on in-sample window only"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="label">Regime Filter</span>
        <div className="flex items-center rounded-md border border-divider overflow-hidden">
          <button
            onClick={() => onChange({ ...params, use_regime: false })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              !params.use_regime
                ? "bg-primary text-subtle"
                : "bg-surface text-muted hover:text-subtle"
            }`}
          >
            Off
          </button>
          <button
            onClick={() => onChange({ ...params, use_regime: true })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              params.use_regime
                ? "bg-primary text-subtle"
                : "bg-surface text-muted hover:text-subtle"
            }`}
          >
            HMM
          </button>
        </div>
        <span className="text-xs text-faint">
          {params.use_regime
            ? "2-state HMM gates entries — suppresses trades in trending regimes"
            : "No regime filter — trades in all market conditions"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="label">Price Space</span>
        <div className="flex items-center rounded-md border border-divider overflow-hidden">
          <button
            onClick={() => onChange({ ...params, use_log_prices: false })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              !params.use_log_prices
                ? "bg-primary text-subtle"
                : "bg-surface text-muted hover:text-subtle"
            }`}
          >
            Level
          </button>
          <button
            onClick={() => onChange({ ...params, use_log_prices: true })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              params.use_log_prices
                ? "bg-primary text-subtle"
                : "bg-surface text-muted hover:text-subtle"
            }`}
          >
            Log
          </button>
        </div>
        <span className="text-xs text-faint">
          {params.use_log_prices
            ? "Spread = log(P₁) − β·log(P₂) — stabilises variance across price levels"
            : "Spread = P₁ − β·P₂ — standard dollar-spread"}
        </span>
      </div>
    </div>
    </>
  );
}
