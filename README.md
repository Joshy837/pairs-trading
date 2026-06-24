# Pairs Trading Dashboard

A statistical arbitrage backtester with a FastAPI backend and Next.js frontend. Enter two tickers to test for cointegration, tune entry/exit parameters, and simulate a mean-reversion pairs trade — all in the browser.

## Features

- **Cointegration analysis** — ADF and Johansen tests, hedge ratio, spread, z-score, and half-life estimation
- **Backtester** — out-of-sample equity curve, Sharpe ratio, max drawdown, trade log with stop-loss flags
- **Pair scanner** — scan up to 12 tickers at once; ranks all N(N−1)/2 pairs by cointegration p-value with matrix and table views
- **No paid data** — price data sourced from yfinance (free, no API key required)

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, statsmodels, pandas, yfinance |
| Frontend | Next.js 14 (App Router), TypeScript, Recharts, Tailwind CSS |
| Deploy | Render (backend), Vercel (frontend) |

## Local setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

API runs at `http://localhost:8000`. Interactive docs at `/docs`.

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # points to localhost:8000 by default
npm run dev
```

App runs at `http://localhost:3000`.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/analyze` | Cointegration tests + spread/z-score time series |
| `POST` | `/api/backtest` | Full backtest: equity curve + performance metrics |
| `POST` | `/api/scan` | Batch cointegration scan over a list of tickers |
| `GET` | `/health` | Health check |

## Backtest parameters

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `lookback_days` | 365 | 90–1825 | Must be ≥ 3× `zscore_window` |
| `zscore_window` | 30 | 10–120 | Rolling window for z-score |
| `entry_z` | 2.0 | 0.5–4.0 | Z-score threshold to open a position |
| `exit_z` | 0.5 | 0.0–2.0 | Z-score threshold to exit on mean reversion |
| `stop_z` | 4.0 | 2.5–6.0 | Z-score threshold to exit on stop-loss |
| `transaction_cost_bps` | 5 | 0–50 | One-way cost per position change (basis points) |
| `insample_pct` | 0.70 | 0.5–0.9 | Fraction of data used to estimate the hedge ratio |

## Signal logic

1. Estimate hedge ratio β via OLS on the in-sample window
2. Compute spread = price₁ − β·price₂ and rolling z-score over the full series
3. Generate signals only in the out-of-sample window:
   - **Long** the spread when z < −`entry_z`
   - **Short** the spread when z > +`entry_z`
   - **Exit** when |z| < `exit_z` (mean reversion)
   - **Stop-loss** when |z| ≥ `stop_z` (spread diverging)

Equity curve starts at $100 at the first out-of-sample bar. Positions are lagged one day (signal at close T → fill at T+1).

## Deployment

The backend is configured for Render via `backend/render.yaml`. Set `NEXT_PUBLIC_API_URL` in your Vercel environment to point the frontend at your Render service URL.
