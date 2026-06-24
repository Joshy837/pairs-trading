"""Data fetching utilities using yfinance (free, no API key required)."""
from __future__ import annotations

import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta


def fetch_prices(ticker1: str, ticker2: str, lookback_days: int) -> tuple[pd.Series, pd.Series]:
    """
    Download adjusted close prices for two tickers over a lookback window.

    Uses yfinance which pulls from Yahoo Finance at no cost.
    Returns two aligned price Series (same date index, NaN rows dropped).

    Raises ValueError for invalid tickers, missing data, or insufficient history.
    """
    t1, t2 = ticker1.upper(), ticker2.upper()

    if t1 == t2:
        raise ValueError("Both tickers are the same — enter two different symbols.")

    end = datetime.today()
    start = end - timedelta(days=lookback_days)

    raw = yf.download(
        [t1, t2],
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        auto_adjust=True,
        progress=False,
    )

    if raw.empty:
        raise ValueError("No data returned. Check that both ticker symbols are valid.")

    # yfinance returns MultiIndex columns when downloading multiple tickers:
    # level 0 = price type (Close, Open, …), level 1 = ticker
    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"]
    else:
        raise ValueError("Unexpected data format from yfinance.")

    for t in (t1, t2):
        if t not in prices.columns:
            raise ValueError(f"Ticker '{t}' not found — check the symbol and try again.")

    prices = prices[[t1, t2]].dropna()

    if len(prices) < 60:
        raise ValueError(
            f"Only {len(prices)} trading days available. "
            "Use a larger lookback window or choose tickers with more history."
        )

    return prices[t1], prices[t2]
