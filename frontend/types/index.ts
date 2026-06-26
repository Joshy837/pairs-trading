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
  half_life: number | null;
}

export interface Trade {
  date: string;
  type: "long" | "short";
  entry_z: number;
  exit_date?: string;
  exit_z?: number;
  stop_triggered?: boolean;
  max_hold_triggered?: boolean;
  pnl?: number | null;
}

export interface BacktestMetrics {
  sharpe_ratio: number;
  max_drawdown: number;
  total_return: number;
  num_trades: number;
  win_rate: number | null;
  avg_trade_duration: number | null;
  profit_factor: number | null;
  calmar_ratio: number | null;
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
  benchmark: (number | null)[] | null;
  effective_max_hold: number | null;
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
  use_log_prices: boolean;
  max_hold_mode: "off" | "auto" | "custom";
  max_holding_days: number; // only used when max_hold_mode === "custom"
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
  correlation?: number;
}

export interface FactorLoadings {
  market: number;
  sector: number;
  momentum: number;
  alpha: number;
  r_squared: number;
}

export interface FactorAnalysisResult {
  ticker1: string;
  ticker2: string;
  factor_loadings: {
    ticker1: FactorLoadings;
    ticker2: FactorLoadings;
  };
  hedge_ratio: number;
  adf: ADFResult;
  half_life: number | null;
  current_zscore: number | null;
  spread: (number | null)[];
  zscore: (number | null)[];
  resid1: (number | null)[];
  resid2: (number | null)[];
  dates: string[];
}

export interface FactorStockResult {
  ticker: string;
  sector_etf: string;
  factor_loadings: FactorLoadings;
  residual: (number | null)[];
  zscore: (number | null)[];
  dates: string[];
  adf: ADFResult;
  half_life: number | null;
  current_zscore: number | null;
}

export interface FactorBacktestResult {
  equity_curve: (number | null)[];
  dates: string[];
  trades: Trade[];
  metrics: BacktestMetrics;
  insample_end_date: string;
  benchmark: (number | null)[] | null;
}

export interface LogEntry {
  kind: "info" | "header" | "pass" | "fail" | "summary";
  text: string;
  detail?: string;
}

export interface ScanResponse {
  pairs: ScanPairResult[];
  tickers: string[];
  sectors: Record<string, string | null>;
}
