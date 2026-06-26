"""FastAPI application — pairs trading analysis and backtesting endpoints."""
from __future__ import annotations

import json as _json
from itertools import combinations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from typing import Optional

from backtest import run_backtest
from cointegration import analyze_pair, scan_pair
from data import fetch_benchmark, fetch_factor_prices, fetch_factor_stock_prices, fetch_prices, fetch_prices_batch, fetch_sectors
from factor import (
    analyze_factor_pair,
    analyze_factor_stock,
    compute_spread_stats,
    fit_factor_model,
    prepare_aligned_returns,
    prepare_aligned_returns_single,
    run_factor_backtest,
)

app = FastAPI(title="Pairs Trading API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to your Vercel domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    ticker1: str = Field(..., min_length=1, max_length=10)
    ticker2: str = Field(..., min_length=1, max_length=10)
    lookback_days: int = Field(default=365, ge=90, le=1825)
    zscore_window: int = Field(default=30, ge=10, le=120)
    use_log_prices: bool = Field(default=False)

    @model_validator(mode="after")
    def check_lookback_sufficient(self) -> "AnalyzeRequest":
        if self.lookback_days < self.zscore_window * 3:
            raise ValueError(
                f"lookback_days ({self.lookback_days}) must be at least "
                f"3× zscore_window ({self.zscore_window * 3} days minimum)."
            )
        return self


class BacktestRequest(AnalyzeRequest):
    entry_z: float = Field(default=2.0, ge=0.5, le=4.0)
    exit_z: float = Field(default=0.5, ge=0.0, le=2.0)
    stop_z: float = Field(default=4.0, ge=2.5, le=6.0)
    transaction_cost_bps: float = Field(default=5.0, ge=0.0, le=50.0)
    insample_pct: float = Field(default=0.7, ge=0.5, le=0.9)
    use_kalman: bool = Field(default=False)
    use_regime: bool = Field(default=False)
    max_holding_days: Optional[int] = Field(default=None, ge=5, le=200)
    use_halflife_hold: bool = Field(default=False)

    @model_validator(mode="after")
    def check_thresholds(self) -> "BacktestRequest":
        if self.exit_z >= self.entry_z:
            raise ValueError("exit_z must be strictly less than entry_z.")
        if self.entry_z >= self.stop_z:
            raise ValueError("stop_z must be strictly greater than entry_z.")
        return self


class ScanRequest(BaseModel):
    tickers: list[str] = Field(..., min_length=2, max_length=20)
    lookback_days: int = Field(default=365, ge=90, le=1825)
    zscore_window: int = Field(default=30, ge=10, le=120)
    sector_filter: bool = Field(default=False)
    corr_threshold: float = Field(default=0.5, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def check_valid(self) -> "ScanRequest":
        if self.lookback_days < self.zscore_window * 3:
            raise ValueError(
                f"lookback_days ({self.lookback_days}) must be at least "
                f"3× zscore_window ({self.zscore_window * 3} days minimum)."
            )
        upper = [t.upper() for t in self.tickers]
        if len(set(upper)) != len(upper):
            raise ValueError("Duplicate tickers in list.")
        return self


SECTOR_ETFS = {
    "XLF", "XLK", "XLE", "XLV", "XLI", "XLP", "XLU", "XLY", "XLB", "XLRE", "XLC",
}


class FactorAnalyzeRequest(BaseModel):
    ticker1: str = Field(..., min_length=1, max_length=10)
    ticker2: str = Field(..., min_length=1, max_length=10)
    sector_etf: str = Field(default="XLK", min_length=2, max_length=5)
    lookback_days: int = Field(default=730, ge=90, le=1825)
    zscore_window: int = Field(default=30, ge=10, le=120)

    @model_validator(mode="after")
    def check_valid(self) -> "FactorAnalyzeRequest":
        if self.lookback_days < self.zscore_window * 3:
            raise ValueError(
                f"lookback_days ({self.lookback_days}) must be at least "
                f"3× zscore_window ({self.zscore_window * 3} days minimum)."
            )
        if self.sector_etf.upper() not in SECTOR_ETFS:
            raise ValueError(f"sector_etf must be one of: {', '.join(sorted(SECTOR_ETFS))}.")
        return self


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    """
    Run cointegration tests on a ticker pair and return spread + z-score time series.

    Used to populate the Cointegration Panel and Spread Chart on the frontend.
    """
    try:
        p1, p2 = fetch_prices(req.ticker1, req.ticker2, req.lookback_days)
        return analyze_pair(p1, p2, req.zscore_window, req.use_log_prices)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")


@app.post("/api/scan")
def scan(req: ScanRequest) -> dict:
    """
    Run cointegration scan over all N(N-1)/2 pairs from the provided ticker list.

    Fetches prices in a single batch call, then runs ADF on each combination.
    Applies three anti-overfitting filters:
      1. Sector filter (optional) — skips cross-sector pairs to reduce the search space.
      2. Stability test — flags pairs where cointegration holds in both sub-periods.
      3. Benjamini-Hochberg correction — adjusts p-values for multiple comparisons.
    Returns results sorted by raw p-value (most cointegrated first).
    """
    from statsmodels.stats.multitest import multipletests

    try:
        prices = fetch_prices_batch(req.tickers, req.lookback_days)
        available = list(prices.columns)

        # Fetch sectors in parallel when sector filter is requested
        sectors: dict = {}
        if req.sector_filter:
            sectors = fetch_sectors(available)

        results = []
        for t1, t2 in combinations(available, 2):
            # Skip cross-sector pairs when sector filter is enabled;
            # allow through if either sector is unknown (None) to avoid false exclusions
            if req.sector_filter:
                s1, s2 = sectors.get(t1), sectors.get(t2)
                if s1 is not None and s2 is not None and s1 != s2:
                    continue
            try:
                result = scan_pair(prices[t1], prices[t2], t1, t2, req.zscore_window)
                results.append(result)
            except Exception:
                pass  # skip pairs that fail (insufficient variance, etc.)

        # Benjamini-Hochberg correction for multiple comparisons (FDR = 10%)
        if len(results) > 1:
            pvalues = [r["pvalue"] for r in results]
            _, adj_pvalues, _, _ = multipletests(pvalues, alpha=0.1, method="fdr_bh")
            for r, adj_p in zip(results, adj_pvalues):
                r["adjusted_pvalue"] = round(float(adj_p), 4)
                r["bh_significant"] = bool(adj_p < 0.1)
        else:
            for r in results:
                r["adjusted_pvalue"] = r["pvalue"]
                r["bh_significant"] = bool(r["pvalue"] < 0.1)

        results.sort(key=lambda x: x["pvalue"])
        return {"pairs": results, "tickers": available, "sectors": sectors}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}")


@app.post("/api/scan/stream")
def scan_stream(req: ScanRequest) -> StreamingResponse:
    """
    SSE stream of the pair scanning pipeline.

    Events (JSON in data: field):
      fetching        — {tickers}
      corr_result     — {ticker1, ticker2, corr, passed}  (one per pair)
      correlation_done— {total, passed}
      coint_result    — {ticker1, ticker2, pvalue, is_cointegrated}  (one per filtered pair)
      bh_correction   — (no payload)
      complete        — {pairs, tickers, sectors, significant}
      error           — {message}
    """
    from statsmodels.stats.multitest import multipletests

    def _event(payload: dict) -> str:
        return f"data: {_json.dumps(payload)}\n\n"

    def generate():
        try:
            yield _event({"type": "fetching", "tickers": req.tickers})

            prices = fetch_prices_batch(req.tickers, req.lookback_days)
            available = list(prices.columns)

            sectors: dict = {}
            if req.sector_filter:
                sectors = fetch_sectors(available)

            all_pairs = []
            for t1, t2 in combinations(available, 2):
                if req.sector_filter:
                    s1, s2 = sectors.get(t1), sectors.get(t2)
                    if s1 is not None and s2 is not None and s1 != s2:
                        continue
                all_pairs.append((t1, t2))

            returns = prices.pct_change().dropna()
            filtered: list[tuple[str, str, float]] = []
            for t1, t2 in all_pairs:
                corr = float(abs(returns[t1].corr(returns[t2])))
                passed = corr >= req.corr_threshold
                yield _event({"type": "corr_result", "ticker1": t1, "ticker2": t2, "corr": round(corr, 4), "passed": passed})
                if passed:
                    filtered.append((t1, t2, corr))

            yield _event({"type": "correlation_done", "total": len(all_pairs), "passed": len(filtered)})

            results = []
            for t1, t2, corr in filtered:
                try:
                    result = scan_pair(prices[t1], prices[t2], t1, t2, req.zscore_window)
                    result["correlation"] = round(corr, 4)
                    results.append(result)
                    yield _event({"type": "coint_result", "ticker1": t1, "ticker2": t2, "pvalue": result["pvalue"], "is_cointegrated": result["is_cointegrated"]})
                except Exception:
                    yield _event({"type": "coint_result", "ticker1": t1, "ticker2": t2, "pvalue": None, "is_cointegrated": False})

            yield _event({"type": "bh_correction"})

            if len(results) > 1:
                pvalues = [r["pvalue"] for r in results]
                _, adj_pvalues, _, _ = multipletests(pvalues, alpha=0.1, method="fdr_bh")
                for r, adj_p in zip(results, adj_pvalues):
                    r["adjusted_pvalue"] = round(float(adj_p), 4)
                    r["bh_significant"] = bool(adj_p < 0.1)
            else:
                for r in results:
                    r["adjusted_pvalue"] = r["pvalue"]
                    r["bh_significant"] = bool(r["pvalue"] < 0.1)

            results.sort(key=lambda x: x["pvalue"])
            significant = sum(1 for r in results if r.get("bh_significant"))

            yield _event({"type": "complete", "pairs": results, "tickers": available, "sectors": sectors, "significant": significant})

        except ValueError as exc:
            yield _event({"type": "error", "message": str(exc)})
        except Exception as exc:
            yield _event({"type": "error", "message": f"Scan failed: {exc}"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class FactorStockRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    sector_etf: str = Field(default="XLK", min_length=2, max_length=5)
    lookback_days: int = Field(default=730, ge=90, le=1825)
    zscore_window: int = Field(default=30, ge=10, le=120)

    @model_validator(mode="after")
    def check_valid(self) -> "FactorStockRequest":
        if self.lookback_days < self.zscore_window * 3:
            raise ValueError(
                f"lookback_days ({self.lookback_days}) must be at least "
                f"3× zscore_window ({self.zscore_window * 3} days minimum)."
            )
        if self.sector_etf.upper() not in SECTOR_ETFS:
            raise ValueError(f"sector_etf must be one of: {', '.join(sorted(SECTOR_ETFS))}.")
        return self


class FactorStockBacktestRequest(FactorStockRequest):
    entry_z: float = Field(default=2.0, ge=0.5, le=4.0)
    exit_z: float = Field(default=0.5, ge=0.0, le=2.0)
    stop_z: float = Field(default=4.0, ge=2.5, le=6.0)
    transaction_cost_bps: float = Field(default=5.0, ge=0.0, le=50.0)
    insample_pct: float = Field(default=0.7, ge=0.5, le=0.9)

    @model_validator(mode="after")
    def check_thresholds(self) -> "FactorStockBacktestRequest":
        if self.exit_z >= self.entry_z:
            raise ValueError("exit_z must be strictly less than entry_z.")
        if self.entry_z >= self.stop_z:
            raise ValueError("stop_z must be strictly greater than entry_z.")
        return self


@app.post("/api/factor-stock/backtest")
def factor_stock_backtest(req: FactorStockBacktestRequest) -> dict:
    """
    Run a mean-reversion backtest on the factor-neutral residual ε for a single stock.

    Re-fetches prices, fits the 3-factor model, and backtests the ε z-score signal.
    Returns equity curve and performance metrics (OOS only).
    """
    try:
        price, spy, sector = fetch_factor_stock_prices(
            req.ticker, req.sector_etf, req.lookback_days
        )
        returns = prepare_aligned_returns_single(price, spy, sector, req.zscore_window)
        _, resid, _ = fit_factor_model(returns, "p1")
        return run_factor_backtest(
            resid,
            req.zscore_window,
            req.entry_z,
            req.exit_z,
            req.stop_z,
            req.transaction_cost_bps,
            req.insample_pct,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}")


@app.post("/api/factor-stock/stream")
def factor_stock_stream(req: FactorStockRequest) -> StreamingResponse:
    """
    SSE stream for single-stock 3-factor analysis.

    Fits R_ticker = α + β_mkt·R_SPY + β_sec·R_sector + β_mom·R_mom + ε,
    then tests whether ε mean-reverts and returns its rolling z-score.

    Events (JSON in data: field):
      fetching    — {tickers}
      step        — {text, kind}
      regression  — {ticker, r_squared, market, sector, momentum}
      adf_result  — {p_value, is_stationary}
      complete    — full FactorStockResult
      error       — {message}
    """
    def _event(payload: dict) -> str:
        return f"data: {_json.dumps(payload)}\n\n"

    def generate():
        try:
            tickers = [req.ticker.upper(), "SPY", req.sector_etf.upper()]
            yield _event({"type": "fetching", "tickers": tickers})

            price, spy, sector = fetch_factor_stock_prices(
                req.ticker, req.sector_etf, req.lookback_days
            )
            yield _event({
                "type": "step",
                "text": f"Downloaded {len(price)} trading days  ({price.index[0].strftime('%Y-%m-%d')} → {price.index[-1].strftime('%Y-%m-%d')})",
                "kind": "info",
            })

            yield _event({"type": "step", "text": "Computing factor returns + SPY momentum", "kind": "info"})
            returns = prepare_aligned_returns_single(price, spy, sector, req.zscore_window)
            yield _event({
                "type": "step",
                "text": f"{len(returns)} observations after momentum warmup",
                "kind": "info",
            })

            yield _event({"type": "step", "text": f"Regressing {req.ticker.upper()} on 3 factors", "kind": "info"})
            _, resid, loadings = fit_factor_model(returns, "p1")
            yield _event({
                "type": "regression",
                "ticker": req.ticker.upper(),
                "r_squared": loadings["r_squared"],
                "market": loadings["market"],
                "sector": loadings["sector"],
                "momentum": loadings["momentum"],
            })

            yield _event({"type": "step", "text": "Running ADF test on residual ε", "kind": "info"})
            result = analyze_factor_stock(price, spy, sector, req.zscore_window, req.ticker, req.sector_etf)
            yield _event({
                "type": "adf_result",
                "p_value": result["adf"]["p_value"],
                "is_stationary": result["adf"]["is_stationary"],
            })

            yield _event({"type": "complete", "result": result})

        except ValueError as exc:
            yield _event({"type": "error", "message": str(exc)})
        except Exception as exc:
            yield _event({"type": "error", "message": f"Factor analysis failed: {exc}"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/factor-analyze")
def factor_analyze(req: FactorAnalyzeRequest) -> dict:
    """
    3-factor decomposition of a stock pair using SPY (market), a sector ETF, and
    SPY momentum (12-minus-1-month). Returns factor loadings and residual spread
    cointegration stats for both stocks.
    """
    try:
        p1, p2, spy, sector = fetch_factor_prices(
            req.ticker1, req.ticker2, req.sector_etf, req.lookback_days
        )
        return analyze_factor_pair(p1, p2, spy, sector, req.zscore_window, req.ticker1, req.ticker2)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Factor analysis failed: {exc}")


@app.post("/api/factor-analyze/stream")
def factor_analyze_stream(req: FactorAnalyzeRequest) -> StreamingResponse:
    """
    SSE stream of the 3-factor analysis pipeline.

    Events (JSON in data: field):
      fetching      — {tickers}
      step          — {text, kind}  progress log line
      regression    — {ticker, r_squared, market, sector, momentum}
      adf_result    — {p_value, is_stationary}
      complete      — full factor analysis result
      error         — {message}
    """
    def _event(payload: dict) -> str:
        return f"data: {_json.dumps(payload)}\n\n"

    def generate():
        try:
            tickers = [req.ticker1.upper(), req.ticker2.upper(), "SPY", req.sector_etf.upper()]
            yield _event({"type": "fetching", "tickers": tickers})

            p1, p2, spy, sector = fetch_factor_prices(
                req.ticker1, req.ticker2, req.sector_etf, req.lookback_days
            )
            yield _event({
                "type": "step",
                "text": f"Downloaded {len(p1)} trading days  ({p1.index[0].strftime('%Y-%m-%d')} → {p1.index[-1].strftime('%Y-%m-%d')})",
                "kind": "info",
            })

            yield _event({"type": "step", "text": "Computing factor returns + SPY momentum", "kind": "info"})
            returns = prepare_aligned_returns(p1, p2, spy, sector, req.zscore_window)
            yield _event({
                "type": "step",
                "text": f"{len(returns)} observations after momentum warmup",
                "kind": "info",
            })

            yield _event({"type": "step", "text": f"Regressing {req.ticker1.upper()} on 3 factors", "kind": "info"})
            _, resid1, loadings1 = fit_factor_model(returns, "p1")
            yield _event({
                "type": "regression",
                "ticker": req.ticker1.upper(),
                "r_squared": loadings1["r_squared"],
                "market": loadings1["market"],
                "sector": loadings1["sector"],
                "momentum": loadings1["momentum"],
            })

            yield _event({"type": "step", "text": f"Regressing {req.ticker2.upper()} on 3 factors", "kind": "info"})
            _, resid2, loadings2 = fit_factor_model(returns, "p2")
            yield _event({
                "type": "regression",
                "ticker": req.ticker2.upper(),
                "r_squared": loadings2["r_squared"],
                "market": loadings2["market"],
                "sector": loadings2["sector"],
                "momentum": loadings2["momentum"],
            })

            yield _event({"type": "step", "text": "Computing residual spread + ADF test", "kind": "info"})
            stats = compute_spread_stats(resid1, resid2, req.zscore_window)
            yield _event({
                "type": "adf_result",
                "p_value": stats["adf"]["p_value"],
                "is_stationary": stats["adf"]["is_stationary"],
            })

            result = {
                "ticker1": req.ticker1.upper(),
                "ticker2": req.ticker2.upper(),
                "factor_loadings": {"ticker1": loadings1, "ticker2": loadings2},
                **stats,
            }
            yield _event({"type": "complete", "result": result})

        except ValueError as exc:
            yield _event({"type": "error", "message": str(exc)})
        except Exception as exc:
            yield _event({"type": "error", "message": f"Factor analysis failed: {exc}"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/backtest")
def backtest(req: BacktestRequest) -> dict:
    """
    Simulate the pairs trading strategy and return equity curve + performance metrics.

    Combines cointegration + backtest in one call so the frontend can
    run both in parallel with /api/analyze.
    """
    try:
        p1, p2 = fetch_prices(req.ticker1, req.ticker2, req.lookback_days)

        spy = None
        try:
            spy = fetch_benchmark("SPY", req.lookback_days)
        except Exception:
            pass  # benchmark is optional — don't fail the backtest if SPY is unavailable

        return run_backtest(
            p1, p2,
            req.zscore_window,
            req.entry_z,
            req.exit_z,
            req.stop_z,
            req.transaction_cost_bps,
            req.insample_pct,
            req.use_kalman,
            req.use_regime,
            req.use_log_prices,
            max_holding_days=req.max_holding_days,
            use_halflife_hold=req.use_halflife_hold,
            spy=spy,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}")
