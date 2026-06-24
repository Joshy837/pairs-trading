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
}

export interface Trade {
  date: string;
  type: "long" | "short";
  entry_z: number;
  exit_date?: string;
  exit_z?: number;
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
}

export interface Parameters {
  lookback_days: number;
  zscore_window: number;
  entry_z: number;
  exit_z: number;
}

export interface ScanPairResult {
  ticker1: string;
  ticker2: string;
  pvalue: number;
  hedge_ratio: number;
  zscore: number | null;
  half_life: number | null;
  is_cointegrated: boolean;
}

export interface ScanResponse {
  pairs: ScanPairResult[];
  tickers: string[];
}
