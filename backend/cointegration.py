"""
Cointegration tests and spread calculations for pairs trading.

Theory:
  Two price series P1 and P2 are cointegrated if there exists a linear combination
  P1 - β·P2 (the "spread") that is stationary (mean-reverting).
  β is the hedge ratio estimated via OLS.

  We test stationarity with:
    ADF test  — unit-root test on the spread itself (Engle-Granger method)
    Johansen  — system-level test that doesn't require pre-specifying which is the
                 dependent variable; tests for rank of the cointegration space
"""
import math

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.tsa.stattools import adfuller
from statsmodels.tsa.vector_ar.vecm import coint_johansen


def _to_json_list(s: pd.Series) -> list:
    """Convert a Series to a JSON-safe list, mapping NaN → None."""
    return [None if math.isnan(x) else float(x) for x in s]


def compute_hedge_ratio(price1: pd.Series, price2: pd.Series) -> float:
    """
    OLS hedge ratio β such that price1 ≈ α + β·price2.

    We regress price1 on price2 (with intercept) and take the slope.
    This minimises the variance of the spread and is the standard
    Engle-Granger first-step estimator.
    """
    X = sm.add_constant(price2.values)
    model = sm.OLS(price1.values, X).fit()
    return float(model.params[1])


def compute_spread(price1: pd.Series, price2: pd.Series, hedge_ratio: float) -> pd.Series:
    """Spread = price1 − β·price2.  Mean-reverts if the pair is cointegrated."""
    return (price1 - hedge_ratio * price2).rename("spread")


def compute_zscore(spread: pd.Series, window: int) -> pd.Series:
    """
    Rolling z-score: z_t = (spread_t − μ_t) / σ_t
    where μ_t and σ_t are the rolling mean and std over `window` days.

    First `window - 1` values are NaN (insufficient history).
    """
    mu = spread.rolling(window=window).mean()
    sigma = spread.rolling(window=window).std()
    return ((spread - mu) / sigma).rename("zscore")


def run_adf_test(spread: pd.Series) -> dict:
    """
    Augmented Dickey-Fuller test on the spread.

    H₀: spread has a unit root (non-stationary → NOT cointegrated).
    Reject H₀ at p < 0.05 → spread is stationary → pair IS cointegrated.
    """
    stat, pvalue, _, _, crit, _ = adfuller(spread.dropna(), autolag="AIC")
    return {
        "test_statistic": float(stat),
        "p_value": float(pvalue),
        "critical_values": {k: float(v) for k, v in crit.items()},
        "is_stationary": bool(pvalue < 0.05),
    }


def run_johansen_test(price1: pd.Series, price2: pd.Series) -> dict:
    """
    Johansen trace test for cointegration between two price series.

    Tests H₀: cointegration rank = 0 (no cointegration).
    Reject H₀ if trace statistic > 95% critical value → cointegrated.

    Unlike ADF, Johansen doesn't assume which series is the 'dependent' one.
    """
    data = np.column_stack([price1.values, price2.values])
    result = coint_johansen(data, det_order=0, k_ar_diff=1)

    # lr1[0] = trace stat for rank-0 hypothesis; cvt[0,1] = 95% critical value
    trace_stat = float(result.lr1[0])
    crit_95 = float(result.cvt[0, 1])

    return {
        "trace_statistic": trace_stat,
        "critical_value_95": crit_95,
        "is_cointegrated": bool(trace_stat > crit_95),
    }


def compute_half_life(spread: pd.Series) -> "float | None":
    """
    Half-life of mean reversion in trading days.

    Fits Δspread_t = α + γ·spread_{t-1} and solves -ln(2)/ln(1+γ).
    Returns None if γ ≥ 0 (spread not mean-reverting) or OLS fails.
    """
    lag = spread.shift(1)
    delta = spread.diff()
    df = pd.concat([lag, delta], axis=1).dropna()
    df.columns = ["lag", "delta"]
    X = sm.add_constant(df["lag"].values)
    model = sm.OLS(df["delta"].values, X).fit()
    gamma = float(model.params[1])
    if gamma >= 0:
        return None
    return float(-math.log(2) / math.log(1 + gamma))


def compute_kalman_hedge(price1: pd.Series, price2: pd.Series, delta: float = 1e-4) -> pd.Series:
    """
    Kalman filter estimate of the time-varying hedge ratio β.

    Models [β, α] as a random walk (state) observed via price1_t = β_t·price2_t + α_t + noise.
    Causal/online — β_t uses only data up to and including day t, so no lookahead bias.

    delta controls process noise: larger values let β change faster.
    """
    n = len(price1)
    p1 = price1.values.astype(float)
    p2 = price2.values.astype(float)

    # Process noise covariance (random-walk scaling)
    Ve = delta / (1.0 - delta)
    Q = np.eye(2) * Ve
    R = 1.0  # measurement noise variance (normalised)

    # Warm-start state from first ~30 points via OLS
    init_n = max(2, min(30, n // 5))
    X_init = np.column_stack([p2[:init_n], np.ones(init_n)])
    theta, _, _, _ = np.linalg.lstsq(X_init, p1[:init_n], rcond=None)  # [β, α]
    P = np.eye(2)

    betas = np.full(n, np.nan)

    for t in range(n):
        H = np.array([p2[t], 1.0])          # observation vector (2,)
        P_pred = P + Q                        # predicted covariance (2,2)
        S = float(H @ P_pred @ H) + R        # innovation variance (scalar)
        K = (P_pred @ H) / S                 # Kalman gain (2,)
        innovation = p1[t] - float(H @ theta)
        theta = theta + K * innovation        # state update
        P = (np.eye(2) - np.outer(K, H)) @ P_pred
        betas[t] = theta[0]

    return pd.Series(betas, index=price1.index, name="kalman_hedge")


def compute_rolling_hedge(price1: pd.Series, price2: pd.Series, window: int) -> pd.Series:
    """
    Rolling OLS hedge ratio using a fixed lookback window.

    β_t = cov(price2_t, price1_t) / var(price2_t) over [t-window+1, t].
    First `window - 1` values are NaN (insufficient history).
    """
    n = len(price1)
    vals = np.full(n, np.nan)
    p1 = price1.values
    p2 = price2.values
    for i in range(window - 1, n):
        y = p1[i - window + 1 : i + 1]
        x = p2[i - window + 1 : i + 1]
        x_dm = x - x.mean()
        denom = float(np.dot(x_dm, x_dm))
        if denom > 0:
            vals[i] = float(np.dot(x_dm, y - y.mean()) / denom)
    return pd.Series(vals, index=price1.index, name="rolling_hedge")


def _stability_test(price1: pd.Series, price2: pd.Series) -> dict:
    """
    Test cointegration stability by re-running ADF on the first and second halves.

    A real cointegrating relationship should be detectable in sub-periods.
    Uses p < 0.10 per half (lenient vs full-sample 0.05) because each half
    has fewer observations and therefore less statistical power.

    Returns None values when either half is too short for a meaningful test.
    """
    mid = len(price1) // 2
    if mid < 30:
        return {"pvalue_h1": None, "pvalue_h2": None, "is_stable": None}

    hr1 = compute_hedge_ratio(price1.iloc[:mid], price2.iloc[:mid])
    spread1 = compute_spread(price1.iloc[:mid], price2.iloc[:mid], hr1)
    p1 = run_adf_test(spread1)["p_value"]

    hr2 = compute_hedge_ratio(price1.iloc[mid:], price2.iloc[mid:])
    spread2 = compute_spread(price1.iloc[mid:], price2.iloc[mid:], hr2)
    p2 = run_adf_test(spread2)["p_value"]

    return {
        "pvalue_h1": round(p1, 4),
        "pvalue_h2": round(p2, 4),
        "is_stable": bool(p1 < 0.10 and p2 < 0.10),
    }


def scan_pair(
    price1: pd.Series,
    price2: pd.Series,
    ticker1: str,
    ticker2: str,
    zscore_window: int = 30,
) -> dict:
    """
    Lightweight cointegration scan for one pair — ADF only (no Johansen) for speed.

    Returns the key metrics needed by the scanner: p-value, hedge ratio,
    current z-score, half-life of mean reversion, and stability across sub-periods.
    """
    hedge_ratio = compute_hedge_ratio(price1, price2)
    spread = compute_spread(price1, price2, hedge_ratio)
    zscore = compute_zscore(spread, zscore_window)

    adf = run_adf_test(spread)
    half_life = compute_half_life(spread)
    stability = _stability_test(price1, price2)

    valid_z = zscore.dropna()
    current_z = float(valid_z.iloc[-1]) if not valid_z.empty else None

    return {
        "ticker1": ticker1,
        "ticker2": ticker2,
        "pvalue": round(adf["p_value"], 4),
        "hedge_ratio": round(hedge_ratio, 4),
        "zscore": round(current_z, 3) if current_z is not None else None,
        "half_life": round(half_life, 1) if half_life is not None else None,
        "is_cointegrated": adf["is_stationary"],
        "stability_pvalue_h1": stability["pvalue_h1"],
        "stability_pvalue_h2": stability["pvalue_h2"],
        "is_stable": stability["is_stable"],
    }


def _batch_ols_slope(y: np.ndarray, x: np.ndarray) -> np.ndarray:
    """Batch OLS slope β where y ≈ α + β·x. y, x: (M, T) → returns (M,)."""
    T = y.shape[1]
    sx = x.sum(axis=1)
    sy = y.sum(axis=1)
    sxx = (x * x).sum(axis=1)
    sxy = (x * y).sum(axis=1)
    denom = T * sxx - sx * sx
    return np.where(np.abs(denom) > 1e-10, (T * sxy - sx * sy) / denom, np.nan)


def _batch_adf_pvalue(spreads: np.ndarray) -> np.ndarray:
    """
    Vectorised ADF p-values for M spread series, fixed lag=1 with constant.
    spreads: (M, T) float64 → returns p_values (M,).

    Uses lag=1 (adequate for screening). Single-pair detail view still uses
    adfuller(autolag='AIC') which selects the optimal lag per series.
    """
    from statsmodels.tsa.stattools import mackinnonp

    M, T = spreads.shape
    if T < 6:
        return np.full(M, np.nan)

    dy = np.diff(spreads, axis=1)       # (M, T-1)
    n_obs = T - 2                        # effective obs after 1 diff + 1 lag

    # Design matrix: [ones, y_{t-1}, Δy_{t-1}]  shape (M, n_obs, 3)
    X = np.empty((M, n_obs, 3), dtype=np.float64)
    X[:, :, 0] = 1.0
    X[:, :, 1] = spreads[:, 1:-1]       # y_{t-1}
    X[:, :, 2] = dy[:, :-1]             # Δy_{t-1}
    resp = dy[:, 1:]                     # Δy_t  (M, n_obs)

    # Batch normal equations: XtX β = Xty
    XtX = np.einsum("mni,mnj->mij", X, X)   # (M, 3, 3)
    Xty = np.einsum("mni,mn->mi", X, resp)  # (M, 3)

    try:
        beta = np.linalg.solve(XtX, Xty)    # (M, 3)
    except np.linalg.LinAlgError:
        beta = np.full((M, 3), np.nan)
        for m in range(M):
            try:
                beta[m] = np.linalg.solve(XtX[m], Xty[m])
            except np.linalg.LinAlgError:
                pass

    fitted = np.einsum("mni,mi->mn", X, beta)
    resid = resp - fitted
    dof = max(1, n_obs - 3)
    s2 = (resid * resid).sum(axis=1) / dof  # (M,)

    try:
        XtX_inv = np.linalg.inv(XtX)        # (M, 3, 3)
    except np.linalg.LinAlgError:
        return np.full(M, np.nan)

    var_gamma = s2 * XtX_inv[:, 1, 1]       # (M,)
    t_stats = np.where(
        (var_gamma > 0) & ~np.isnan(beta[:, 1]),
        beta[:, 1] / np.sqrt(np.maximum(var_gamma, 1e-30)),
        np.nan,
    )

    # MacKinnon (1994) surface — fast polynomial eval, not a bottleneck
    return np.array([
        mackinnonp(float(t), regression="c", N=1) if not np.isnan(t) else np.nan
        for t in t_stats
    ])


def _batch_half_life(spreads: np.ndarray) -> np.ndarray:
    """Half-life of mean reversion for M spread series. spreads: (M, T)."""
    M, T = spreads.shape
    dy = np.diff(spreads, axis=1)    # (M, T-1)
    lag = spreads[:, :-1]            # (M, T-1)
    n = T - 1
    sl = lag.sum(axis=1)
    sd = dy.sum(axis=1)
    sll = (lag * lag).sum(axis=1)
    sld = (lag * dy).sum(axis=1)
    denom = n * sll - sl * sl
    gamma = np.where(np.abs(denom) > 1e-10, (n * sld - sl * sd) / denom, np.nan)
    return np.where((gamma < 0) & (gamma > -2), -np.log(2) / np.log1p(gamma), np.nan)


def _batch_last_zscore(spreads: np.ndarray, window: int) -> np.ndarray:
    """Last rolling z-score value for M spread series. spreads: (M, T)."""
    if spreads.shape[1] < window:
        return np.full(spreads.shape[0], np.nan)
    w = spreads[:, -window:]
    mu = w.mean(axis=1)
    sigma = w.std(axis=1, ddof=1)
    return np.where(sigma > 0, (spreads[:, -1] - mu) / sigma, np.nan)


_BATCH_CHUNK = 4000  # max pairs per NumPy batch to bound peak memory


def scan_pairs_batch(
    prices: pd.DataFrame,
    pairs: list,
    zscore_window: int = 30,
) -> list:
    """
    Vectorised cointegration scan — replaces sequential scan_pair() calls.

    Runs batch NumPy OLS + fixed-lag-1 ADF instead of statsmodels adfuller per
    pair.  Typically 20–50× faster for M ≥ 100 pairs.

    pairs: list of (ticker1, ticker2) tuples that exist in prices.columns.
    Returns one dict per pair in the same schema as scan_pair().
    """
    if not pairs:
        return []
    if len(pairs) > _BATCH_CHUNK:
        out: list = []
        for i in range(0, len(pairs), _BATCH_CHUNK):
            out.extend(scan_pairs_batch(prices, pairs[i : i + _BATCH_CHUNK], zscore_window))
        return out

    P1 = np.stack([prices[t1].values.astype(np.float64) for t1, _ in pairs])  # (M, T)
    P2 = np.stack([prices[t2].values.astype(np.float64) for _, t2 in pairs])  # (M, T)
    M, T = P1.shape

    hedge_ratios = _batch_ols_slope(P1, P2)                          # (M,)
    spreads = P1 - hedge_ratios[:, np.newaxis] * P2                  # (M, T)
    pvalues = _batch_adf_pvalue(spreads)                             # (M,)
    half_lives = _batch_half_life(spreads)                           # (M,)
    current_z = _batch_last_zscore(spreads, zscore_window)           # (M,)

    mid = T // 2
    if mid >= 30:
        hr1 = _batch_ols_slope(P1[:, :mid], P2[:, :mid])
        pv1 = _batch_adf_pvalue(P1[:, :mid] - hr1[:, np.newaxis] * P2[:, :mid])
        hr2 = _batch_ols_slope(P1[:, mid:], P2[:, mid:])
        pv2 = _batch_adf_pvalue(P1[:, mid:] - hr2[:, np.newaxis] * P2[:, mid:])
    else:
        pv1 = pv2 = np.full(M, np.nan)

    results: list = []
    for i in range(M):
        t1, t2 = pairs[i]
        pv = float(pvalues[i])
        hl = float(half_lives[i])
        z = float(current_z[i])
        sp1 = float(pv1[i])
        sp2 = float(pv2[i])
        results.append({
            "ticker1": t1,
            "ticker2": t2,
            "pvalue": round(pv, 4) if not math.isnan(pv) else 1.0,
            "hedge_ratio": round(float(hedge_ratios[i]), 4) if not math.isnan(hedge_ratios[i]) else 0.0,
            "zscore": round(z, 3) if not math.isnan(z) else None,
            "half_life": round(hl, 1) if not math.isnan(hl) else None,
            "is_cointegrated": not math.isnan(pv) and pv < 0.05,
            "stability_pvalue_h1": round(sp1, 4) if not math.isnan(sp1) else None,
            "stability_pvalue_h2": round(sp2, 4) if not math.isnan(sp2) else None,
            "is_stable": not (math.isnan(sp1) or math.isnan(sp2)) and sp1 < 0.10 and sp2 < 0.10,
        })
    return results


def analyze_pair(
    price1: pd.Series,
    price2: pd.Series,
    zscore_window: int = 30,
    use_log_prices: bool = False,
) -> dict:
    """
    Run full cointegration analysis and return all data needed by the frontend.

    Returns hedge ratio, ADF/Johansen results, and the spread + z-score time series.
    A pair is flagged as cointegrated if *either* test rejects the null.
    """
    p1 = np.log(price1) if use_log_prices else price1
    p2 = np.log(price2) if use_log_prices else price2

    hedge_ratio = compute_hedge_ratio(p1, p2)
    spread = compute_spread(p1, p2, hedge_ratio)
    zscore = compute_zscore(spread, zscore_window)

    adf = run_adf_test(spread)
    johansen = run_johansen_test(p1, p2)

    rolling_window = max(zscore_window * 3, 90)
    rolling_hedge = compute_rolling_hedge(p1, p2, rolling_window)
    kalman_hedge = compute_kalman_hedge(p1, p2)

    half_life = compute_half_life(spread)

    return {
        "hedge_ratio": round(hedge_ratio, 6),
        "adf": adf,
        "johansen": johansen,
        "is_cointegrated": adf["is_stationary"] or johansen["is_cointegrated"],
        "spread": _to_json_list(spread),
        "zscore": _to_json_list(zscore),
        "dates": price1.index.strftime("%Y-%m-%d").tolist(),
        "rolling_hedge": _to_json_list(rolling_hedge),
        "rolling_hedge_window": rolling_window,
        "kalman_hedge": _to_json_list(kalman_hedge),
        "half_life": round(half_life, 1) if half_life is not None else None,
    }
