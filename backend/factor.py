"""
3-factor model analysis for pairs trading.

Each stock's daily returns are decomposed into:
  return = α + β_mkt·r_SPY + β_sec·r_sector + β_mom·momentum + ε

Momentum = SPY 12-minus-1-month return (pct_change(231).shift(21)), the
standard Jegadeesh-Titman signal lagged one month to avoid short-term reversal.

The residuals ε are factor-neutral idiosyncratic returns. The residual spread
(ε1 − hedge_ratio·ε2) is tested for mean-reversion with ADF and half-life.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.tsa.stattools import adfuller


def _to_json_list(s: pd.Series) -> list:
    return [None if math.isnan(x) else float(x) for x in s]


def run_adf(spread: pd.Series) -> dict:
    stat, pvalue, _, _, crit, _ = adfuller(spread.dropna(), autolag="AIC")
    return {
        "test_statistic": float(stat),
        "p_value": float(pvalue),
        "critical_values": {k: float(v) for k, v in crit.items()},
        "is_stationary": bool(pvalue < 0.05),
    }


def half_life(spread: pd.Series) -> "float | None":
    lag = spread.shift(1)
    delta = spread.diff()
    df = pd.concat([lag, delta], axis=1).dropna()
    df.columns = ["lag", "delta"]
    X = sm.add_constant(df["lag"].values)
    model = sm.OLS(df["delta"].values, X).fit()
    gamma = float(model.params[1])
    if gamma >= 0 or gamma <= -1:
        return None
    return float(-math.log(2) / math.log(1 + gamma))


def rolling_zscore(spread: pd.Series, window: int) -> pd.Series:
    mu = spread.rolling(window=window).mean()
    sigma = spread.rolling(window=window).std()
    return ((spread - mu) / sigma).rename("zscore")


def prepare_aligned_returns(
    price1: pd.Series,
    price2: pd.Series,
    spy: pd.Series,
    sector: pd.Series,
    zscore_window: int,
) -> pd.DataFrame:
    """
    Align all price series, compute daily returns, and add the SPY momentum factor.

    Returns a DataFrame with columns [p1, p2, spy, sector, momentum].
    Raises ValueError if fewer than max(60, zscore_window*3) observations remain.
    """
    all_prices = pd.concat(
        [price1.rename("p1"), price2.rename("p2"), spy.rename("spy"), sector.rename("sector")],
        axis=1,
    ).dropna()

    returns = all_prices.pct_change()

    # 12-minus-1-month SPY momentum: (price[t-21] / price[t-252]) - 1
    # pct_change(231).shift(21) = (price[t-21] - price[t-252]) / price[t-252]
    returns["momentum"] = all_prices["spy"].pct_change(231).shift(21)
    returns = returns.dropna()

    min_obs = max(60, zscore_window * 3)
    if len(returns) < min_obs:
        raise ValueError(
            f"Only {len(returns)} observations after computing the momentum factor. "
            "Use a longer lookback window (try 730+ days)."
        )

    return returns


def fit_factor_model(returns: pd.DataFrame, col: str) -> "tuple[object, pd.Series, dict]":
    """
    OLS regression of returns[col] on [SPY, sector, momentum] with intercept.

    Returns (fitted model, residuals Series, loadings dict).
    """
    F = np.column_stack(
        [returns["spy"].values, returns["sector"].values, returns["momentum"].values]
    )
    X = sm.add_constant(F)
    model = sm.OLS(returns[col].values, X).fit()
    resid = pd.Series(model.resid, index=returns.index, name=f"resid_{col}")
    loadings = {
        "market": round(float(model.params[1]), 4),
        "sector": round(float(model.params[2]), 4),
        "momentum": round(float(model.params[3]), 4),
        "alpha": round(float(model.params[0]), 6),
        "r_squared": round(float(model.rsquared), 4),
    }
    return model, resid, loadings


def compute_spread_stats(
    resid1: pd.Series,
    resid2: pd.Series,
    zscore_window: int,
) -> dict:
    """
    Compute residual spread, ADF test, half-life, and z-score.

    Returns a dict with keys: hedge_ratio, spread, zscore, dates, adf,
    half_life, current_zscore.
    """
    X_r = sm.add_constant(resid2.values)
    m_r = sm.OLS(resid1.values, X_r).fit()
    hedge_ratio = float(m_r.params[1])

    spread = (resid1 - hedge_ratio * resid2).rename("spread")
    zscore = rolling_zscore(spread, zscore_window)
    adf = run_adf(spread)
    hl = half_life(spread)

    valid_z = zscore.dropna()
    current_z = float(valid_z.iloc[-1]) if not valid_z.empty else None

    return {
        "hedge_ratio": round(hedge_ratio, 4),
        "spread": _to_json_list(spread),
        "zscore": _to_json_list(zscore),
        "resid1": _to_json_list(resid1),
        "resid2": _to_json_list(resid2),
        "dates": spread.index.strftime("%Y-%m-%d").tolist(),
        "adf": adf,
        "half_life": round(hl, 1) if hl is not None else None,
        "current_zscore": round(current_z, 3) if current_z is not None else None,
    }


def prepare_aligned_returns_single(
    price: pd.Series,
    spy: pd.Series,
    sector: pd.Series,
    zscore_window: int,
) -> pd.DataFrame:
    """
    Align a single stock's prices with SPY and sector ETF, compute daily returns,
    and add the SPY momentum factor.

    Returns a DataFrame with columns [p1, spy, sector, momentum].
    """
    all_prices = pd.concat(
        [price.rename("p1"), spy.rename("spy"), sector.rename("sector")],
        axis=1,
    ).dropna()

    returns = all_prices.pct_change()
    returns["momentum"] = all_prices["spy"].pct_change(231).shift(21)
    returns = returns.dropna()

    min_obs = max(60, zscore_window * 3)
    if len(returns) < min_obs:
        raise ValueError(
            f"Only {len(returns)} observations after computing the momentum factor. "
            "Use a longer lookback window (try 730+ days)."
        )

    return returns


def analyze_factor_stock(
    price: pd.Series,
    spy: pd.Series,
    sector: pd.Series,
    zscore_window: int,
    ticker: str,
    sector_etf: str,
) -> dict:
    """
    Single-stock 3-factor decomposition.

    Fits R_ticker = α + β_mkt·R_SPY + β_sec·R_sector + β_mom·R_mom + ε and
    tests whether ε mean-reverts (ADF) and computes its rolling z-score.
    """
    returns = prepare_aligned_returns_single(price, spy, sector, zscore_window)
    _, resid, loadings = fit_factor_model(returns, "p1")

    zscore_series = rolling_zscore(resid, zscore_window)
    adf_result = run_adf(resid)
    hl = half_life(resid)

    valid_z = zscore_series.dropna()
    current_z = float(valid_z.iloc[-1]) if not valid_z.empty else None

    return {
        "ticker": ticker.upper(),
        "sector_etf": sector_etf.upper(),
        "factor_loadings": loadings,
        "residual": _to_json_list(resid),
        "zscore": _to_json_list(zscore_series),
        "dates": resid.index.strftime("%Y-%m-%d").tolist(),
        "adf": adf_result,
        "half_life": round(hl, 1) if hl is not None else None,
        "current_zscore": round(current_z, 3) if current_z is not None else None,
    }


def run_factor_backtest(
    resid: pd.Series,
    zscore_window: int,
    entry_z: float,
    exit_z: float,
    stop_z: float,
    transaction_cost_bps: float,
    insample_pct: float,
) -> dict:
    """
    Backtest a mean-reversion strategy on the factor-neutral residual ε.

    Signals are generated from the rolling z-score of the residual return series.
    Position P&L = position * ε_t (daily factor-neutral return).
    Only out-of-sample performance is reported.
    """
    from backtest import compute_max_drawdown, compute_sharpe

    if exit_z >= entry_z:
        raise ValueError("exit_z must be strictly less than entry_z.")
    if entry_z >= stop_z:
        raise ValueError("stop_z must be strictly greater than entry_z.")

    insample_cutoff = max(zscore_window * 2, int(len(resid) * insample_pct))
    insample_cutoff = min(insample_cutoff, len(resid) - zscore_window)

    zscore = rolling_zscore(resid, zscore_window)

    position = pd.Series(0.0, index=resid.index)
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
                    "date": resid.index[i].strftime("%Y-%m-%d"),
                    "type": "short",
                    "entry_z": round(z, 3),
                    "stop_triggered": False,
                })
            elif z < -entry_z:
                current_pos = 1.0
                trades.append({
                    "date": resid.index[i].strftime("%Y-%m-%d"),
                    "type": "long",
                    "entry_z": round(z, 3),
                    "stop_triggered": False,
                })
        else:
            if abs(z) >= stop_z:
                if trades:
                    trades[-1]["exit_date"] = resid.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                    trades[-1]["stop_triggered"] = True
                current_pos = 0.0
            elif abs(z) < exit_z:
                if trades:
                    trades[-1]["exit_date"] = resid.index[i].strftime("%Y-%m-%d")
                    trades[-1]["exit_z"] = round(z, 3)
                current_pos = 0.0

        position.iloc[i] = current_pos

    pos_shifted = position.shift(1).fillna(0)
    cost_per_unit = transaction_cost_bps / 10000
    trade_cost = pos_shifted.diff().abs() * cost_per_unit
    portfolio_returns = pos_shifted * resid.fillna(0) - trade_cost.fillna(0)
    portfolio_returns.iloc[:insample_cutoff] = 0.0
    equity = (1 + portfolio_returns).cumprod() * 100

    equity_list = _to_json_list(equity)
    for idx in range(insample_cutoff):
        equity_list[idx] = None

    insample_end_date = resid.index[insample_cutoff - 1].strftime("%Y-%m-%d")

    date_to_idx = {resid.index[i].strftime("%Y-%m-%d"): i for i in range(len(resid))}
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

        durations = []
        for t in completed:
            ei = date_to_idx.get(t["date"])
            xi = date_to_idx.get(t.get("exit_date", ""))
            if ei is not None and xi is not None:
                durations.append(xi - ei)
        if durations:
            avg_trade_duration = round(sum(durations) / len(durations))

    total_return_val = float(oos_equity.iloc[-1] / 100 - 1)
    max_dd_val = compute_max_drawdown(oos_equity)
    oos_days = max(len(oos_returns), 1)
    annualized_return = float((1 + total_return_val) ** (252 / oos_days) - 1) if total_return_val > -1 else -1.0
    calmar_ratio = round(annualized_return / abs(max_dd_val), 3) if max_dd_val < 0 else None

    return {
        "equity_curve": equity_list,
        "dates": resid.index.strftime("%Y-%m-%d").tolist(),
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
        "insample_end_date": insample_end_date,
        "benchmark": None,
    }


def analyze_factor_pair(
    price1: pd.Series,
    price2: pd.Series,
    spy: pd.Series,
    sector: pd.Series,
    zscore_window: int,
    ticker1: str,
    ticker2: str,
) -> dict:
    returns = prepare_aligned_returns(price1, price2, spy, sector, zscore_window)
    _, resid1, loadings1 = fit_factor_model(returns, "p1")
    _, resid2, loadings2 = fit_factor_model(returns, "p2")
    stats = compute_spread_stats(resid1, resid2, zscore_window)

    return {
        "ticker1": ticker1,
        "ticker2": ticker2,
        "factor_loadings": {"ticker1": loadings1, "ticker2": loadings2},
        **stats,
    }
