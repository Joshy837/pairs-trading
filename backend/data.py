"""Data fetching utilities using yfinance (free, no API key required)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

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


def fetch_prices_batch(tickers: list, lookback_days: int) -> "pd.DataFrame":
    """
    Download adjusted close prices for multiple tickers over a lookback window.

    Returns a DataFrame with tickers as columns, date index, NaN rows dropped.
    Tickers that yfinance cannot resolve are silently excluded — callers should
    check the returned columns against the requested list.

    Raises ValueError if fewer than 2 valid tickers remain or history is too short.
    """
    tickers_upper = [t.upper() for t in tickers]

    end = datetime.today()
    start = end - timedelta(days=lookback_days)

    raw = yf.download(
        tickers_upper,
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        auto_adjust=True,
        progress=False,
    )

    if raw.empty:
        raise ValueError("No data returned. Check that the ticker symbols are valid.")

    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"]
    else:
        raise ValueError("Unexpected data format from yfinance.")

    available = [t for t in tickers_upper if t in prices.columns]
    if len(available) < 2:
        raise ValueError("Fewer than 2 valid tickers found. Check your symbols and try again.")

    prices = prices[available].dropna()

    if len(prices) < 60:
        raise ValueError(
            f"Only {len(prices)} trading days available after alignment. "
            "Use a larger lookback window or choose tickers with more history."
        )

    return prices


def fetch_benchmark(ticker: str, lookback_days: int) -> "pd.Series":
    """
    Fetch adjusted close for a benchmark ticker (e.g. SPY).

    Raises ValueError if no data is returned.
    """
    end = datetime.today()
    start = end - timedelta(days=lookback_days)

    raw = yf.download(
        ticker,
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        auto_adjust=True,
        progress=False,
    )

    if raw.empty:
        raise ValueError(f"No data returned for benchmark ticker '{ticker}'.")

    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]

    return close.rename(ticker)


def fetch_sectors(tickers: list[str]) -> "dict[str, str | None]":
    """
    Fetch GICS sector for each ticker using yfinance.

    Requests run in parallel (I/O bound). Returns None for any ticker
    where sector information is unavailable or the request fails.
    """
    def _get(ticker: str) -> "tuple[str, str | None]":
        try:
            return ticker, yf.Ticker(ticker).info.get("sector")
        except Exception:
            return ticker, None

    sectors: dict[str, str | None] = {}
    with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as pool:
        futures = {pool.submit(_get, t): t for t in tickers}
        for future in as_completed(futures, timeout=20):
            try:
                t, sector = future.result()
                sectors[t] = sector
            except Exception:
                sectors[futures[future]] = None
    return sectors
