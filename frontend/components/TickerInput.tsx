"use client";

interface Props {
  ticker1: string;
  ticker2: string;
  loading: boolean;
  onChange: (t1: string, t2: string) => void;
  onSubmit: () => void;
}

export default function TickerInput({ ticker1, ticker2, loading, onChange, onSubmit }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={ticker1}
          onChange={(e) => onChange(e.target.value.toUpperCase(), ticker2)}
          placeholder="KO"
          maxLength={10}
          className="w-24 border border-divider bg-surface text-subtle rounded-md px-3 py-2 text-base font-mono font-semibold uppercase tracking-widest placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <span className="text-sm font-medium text-muted select-none">vs</span>
        <input
          type="text"
          value={ticker2}
          onChange={(e) => onChange(ticker1, e.target.value.toUpperCase())}
          placeholder="PEP"
          maxLength={10}
          className="w-24 border border-divider bg-surface text-subtle rounded-md px-3 py-2 text-base font-mono font-semibold uppercase tracking-widest placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <button
        onClick={onSubmit}
        disabled={loading || !ticker1 || !ticker2}
        className="px-5 py-2 bg-primary text-white text-sm font-medium rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {loading ? "Analyzing…" : "Analyze Pair"}
      </button>
    </div>
  );
}
