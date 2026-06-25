export interface ADFResult {
  test_statistic: number;
  p_value: number;
  critical_values: { "1%": number; "5%": number; "10%": number };
  is_stationary: boolean;
}

export interface JohansenResult {
  trace_statistic: number;
  critical_value_95: number;
  is_cointegrated: boolean;
}

export interface AnalysisResult {
  hedge_ratio: number;
  adf: ADFResult;
  johansen: JohansenResult;
  is_cointegrated: boolean;
  spread: (number | null)[];
  zscore: (number | null)[];
  dates: string[];
  rolling_hedge: (number | null)[];
  rolling_hedge_window: number;
  kalman_hedge: (number | null)[];
}

export interface Trade {
  date: string;
  type: "long" | "short";
  entry_z: number;
  exit_date?: string;
  exit_z?: number;
  stop_triggered?: boolean;
  pnl?: number | null;
}

export interface BacktestMetrics {
  sharpe_ratio: number;
  max_drawdown: number;
  total_return: number;
  num_trades: number;
}

export interface BacktestResult {
  equity_curve: (number | null)[];
  dates: string[];
  trades: Trade[];
  metrics: BacktestMetrics;
  spread: (number | null)[];
  zscore: (number | null)[];
  hedge_ratio: number;
  insample_end_date: string;
  regime: (number | null)[] | null;
}

export interface Parameters {
  lookback_days: number;
  zscore_window: number;
  entry_z: number;
  exit_z: number;
  stop_z: number;
  transaction_cost_bps: number;
  insample_pct: number; // integer 50–90; divided by 100 before sending to API
  use_kalman: boolean;
  use_regime: boolean;
}

export interface ScanPairResult {
  ticker1: string;
  ticker2: string;
  pvalue: number;
  adjusted_pvalue: number;
  bh_significant: boolean;
  hedge_ratio: number;
  zscore: number | null;
  half_life: number | null;
  is_cointegrated: boolean;
  stability_pvalue_h1: number | null;
  stability_pvalue_h2: number | null;
  is_stable: boolean | null;
}

export interface ScanResponse {
  pairs: ScanPairResult[];
  tickers: string[];
  sectors: Record<string, string | null>;
}
