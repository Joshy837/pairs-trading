"""
Pairs trading backtest engine.

Strategy:
  1. Compute OLS hedge ratio β on the full sample (note: this introduces
     in-sample bias — acceptable for a demo, but a rolling hedge ratio
     would be more realistic in production).
  2. Spread = price1 − β·price2
  3. Rolling z-score with `zscore_window` days
  4. Entry:  z >  entry_z  →  short spread  (expect mean reversion downward)
             z < −entry_z  →  long spread   (expect mean reversion upward)
  5. Exit:   |z| < exit_z  →  close position

Portfolio mechanics:
  - Spread daily return ≈ pct_return1 − β·pct_return2
    (dollar-neutral approximation: long $1 of ticker1, short $β of ticker2)
  - No transaction costs or slippage
  - Position signal is lagged by 1 day (signal at close T → position held T+1)
  - Equity curve starts at $100
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from cointegration import compute_hedge_ratio, compute_spread, compute_zscore


def _to_json_list(s: pd.Series) -> list:
    return [None if math.isnan(x) else float(x) for x in s]


def compute_sharpe(returns: pd.Series, periods_per_year: int = 252) -> float:
    """
    Annualised Sharpe ratio assuming risk-free rate = 0.

    sharpe = mean(r) / std(r) × √periods_per_year
    """
    std = returns.std()
    if std == 0 or returns.empty:
        return 0.0
    return float(returns.mean() / std * math.sqrt(periods_per_year))


def compute_max_drawdown(equity: pd.Series) -> float:
    """
    Maximum peak-to-trough drawdown as a negative fraction.

    max_dd = min((equity_t − peak_t) / peak_t)
    """
    peak = equity.cummax()
    drawdown = (equity - peak) / peak
    return float(drawdown.min())


def run_backtest(
    price1: pd.Series,
    price2: pd.Series,
    zscore_window: int = 30,
    entry_z: float = 2.0,
    exit_z: float = 0.5,
) -> dict:
    """
    Simulate the pairs trading strategy and return performance results.

    Parameters
    ----------
    price1, price2 : aligned price Series
    zscore_window  : rolling window for z-score computation (days)
    entry_z        : z-score magnitude that triggers a trade
    exit_z         : z-score magnitude below which position is closed

    Returns
    -------
    dict with keys: equity_curve, dates, trades, metrics, spread, zscore, hedge_ratio
    """
    if exit_z >= entry_z:
        raise ValueError("exit_z must be strictly less than entry_z.")

    hedge_ratio = compute_hedge_ratio(price1, price2)
    spread = compute_spread(price1, price2, hedge_ratio)
    zscore = compute_zscore(spread, zscore_window)

    # Spread daily return: position in (price1 − β·price2) space
    ret1 = price1.pct_change()
    ret2 = price2.pct_change()
    spread_returns = ret1 - hedge_ratio * ret2

    # --- Signal generation ---
    position = pd.Series(0.0, index=price1.index)
    current_pos = 0.0
    trades: list[dict] = []

    for i in range(zscore_window, len(zscore)):
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
                })
            elif z < -entry_z:
                current_pos = 1.0
                trades.append({
                    "date": price1.index[i].strftime("%Y-%m-%d"),
                    "type": "long",
                    "entry_z": round(z, 3),
                })
        else:
            if abs(z) < exit_z:
                if trades:
                    trades[-1]["exit_date"] = price1.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                current_pos = 0.0

        position.iloc[i] = current_pos

    # Lag position by 1 day: signal at close T applied to return at T+1
    portfolio_returns = position.shift(1).fillna(0) * spread_returns.fillna(0)

    equity = (1 + portfolio_returns).cumprod() * 100

    return {
        "equity_curve": _to_json_list(equity),
        "dates": price1.index.strftime("%Y-%m-%d").tolist(),
        "trades": trades,
        "metrics": {
            "sharpe_ratio": round(compute_sharpe(portfolio_returns), 3),
            "max_drawdown": round(compute_max_drawdown(equity), 4),
            "total_return": round(float(equity.iloc[-1] / 100 - 1), 4),
            "num_trades": len(trades),
        },
        "spread": _to_json_list(spread),
        "zscore": _to_json_list(zscore),
        "hedge_ratio": round(hedge_ratio, 6),
    }
