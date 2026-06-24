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
    <div className="flex flex-col sm:flex-row gap-3 items-end">
      <div className="flex-1">
        <label className="block label mb-1">
          Ticker 1
        </label>
        <input
          type="text"
          value={ticker1}
          onChange={(e) => onChange(e.target.value.toUpperCase(), ticker2)}
          placeholder="e.g. KO"
          maxLength={10}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="flex-1">
        <label className="block label mb-1">
          Ticker 2
        </label>
        <input
          type="text"
          value={ticker2}
          onChange={(e) => onChange(ticker1, e.target.value.toUpperCase())}
          placeholder="e.g. PEP"
          maxLength={10}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <button
        onClick={onSubmit}
        disabled={loading || !ticker1 || !ticker2}
        className="px-6 py-2 bg-primary text-white text-sm font-medium rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        {loading ? "Analyzing…" : "Analyze Pair"}
      </button>
    </div>
  );
}
