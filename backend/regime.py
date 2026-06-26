"""
2-state Gaussian HMM for market regime detection in pairs trading.

States
------
0 : trending      — spread diverging, high volatility; new entries suppressed
1 : mean-reverting — spread stationary, low volatility; normal signal generation

Feature
-------
Rolling 60-day standard deviation of spread 1-day changes.
The mean-reverting state has systematically lower volatility.

Algorithm
---------
Baum-Welch EM fitted on the in-sample window (no lookahead).
Viterbi decoding applied to the full series with fixed in-sample parameters.
Pure NumPy — no additional dependencies beyond the existing requirements.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd


# ── Gaussian emission ────────────────────────────────────────────────────────

def _gauss(x: np.ndarray, mu: float, sigma: float) -> np.ndarray:
    sigma = max(float(sigma), 1e-8)
    return np.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * math.sqrt(2 * math.pi))


# ── Scaled forward-backward ──────────────────────────────────────────────────

def _forward(
    obs: np.ndarray,
    pi: np.ndarray,
    A: np.ndarray,
    mu: np.ndarray,
    sigma: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    T = len(obs)
    B = np.column_stack([_gauss(obs, mu[k], sigma[k]) for k in range(2)])  # (T, 2)
    alpha = np.zeros((T, 2))
    c = np.zeros(T)

    alpha[0] = pi * B[0]
    c[0] = max(alpha[0].sum(), 1e-300)
    alpha[0] /= c[0]

    for t in range(1, T):
        alpha[t] = (alpha[t - 1] @ A) * B[t]
        c[t] = max(alpha[t].sum(), 1e-300)
        alpha[t] /= c[t]

    return alpha, c, B


def _backward(B: np.ndarray, A: np.ndarray, c: np.ndarray) -> np.ndarray:
    T = B.shape[0]
    beta = np.ones((T, 2))
    for t in range(T - 2, -1, -1):
        beta[t] = A @ (B[t + 1] * beta[t + 1])
        beta[t] /= c[t + 1]
    return beta


# ── Baum-Welch EM ────────────────────────────────────────────────────────────

def _baum_welch(
    obs: np.ndarray,
    n_iter: int = 60,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Fit 2-state Gaussian HMM on 1-D observations.
    Initialise state means at the 33rd and 67th percentiles of obs.
    Returns (pi, A, mu, sigma).
    """
    mu = np.percentile(obs, [33, 67]).astype(float)
    sigma = np.array([obs.std(), obs.std()], dtype=float)
    A = np.array([[0.98, 0.02], [0.02, 0.98]], dtype=float)
    pi = np.array([0.5, 0.5], dtype=float)

    for _ in range(n_iter):
        alpha, c, B = _forward(obs, pi, A, mu, sigma)
        beta = _backward(B, A, c)

        gamma = alpha * beta
        gamma /= gamma.sum(axis=1, keepdims=True).clip(1e-300)

        # xi[t,i,j] ∝ alpha[t,i] * A[i,j] * B[t+1,j] * beta[t+1,j]
        xi = (
            alpha[:-1, :, None]                   # (T-1, 2, 1)
            * A[None, :, :]                        # (  1, 2, 2)
            * (B[1:] * beta[1:])[:, None, :]       # (T-1, 1, 2)
        )  # → (T-1, 2, 2)
        xi /= xi.sum(axis=(1, 2), keepdims=True).clip(1e-300)

        pi = gamma[0] / gamma[0].sum()
        A = xi.sum(0) / xi.sum(0).sum(axis=1, keepdims=True).clip(1e-300)
        mu = (gamma * obs[:, None]).sum(0) / gamma.sum(0).clip(1e-300)
        sigma = np.sqrt(
            (gamma * (obs[:, None] - mu) ** 2).sum(0) / gamma.sum(0).clip(1e-300)
        )
        sigma = np.maximum(sigma, 1e-4)

    return pi, A, mu, sigma


# ── Viterbi decoding ─────────────────────────────────────────────────────────

def _viterbi(
    obs: np.ndarray,
    pi: np.ndarray,
    A: np.ndarray,
    mu: np.ndarray,
    sigma: np.ndarray,
) -> np.ndarray:
    T = len(obs)
    B = np.column_stack([_gauss(obs, mu[k], sigma[k]) for k in range(2)])
    log_B = np.log(B.clip(1e-300))
    log_A = np.log(A.clip(1e-300))
    log_pi = np.log(pi.clip(1e-300))

    delta = np.zeros((T, 2))
    psi = np.zeros((T, 2), dtype=int)
    delta[0] = log_pi + log_B[0]

    for t in range(1, T):
        # scores[i,j] = delta[t-1, i] + log_A[i, j]
        scores = delta[t - 1, :, None] + log_A  # (2, 2)
        psi[t] = scores.argmax(axis=0)
        delta[t] = scores.max(axis=0) + log_B[t]

    states = np.zeros(T, dtype=int)
    states[T - 1] = int(delta[T - 1].argmax())
    for t in range(T - 2, -1, -1):
        states[t] = psi[t + 1, states[t + 1]]

    return states


# ── Public API ───────────────────────────────────────────────────────────────

def detect_regimes(
    spread: pd.Series,
    insample_cutoff: int,
    vol_window: int = 60,
) -> list[int | None]:
    """
    Classify each day as mean-reverting (1) or trending (0) using a 2-state
    Gaussian HMM fitted on the in-sample rolling spread volatility.

    Parameters
    ----------
    spread           : full spread series (in-sample + out-of-sample)
    insample_cutoff  : index position where in-sample ends
    vol_window       : rolling window for the volatility feature (days)

    Returns
    -------
    List aligned with spread.index.
      1  = mean-reverting (favorable — allow entries)
      0  = trending       (unfavorable — suppress entries)
      None = insufficient history (treated as favorable by the caller)
    """
    feature = spread.diff().rolling(vol_window).std()

    insample_vals = feature.iloc[:insample_cutoff].dropna().values
    if len(insample_vals) < vol_window * 2:
        return [1] * len(spread)

    # Standardise with in-sample statistics only (no lookahead)
    mu_s = float(insample_vals.mean())
    std_s = float(insample_vals.std()) or 1.0
    obs_in = (insample_vals - mu_s) / std_s

    pi, A, mu_hmm, sigma_hmm = _baum_welch(obs_in)

    # Lower mean vol → mean-reverting state
    favorable_state = int(mu_hmm.argmin())

    valid = feature.notna()
    obs_full = (feature[valid].values - mu_s) / std_s
    raw_states = _viterbi(obs_full, pi, A, mu_hmm, sigma_hmm)

    result: list[int | None] = [None] * len(spread)
    for i, idx in enumerate(np.where(valid.values)[0]):
        result[idx] = 1 if raw_states[i] == favorable_state else 0

    return result
