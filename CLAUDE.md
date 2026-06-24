# Pairs Trading Dashboard

Full-stack statistical arbitrage backtester. FastAPI backend + Next.js (App Router) frontend.

## Architecture

```
backend/   FastAPI (Python)
  main.py          — two endpoints: POST /api/analyze, POST /api/backtest
  data.py          — yfinance price fetching (free, no API key)
  cointegration.py — ADF + Johansen tests, hedge ratio, spread, z-score
  backtest.py      — backtest engine, Sharpe ratio, max drawdown, equity curve

frontend/  Next.js App Router (TypeScript)
  app/page.tsx     — single page, all state in useState
  components/      — CointegrationPanel, SpreadChart, ResultsPanel, EquityCurve,
                     ParameterControls, TickerInput
  types/index.ts   — shared types: AnalysisResult, BacktestResult, Parameters, Trade
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

All frontend styling goes through a unified token set — never use raw Tailwind gray/indigo color classes directly.

**Files:**
- `frontend/tailwind.config.js` — semantic color tokens (source of truth)
- `frontend/app/globals.css` — `@layer components` with `.label` and `.section-heading`
- `frontend/lib/tokens.ts` — `CHART_COLORS` and `CHART_AXIS` constants for Recharts

**Color tokens** (use these, not raw Tailwind palette names):

| Token | Meaning | Tailwind equivalent |
|---|---|---|
| `primary` / `primary-dark` | Brand CTA (buttons, focus rings, sliders) | indigo-600 / indigo-700 |
| `surface` | Page bg, metric tile bg | gray-50 |
| `panel` | Card bg | white |
| `divider` | Card/table borders | gray-100 |
| `subtle` | Card titles, section headings | gray-700 |
| `muted` | Labels, chart axis text | gray-500 |
| `faint` | Hints, range ends, placeholder text | gray-400 |

Status colors (green/red/amber) stay as Tailwind built-ins — they are already semantic and only used inside self-contained status components (Badge, verdict panel, warning callout).

**Component classes:**
- `.label` — form field labels: `text-xs font-medium text-muted uppercase tracking-wide`
- `.section-heading` — card sub-sections: `text-xs font-semibold text-subtle uppercase tracking-wide`

**Chart constants:** import `CHART_COLORS` and `CHART_AXIS` from `@/lib/tokens` in any Recharts component. Never hardcode hex strings in chart files.

## Key implementation details

- Python 3.9 compat: use `from __future__ import annotations` for lowercase generics
- yfinance returns MultiIndex columns for multi-ticker downloads — access via `raw["Close"]`
- Spread = price1 − β·price2; β = OLS hedge ratio (in-sample, acceptable for demo)
- Rolling z-score window minimum: 10 days; lookback must be ≥ 3× zscore_window
- Equity curve starts at $100; position lagged 1 day (signal at close T → position at T+1)
- Backend venv is at backend/venv/ — always activate before running pip or uvicorn
