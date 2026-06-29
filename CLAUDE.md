# Pairs Trading Dashboard

Full-stack statistical arbitrage backtester. FastAPI backend + Next.js (App Router) frontend.

## Architecture

```
backend/   FastAPI (Python)
  main.py          — API endpoints (see list below)
  data.py          — yfinance price fetching; fetch_prices, fetch_prices_batch,
                     fetch_benchmark, fetch_factor_prices, fetch_factor_stock_prices,
                     fetch_sectors (parallel, ThreadPoolExecutor)
  cointegration.py — ADF + Johansen tests, hedge ratio, spread, z-score, half-life,
                     Kalman filter hedge ratio, rolling OLS hedge ratio
  backtest.py      — backtest engine, Sharpe, max drawdown, calmar, win rate,
                     profit factor, avg duration, equity curve, SPY benchmark overlay
  regime.py        — 2-state Gaussian HMM (Baum-Welch + Viterbi) for regime detection
  factor.py        — 3-factor model (market/sector/momentum); residual spread stats,
                     single-stock and pair decomposition, factor-neutral backtest

frontend/  Next.js App Router (TypeScript)
  app/page.tsx          — backtester page, all state in useState
  app/scanner/page.tsx  — multi-ticker pair scanner (matrix + table views); SSE streaming
  app/factor/page.tsx   — single-stock 3-factor analysis + ε backtest; SSE streaming
  components/           — CointegrationPanel, SpreadChart, ResultsPanel, EquityCurve,
                          ParameterControls, TickerInput, MultiTickerInput,
                          PairMatrix, PairTable, Navbar,
                          HedgeStabilityChart, ResidualPerStockChart, ResidualSpreadChart,
                          ResidualStockChart, ScanProgress, Select, TradeLog
  types/index.ts        — shared types: AnalysisResult, BacktestResult, Parameters,
                          Trade, ScanPairResult, ScanResponse, FactorAnalysisResult,
                          FactorStockResult, FactorBacktestResult, FactorLoadings, LogEntry
  lib/tokens.ts         — CHART_COLORS and CHART_AXIS constants for Recharts
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/analyze` | Cointegration tests + spread/z-score time series |
| POST | `/api/backtest` | Full backtest; returns equity curve + metrics |
| POST | `/api/scan` | Batch cointegration scan (all N(N-1)/2 pairs); BH correction |
| POST | `/api/scan/stream` | SSE streaming scan: correlation pre-filter → coint → BH |
| POST | `/api/factor-analyze` | 3-factor pair decomposition + residual spread stats |
| POST | `/api/factor-analyze/stream` | SSE stream of 3-factor pair analysis |
| POST | `/api/factor-stock/stream` | SSE stream of single-stock 3-factor analysis |
| POST | `/api/factor-stock/backtest` | Mean-reversion backtest on single-stock factor residual ε |

## Running locally

```bash
# Backend
cd backend && source venv/bin/activate && uvicorn main:app --reload

# Frontend
cd frontend && npm run dev
```

## Version control

This project is a git repository. Use standard git workflows for commits and pushes.

## Hard constraints — never violate these

- No paid data APIs — yfinance only
- No live trading — backtesting only
- No database — stateless API calls
- No user auth or persistence
- No Redux — React useState only
- All quant logic stays in FastAPI backend, not frontend
- Keep backtest engine isolated in backtest.py

## Design system

**This is a hard constraint. Every frontend file you write or edit must comply before you consider the task done.**

All frontend styling goes through a unified token set. Before finishing any frontend change, scan the touched files for violations and fix them in the same pass.

**Files:**
- `frontend/tailwind.config.js` — semantic color tokens (source of truth)
- `frontend/app/globals.css` — `@layer components` with `.label` and `.section-heading`
- `frontend/lib/tokens.ts` — `CHART_COLORS` and `CHART_AXIS` constants for Recharts

**Color tokens — always use these, never the raw Tailwind equivalents:**

| Token | Meaning | Raw equivalent (FORBIDDEN) |
|---|---|---|
| `primary` / `primary-dark` | Brand CTA (buttons, focus rings, sliders) | indigo-* |
| `surface` | Page bg, metric tile bg | gray-900 |
| `panel` | Card bg | gray-800 |
| `divider` | Card/table borders | gray-700 |
| `ink` | Header/navbar bg | (near-black) |
| `subtle` | Card titles, headings, primary text | gray-50 |
| `muted` | Labels, chart axis text | gray-400 |
| `faint` | Hints, placeholders, secondary text | gray-500 |

**Forbidden patterns — never write these in any `.tsx`, `.ts`, or `.css` file:**
- Any `gray-*` Tailwind class: `text-gray-*`, `bg-gray-*`, `border-gray-*`, `ring-gray-*`, etc.
- Any `indigo-*` Tailwind class: `text-indigo-*`, `bg-indigo-*`, `border-indigo-*`, etc.
- Raw `text-white` — use `text-subtle` instead (same visual result, stays in token system)
- Hardcoded hex color strings anywhere in component files

**Allowed exceptions:**
- `green-*`, `red-*`, `amber-*` — status/signal colors only, inside self-contained status components (badges, verdict panels, error callouts). Never for layout or neutral UI.
- Opacity modifiers on tokens are fine: `bg-primary/20`, `bg-divider/40`, etc.

**Component classes — use these instead of repeating the utility string:**
- `.label` — form field labels: `text-xs font-medium text-muted uppercase tracking-wide`
- `.section-heading` — card sub-sections: `text-xs font-semibold text-subtle uppercase tracking-wide`

**Chart constants:** import `CHART_COLORS` and `CHART_AXIS` from `@/lib/tokens` in any Recharts component. Never hardcode hex strings in chart files.

## Key implementation details

- Python 3.9 compat: use `from __future__ import annotations` for lowercase generics
- yfinance returns MultiIndex columns for multi-ticker downloads — access via `raw["Close"]`
- Spread = price1 − β·price2; β = OLS hedge ratio estimated on in-sample window only
- Rolling z-score window minimum: 10 days; lookback must be ≥ 3× zscore_window
- Equity curve starts at $100 at the out-of-sample start; position lagged 1 day (signal at close T → position at T+1)
- All backtest metrics (Sharpe, drawdown, total return) are computed on the out-of-sample period only
- Backend venv is at backend/venv/ — always activate before running pip or uvicorn
- Extended trade metrics returned in every backtest: `win_rate`, `avg_trade_duration`, `profit_factor`, `calmar_ratio`
- SPY benchmark is fetched and normalised to $100 at OOS start; returned as `benchmark` list in backtest response

**Kalman filter hedge ratio** (`use_kalman=True`):
- Implemented in `cointegration.py:compute_kalman_hedge`; state = [β, α], modelled as a random walk
- Causal/online: β_t uses only data up to day t — no lookahead bias
- Warm-started from OLS on the first ~30 points; `delta=1e-4` controls how fast β is allowed to change
- When active, `spread_returns = ret1 − kalman_beta_t · ret2` (time-varying dollar-neutral PnL)

**HMM regime detection** (`use_regime=True`):
- Implemented in `regime.py`; pure NumPy, no extra dependencies
- Feature: rolling 20-day std of spread 1-day changes (low vol → mean-reverting, high vol → trending)
- Parameters fitted with Baum-Welch EM on the in-sample window only (no lookahead)
- Full series decoded with Viterbi using the fixed in-sample parameters
- Regime gates **entries only** — open positions always run to their natural exit
- Returns a `regime` array (1 = mean-reverting, 0 = trending, null = no data) in the backtest response
- Frontend overlays trending periods as amber `ReferenceArea` bands on the Spread and Z-Score charts

**Volatility targeting** (`use_vol_target=True`):
- 20-day realized vol of spread returns used to scale each position: `vol_scalar = 0.01 / realized_vol`
- Scalar capped at 3× to prevent excessive leverage
- Applied to the position series before lagging; `position_size` field in each trade reflects the scalar

**Max holding period** (time-stop):
- Three modes controlled by frontend `max_hold_mode`: `"off"` (default), `"auto"`, `"custom"`
- `"custom"`: pass `max_holding_days` (5–200) directly to API
- `"auto"`: pass `use_halflife_hold=True` + `halflife_multiplier` (0.5–2.0); backend derives `max_holding_days = round(multiplier × half_life)`, minimum 5 days
- Force-close flags the trade with `max_hold_triggered=True`; displayed as "TIME" in TradeLog

**Log prices** (`use_log_prices=True`):
- Applies to both `/api/analyze` and `/api/backtest`
- All spread/hedge computations operate on log(P); spread returns become log returns

**SSE streaming pattern:**
- `/api/scan/stream` events: `fetching` → `corr_result` (one per pair) → `correlation_done` → `coint_result` (one per filtered pair) → `bh_correction` → `complete`
- `/api/factor-analyze/stream` and `/api/factor-stock/stream` events: `fetching` → `step` → `regression` → `adf_result` → `complete`
- `ScanProgress` component renders a `LogEntry[]` array (kind: `info`/`header`/`pass`/`fail`/`summary`) as a scrolling monospace log panel; used on both scanner and factor pages
- `corr_threshold` (0.0–1.0) on scan requests pre-filters pairs by |correlation| before running ADF

## 3-factor model (`factor.py`)

Decomposes each stock's daily returns into systematic factor exposures:

```
R_t = α + β_mkt·R_SPY + β_sec·R_sector + β_mom·R_mom + ε
```

- **Market factor**: SPY daily returns
- **Sector factor**: sector ETF daily returns (one of XLF, XLK, XLE, XLV, XLI, XLP, XLU, XLY, XLB, XLRE, XLC)
- **Momentum factor**: SPY 12-minus-1-month return = `pct_change(231).shift(21)` (Jegadeesh-Titman, lagged 1 month to avoid reversal)
- **ε**: idiosyncratic residual — the part of a stock's return unexplained by factors

Factor data fetch adds 300 extra days to `lookback_days` so the momentum warmup (~273 days) doesn't eat into the analysis window. Minimum effective lookback is 730 days.

**Pair mode** (`/api/factor-analyze`): fits the model on both stocks, then runs OLS on ε₁ vs ε₂ to get a factor-neutral hedge ratio and residual spread. ADF + half-life on the residual spread.

**Single-stock mode** (`/api/factor-stock/stream` + `/api/factor-stock/backtest`): fits model on one ticker, then tests whether ε itself mean-reverts (ADF). If stationary, backtests a z-score mean-reversion strategy directly on ε.

**Factor-neutral trade construction** (shown in UI, Step 3):
- To go long ε: long +1 stock, short β_mkt SPY, short β_sec sector ETF
- Momentum is not a hedgeable asset; residual momentum exposure is accepted

## Backtest parameters

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `lookback_days` | 365 | 90–1825 | Must be ≥ 3× zscore_window |
| `zscore_window` | 30 | 10–120 | Rolling window for z-score |
| `entry_z` | 2.0 | 0.5–4.0 | Triggers a trade |
| `exit_z` | 0.5 | 0.0–2.0 | Mean-reversion exit; must be < entry_z |
| `stop_z` | 4.0 | 2.5–6.0 | Stop-loss exit; must be > entry_z |
| `transaction_cost_bps` | 5 | 0–50 | One-way cost per position change |
| `insample_pct` | 0.7 | 0.5–0.9 | Fraction used to estimate hedge ratio |
| `use_kalman` | false | bool | Use Kalman filter instead of static OLS for hedge ratio |
| `use_regime` | false | bool | Enable 2-state HMM regime filter; suppresses entries in trending regimes |
| `use_log_prices` | false | bool | Use log prices for spread and return computation |
| `use_vol_target` | false | bool | Scale position to target 1% daily vol (20-day realized, capped at 3×) |
| `max_holding_days` | null | 5–200 | Hard cap on trade duration; null = off |
| `use_halflife_hold` | false | bool | Auto-derive max hold from half-life × halflife_multiplier |
| `halflife_multiplier` | 2.0 | 0.5–2.0 | Multiplier when use_halflife_hold is true |

Frontend stores `insample_pct` as an integer (50–90) and divides by 100 before sending to the API.
Frontend uses `max_hold_mode` (`"off"` / `"auto"` / `"custom"`) to drive which API params are sent.

## Signal logic

1. Compute hedge ratio β on the first `insample_pct` of the price series
   - Static OLS (default) or Kalman filter (`use_kalman=True`) — both causal, no lookahead
2. Compute spread and rolling z-score over the full series
3. If `use_halflife_hold=True`: derive `max_holding_days = max(5, round(halflife_multiplier × half_life))`
4. If `use_regime=True`: fit HMM on in-sample spread volatility, decode regime for full series
5. If `use_vol_target=True`: compute 20-day realized vol of spread returns; vol_scalar = 0.01 / vol
6. Generate signals only in the out-of-sample window:
   - Skip entry if regime filter active and current day is trending (regime = 0)
   - Enter long if z < −entry_z; enter short if z > +entry_z
   - Force-close if trade has been open ≥ max_holding_days (flagged `max_hold_triggered=True`)
   - Exit via stop-loss if |z| ≥ stop_z (flagged `stop_triggered=True`)
   - Exit normally if |z| < exit_z (mean reversion)
7. Position scaled by vol_scalar before lagging; transaction cost deducted on position changes
