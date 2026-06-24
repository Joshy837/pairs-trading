"use client";

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
  return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="label">{label}</label>
        <span className="text-xs font-mono text-subtle">
          {value}{unit}
        </span>
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
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

export default function ParameterControls({ params, onChange }: Props) {
  const set = (key: keyof Parameters) => (v: number) =>
    onChange({ ...params, [key]: v });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      <SliderField
        label="Lookback Window"
        value={params.lookback_days}
        min={90}
        max={730}
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
    </div>
  );
}
