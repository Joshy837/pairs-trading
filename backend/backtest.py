"""
Pairs trading backtest engine.

Strategy:
  1. Compute OLS hedge ratio β on the in-sample period only (walk-forward split).
  2. Spread = price1 − β·price2
  3. Rolling z-score with `zscore_window` days
  4. Entry:  z >  entry_z  →  short spread  (expect mean reversion downward)
             z < −entry_z  →  long spread   (expect mean reversion upward)
  5. Exit:   |z| < exit_z  →  close position (mean reversion)
             |z| ≥ stop_z  →  stop-loss exit (spread diverging)

Portfolio mechanics:
  - Spread daily return ≈ pct_return1 − β·pct_return2
    (dollar-neutral approximation: long $1 of ticker1, short $β of ticker2)
  - Transaction cost deducted each time position changes (entry and exit)
  - Position signal is lagged by 1 day (signal at close T → position held T+1)
  - Equity curve starts at $100 at the out-of-sample start date
  - Metrics reported on out-of-sample period only
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from cointegration import compute_hedge_ratio, compute_kalman_hedge, compute_spread, compute_zscore


def _to_json_list(s: pd.Series) -> list:
    return [None if math.isnan(x) else float(x) for x in s]


def compute_sharpe(returns: pd.Series, periods_per_year: int = 252) -> float:
    """Annualised Sharpe ratio (risk-free rate = 0)."""
    std = returns.std()
    if std == 0 or returns.empty:
        return 0.0
    return float(returns.mean() / std * math.sqrt(periods_per_year))


def compute_max_drawdown(equity: pd.Series) -> float:
    """Maximum peak-to-trough drawdown as a negative fraction."""
    peak = equity.cummax()
    drawdown = (equity - peak) / peak
    return float(drawdown.min())


def run_backtest(
    price1: pd.Series,
    price2: pd.Series,
    zscore_window: int = 30,
    entry_z: float = 2.0,
    exit_z: float = 0.5,
    stop_z: float = 4.0,
    transaction_cost_bps: float = 5.0,
    insample_pct: float = 0.7,
    use_kalman: bool = False,
) -> dict:
    """
    Simulate the pairs trading strategy and return performance results.

    Parameters
    ----------
    price1, price2       : aligned price Series
    zscore_window        : rolling window for z-score computation (days)
    entry_z              : z-score magnitude that triggers a trade
    exit_z               : z-score magnitude below which position is closed
    stop_z               : z-score magnitude that forces a stop-loss exit
    transaction_cost_bps : one-way cost in basis points per trade leg
    insample_pct         : fraction of data used to estimate hedge ratio (walk-forward)

    Returns
    -------
    dict with keys: equity_curve, dates, trades, metrics, spread, zscore,
                    hedge_ratio, insample_end_date
    """
    if exit_z >= entry_z:
        raise ValueError("exit_z must be strictly less than entry_z.")
    if entry_z >= stop_z:
        raise ValueError("stop_z must be strictly greater than entry_z.")

    # Walk-forward split: OOS trading begins at insample_cutoff
    insample_cutoff = max(zscore_window * 2, int(len(price1) * insample_pct))
    insample_cutoff = min(insample_cutoff, len(price1) - zscore_window)

    ret1 = price1.pct_change()
    ret2 = price2.pct_change()

    if use_kalman:
        # Time-varying β: Kalman filter is causal, no lookahead bias
        kalman_beta = compute_kalman_hedge(price1, price2)
        spread = (price1 - kalman_beta * price2).rename("spread")
        hedge_ratio = float(kalman_beta.iloc[insample_cutoff - 1])  # β at in-sample end
        spread_returns = ret1 - kalman_beta * ret2
    else:
        # Static OLS β estimated on in-sample period only
        hedge_ratio = compute_hedge_ratio(
            price1.iloc[:insample_cutoff], price2.iloc[:insample_cutoff]
        )
        spread = compute_spread(price1, price2, hedge_ratio)
        spread_returns = ret1 - hedge_ratio * ret2

    # Z-score computed over the full period (rolling, no look-ahead)
    zscore = compute_zscore(spread, zscore_window)

    # --- Signal generation (out-of-sample only) ---
    position = pd.Series(0.0, index=price1.index)
    current_pos = 0.0
    trades: list[dict] = []

    for i in range(insample_cutoff, len(zscore)):
        z = zscore.iloc[i]
        if math.isnan(z):
            continue

        if current_pos == 0.0:
            if z > entry_z:
                current_pos = -1.0
                trades.append({
                    "date": price1.index[i].strftime("%Y-%m-%d"),
                    "type": "short",
                    "entry_z": round(z, 3),
                    "stop_triggered": False,
                })
            elif z < -entry_z:
                current_pos = 1.0
                trades.append({
                    "date": price1.index[i].strftime("%Y-%m-%d"),
                    "type": "long",
                    "entry_z": round(z, 3),
                    "stop_triggered": False,
                })
        else:
            # Stop-loss: spread diverging past stop_z
            if abs(z) >= stop_z:
                if trades:
                    trades[-1]["exit_date"] = price1.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                    trades[-1]["stop_triggered"] = True
                current_pos = 0.0
            # Normal mean-reversion exit
            elif abs(z) < exit_z:
                if trades:
                    trades[-1]["exit_date"] = price1.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                current_pos = 0.0

        position.iloc[i] = current_pos

    # Lag position by 1 day: signal at close T → position held T+1
    pos_shifted = position.shift(1).fillna(0)

    # Transaction costs: deducted each time the held position changes
    cost_per_unit = transaction_cost_bps / 10000
    trade_cost = pos_shifted.diff().abs() * cost_per_unit

    portfolio_returns = pos_shifted * spread_returns.fillna(0) - trade_cost.fillna(0)

    # Zero out in-sample returns so the equity curve starts at $100 at OOS start
    portfolio_returns.iloc[:insample_cutoff] = 0.0

    equity = (1 + portfolio_returns).cumprod() * 100

    # Mask in-sample equity as null so charts only render the OOS period
    equity_list = _to_json_list(equity)
    for idx in range(insample_cutoff):
        equity_list[idx] = None

    insample_end_date = price1.index[insample_cutoff - 1].strftime("%Y-%m-%d")

    # Per-trade P&L: equity change from entry signal day to exit day
    date_to_idx = {price1.index[i].strftime("%Y-%m-%d"): i for i in range(len(price1))}
    for trade in trades:
        entry_i = date_to_idx.get(trade["date"])
        exit_date = trade.get("exit_date")
        if entry_i is not None and exit_date is not None:
            exit_i = date_to_idx.get(exit_date)
            if exit_i is not None:
                entry_eq = float(equity.iloc[entry_i])
                exit_eq = float(equity.iloc[exit_i])
                trade["pnl"] = round(exit_eq / entry_eq - 1, 4) if entry_eq != 0 else None
            else:
                trade["pnl"] = None
        else:
            trade["pnl"] = None

    oos_returns = portfolio_returns.iloc[insample_cutoff:]
    oos_equity = equity.iloc[insample_cutoff:]

    return {
        "equity_curve": equity_list,
        "dates": price1.index.strftime("%Y-%m-%d").tolist(),
        "trades": trades,
        "metrics": {
            "sharpe_ratio": round(compute_sharpe(oos_returns), 3),
            "max_drawdown": round(compute_max_drawdown(oos_equity), 4),
            "total_return": round(float(oos_equity.iloc[-1] / 100 - 1), 4),
            "num_trades": len(trades),
        },
        "spread": _to_json_list(spread),
        "zscore": _to_json_list(zscore),
        "hedge_ratio": round(hedge_ratio, 6),
        "insample_end_date": insample_end_date,
    }
