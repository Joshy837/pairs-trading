# Pairs Trading Dashboard

Full-stack statistical arbitrage backtester. FastAPI backend + Next.js (App Router) frontend.

## Architecture

```
backend/   FastAPI (Python)
  main.py          — three endpoints: POST /api/analyze, POST /api/backtest, POST /api/scan
  data.py          — yfinance price fetching (free, no API key)
  cointegration.py — ADF + Johansen tests, hedge ratio, spread, z-score, half-life
  backtest.py      — backtest engine, Sharpe ratio, max drawdown, equity curve

frontend/  Next.js App Router (TypeScript)
  app/page.tsx          — backtester page, all state in useState
  app/scanner/page.tsx  — multi-ticker pair scanner (matrix + table views)
  components/           — CointegrationPanel, SpreadChart, ResultsPanel, EquityCurve,
                          ParameterControls, TickerInput, MultiTickerInput,
                          PairMatrix, PairTable, Navbar
  types/index.ts        — shared types: AnalysisResult, BacktestResult, Parameters,
                          Trade, ScanPairResult, ScanResponse
```

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

Frontend stores `insample_pct` as an integer (50–90) and divides by 100 before sending to the API.

## Signal logic

1. Compute hedge ratio β on the first `insample_pct` of the price series
2. Compute spread and rolling z-score over the full series
3. Generate signals only in the out-of-sample window:
   - Enter long if z < −entry_z; enter short if z > +entry_z
   - Exit normally if |z| < exit_z (mean reversion)
   - Exit via stop-loss if |z| ≥ stop_z (spread diverging); flagged as `stop_triggered=True` in trade log
4. Transaction cost deducted whenever the held position changes
