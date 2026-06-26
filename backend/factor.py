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
        "dates": spread.index.strftime("%Y-%m-%d").tolist(),
        "adf": adf,
        "half_life": round(hl, 1) if hl is not None else None,
        "current_zscore": round(current_z, 3) if current_z is not None else None,
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
