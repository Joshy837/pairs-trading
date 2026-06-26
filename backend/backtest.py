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

from cointegration import compute_half_life, compute_hedge_ratio, compute_kalman_hedge, compute_spread, compute_zscore
from regime import detect_regimes


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
    use_regime: bool = False,
    use_log_prices: bool = False,
    max_holding_days: "int | None" = None,
    use_halflife_hold: bool = False,
    halflife_multiplier: float = 2.0,
    spy: "pd.Series | None" = None,
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

    # When using log prices, all spread/hedge computations operate on log(P).
    # Spread returns become log returns (Δlog spread = log_ret1 − β·log_ret2).
    if use_log_prices:
        p1 = np.log(price1)
        p2 = np.log(price2)
        ret1 = p1.diff()
        ret2 = p2.diff()
    else:
        p1, p2 = price1, price2
        ret1 = price1.pct_change()
        ret2 = price2.pct_change()

    if use_kalman:
        # Time-varying β: Kalman filter is causal, no lookahead bias
        kalman_beta = compute_kalman_hedge(p1, p2)
        spread = (p1 - kalman_beta * p2).rename("spread")
        hedge_ratio = float(kalman_beta.iloc[insample_cutoff - 1])  # β at in-sample end
        spread_returns = ret1 - kalman_beta * ret2
    else:
        # Static OLS β estimated on in-sample period only
        hedge_ratio = compute_hedge_ratio(
            p1.iloc[:insample_cutoff], p2.iloc[:insample_cutoff]
        )
        spread = compute_spread(p1, p2, hedge_ratio)
        spread_returns = ret1 - hedge_ratio * ret2

    # Z-score computed over the full period (rolling, no look-ahead)
    zscore = compute_zscore(spread, zscore_window)

    if use_halflife_hold:
        hl = compute_half_life(spread.iloc[:insample_cutoff])
        if hl is not None and hl > 0:
            max_holding_days = max(5, round(halflife_multiplier * hl))

    # Regime: fit HMM on in-sample spread, decode full series
    regime: list[int | None] | None = None
    if use_regime:
        regime = detect_regimes(spread, insample_cutoff)

    # --- Signal generation (out-of-sample only) ---
    position = pd.Series(0.0, index=price1.index)
    current_pos = 0.0
    entry_day: "int | None" = None
    trades: list[dict] = []

    for i in range(insample_cutoff, len(zscore)):
        z = zscore.iloc[i]
        if math.isnan(z):
            continue

        # Gate new entries: only open positions in favorable (mean-reverting) regime
        in_favorable_regime = (
            regime is None
            or regime[i] is None
            or regime[i] == 1
        )

        if current_pos == 0.0:
            if not in_favorable_regime:
                continue
            if z > entry_z:
                current_pos = -1.0
                entry_day = i
                trades.append({
                    "date": price1.index[i].strftime("%Y-%m-%d"),
                    "type": "short",
                    "entry_z": round(z, 3),
                    "stop_triggered": False,
                    "max_hold_triggered": False,
                })
            elif z < -entry_z:
                current_pos = 1.0
                entry_day = i
                trades.append({
                    "date": price1.index[i].strftime("%Y-%m-%d"),
                    "type": "long",
                    "entry_z": round(z, 3),
                    "stop_triggered": False,
                    "max_hold_triggered": False,
                })
        else:
            # Max holding period: force close if trade has run too long
            if max_holding_days is not None and entry_day is not None and (i - entry_day) >= max_holding_days:
                if trades:
                    trades[-1]["exit_date"] = price1.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                    trades[-1]["max_hold_triggered"] = True
                current_pos = 0.0
                entry_day = None
            # Stop-loss: spread diverging past stop_z
            elif abs(z) >= stop_z:
                if trades:
                    trades[-1]["exit_date"] = price1.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                    trades[-1]["stop_triggered"] = True
                current_pos = 0.0
                entry_day = None
            # Normal mean-reversion exit
            elif abs(z) < exit_z:
                if trades:
                    trades[-1]["exit_date"] = price1.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                current_pos = 0.0
                entry_day = None

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

    # Extended trade metrics (completed trades only)
    completed = [t for t in trades if t.get("pnl") is not None]
    pnls = [t["pnl"] for t in completed]

    win_rate = None
    profit_factor = None
    avg_trade_duration = None

    if pnls:
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p <= 0]
        win_rate = round(len(wins) / len(pnls), 4)
        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        if gross_loss > 0:
            profit_factor = round(gross_profit / gross_loss, 3)
        # gross_loss == 0 → all wins; leave profit_factor as None (frontend shows "∞")

        durations = []
        for t in completed:
            ei = date_to_idx.get(t["date"])
            xi = date_to_idx.get(t.get("exit_date", ""))
            if ei is not None and xi is not None:
                durations.append(xi - ei)
        if durations:
            avg_trade_duration = round(sum(durations) / len(durations))

    # Calmar ratio: annualised return / |max drawdown|
    total_return_val = float(oos_equity.iloc[-1] / 100 - 1)
    max_dd_val = compute_max_drawdown(oos_equity)
    oos_days = max(len(oos_returns), 1)
    if total_return_val > -1:
        annualized_return = float((1 + total_return_val) ** (252 / oos_days) - 1)
    else:
        annualized_return = -1.0
    calmar_ratio = round(annualized_return / abs(max_dd_val), 3) if max_dd_val < 0 else None

    # Benchmark: align SPY to pair's date index, normalise to $100 at OOS start
    benchmark_list: list | None = None
    if spy is not None:
        try:
            spy_aligned = spy.reindex(price1.index).ffill()
            spy_start = float(spy_aligned.iloc[insample_cutoff])
            if spy_start > 0 and not math.isnan(spy_start):
                spy_norm = spy_aligned / spy_start * 100
                benchmark_list = _to_json_list(spy_norm)
                for idx in range(insample_cutoff):
                    benchmark_list[idx] = None
        except Exception:
            pass  # silently skip if alignment fails

    return {
        "equity_curve": equity_list,
        "dates": price1.index.strftime("%Y-%m-%d").tolist(),
        "trades": trades,
        "metrics": {
            "sharpe_ratio": round(compute_sharpe(oos_returns), 3),
            "max_drawdown": round(max_dd_val, 4),
            "total_return": round(total_return_val, 4),
            "num_trades": len(trades),
            "win_rate": win_rate,
            "avg_trade_duration": avg_trade_duration,
            "profit_factor": profit_factor,
            "calmar_ratio": calmar_ratio,
        },
        "spread": _to_json_list(spread),
        "zscore": _to_json_list(zscore),
        "hedge_ratio": round(hedge_ratio, 6),
        "insample_end_date": insample_end_date,
        "regime": regime,
        "benchmark": benchmark_list,
        "effective_max_hold": max_holding_days,
    }
