"""FastAPI application — pairs trading analysis and backtesting endpoints."""
from __future__ import annotations

import json as _json
from itertools import combinations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from typing import Optional

from backtest import compute_max_drawdown, compute_sharpe, run_backtest
from cointegration import analyze_pair, scan_pair
from data import fetch_benchmark, fetch_factor_prices, fetch_factor_stock_prices, fetch_prices, fetch_prices_batch, fetch_sectors
from universes import UNIVERSE_LABELS, UNIVERSES
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
    use_vol_target: bool = Field(default=False)
    max_holding_days: Optional[int] = Field(default=None, ge=5, le=200)
    use_halflife_hold: bool = Field(default=False)
    halflife_multiplier: float = Field(default=2.0, ge=0.5, le=2.0)

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


class UniverseScanRequest(BaseModel):
    universe: str = Field(default="sp100")
    top_n: int = Field(default=50, ge=5, le=500)
    corr_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    lookback_days: int = Field(default=365, ge=90, le=1825)
    zscore_window: int = Field(default=30, ge=10, le=120)
    entry_z: float = Field(default=2.0, ge=0.5, le=4.0)
    exit_z: float = Field(default=0.5, ge=0.0, le=2.0)
    stop_z: float = Field(default=4.0, ge=2.5, le=6.0)
    transaction_cost_bps: float = Field(default=5.0, ge=0.0, le=50.0)
    insample_pct: float = Field(default=0.7, ge=0.5, le=0.9)
    use_kalman: bool = Field(default=False)
    use_regime: bool = Field(default=False)
    use_log_prices: bool = Field(default=False)
    use_vol_target: bool = Field(default=False)
    max_holding_days: Optional[int] = Field(default=None, ge=5, le=200)
    use_halflife_hold: bool = Field(default=False)
    halflife_multiplier: float = Field(default=2.0, ge=0.5, le=2.0)

    @model_validator(mode="after")
    def check_valid(self) -> "UniverseScanRequest":
        if self.universe not in UNIVERSES:
            raise ValueError(f"universe must be one of: {', '.join(UNIVERSES.keys())}.")
        if self.lookback_days < self.zscore_window * 3:
            raise ValueError(
                f"lookback_days ({self.lookback_days}) must be at least "
                f"3× zscore_window ({self.zscore_window * 3} days minimum)."
            )
        if self.exit_z >= self.entry_z:
            raise ValueError("exit_z must be strictly less than entry_z.")
        if self.entry_z >= self.stop_z:
            raise ValueError("stop_z must be strictly greater than entry_z.")
        return self


@app.post("/api/universe/stream")
def universe_scan_stream(req: UniverseScanRequest) -> StreamingResponse:
    """
    SSE stream of the full universe scan pipeline:
      fetch prices → correlation filter → cointegration → BH correction → backtest → rank

    Events (JSON in data: field):
      fetching          — {universe, label, count}
      fetch_done        — {loaded}
      correlation_done  — {total_pairs, passed}
      coint_progress    — {done, total}  (periodic, every 100 pairs)
      coint_done        — {cointegrated}
      bh_correction     — {significant}
      backtest_progress — {done, total}  (periodic, every 10 pairs)
      complete          — {pairs, universe, label, total_backtested}
      error             — {message}
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed as futures_as_completed
    from statsmodels.stats.multitest import multipletests

    def _event(payload: dict) -> str:
        return f"data: {_json.dumps(payload)}\n\n"

    def _run_coint(args):
        t1, t2, corr, prices, zscore_window = args
        result = scan_pair(prices[t1], prices[t2], t1, t2, zscore_window)
        result["correlation"] = round(corr, 4)
        return result

    def _run_backtest(args):
        t1, t2, prices, req_ = args
        bt = run_backtest(
            prices[t1], prices[t2],
            req_.zscore_window, req_.entry_z, req_.exit_z, req_.stop_z,
            req_.transaction_cost_bps, req_.insample_pct,
            req_.use_kalman, req_.use_regime, req_.use_log_prices,
            max_holding_days=req_.max_holding_days,
            use_halflife_hold=req_.use_halflife_hold,
            halflife_multiplier=req_.halflife_multiplier,
            use_vol_target=req_.use_vol_target,
        )
        return {"ticker1": t1, "ticker2": t2, "metrics": bt["metrics"]}

    def generate():
        try:
            tickers = UNIVERSES[req.universe]
            label = UNIVERSE_LABELS[req.universe]
            yield _event({"type": "fetching", "universe": req.universe, "label": label, "count": len(tickers)})

            prices = fetch_prices_batch(tickers, req.lookback_days)
            available = list(prices.columns)
            yield _event({"type": "fetch_done", "loaded": len(available)})

            # Pairwise correlation filter (vectorized)
            returns = prices.pct_change().dropna()
            corr_matrix = returns.corr().abs()

            all_pairs = list(combinations(available, 2))
            filtered: list[tuple[str, str, float]] = []
            for t1, t2 in all_pairs:
                corr = float(corr_matrix.loc[t1, t2])
                if corr >= req.corr_threshold:
                    filtered.append((t1, t2, corr))

            yield _event({"type": "correlation_done", "total_pairs": len(all_pairs), "passed": len(filtered)})

            if not filtered:
                yield _event({"type": "complete", "pairs": [], "universe": req.universe, "label": label, "total_backtested": 0})
                return

            # Cointegration tests (parallelised)
            coint_results: list[dict] = []
            workers = min(16, len(filtered))
            coint_args = [(t1, t2, corr, prices, req.zscore_window) for t1, t2, corr in filtered]

            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {executor.submit(_run_coint, args): args for args in coint_args}
                done_count = 0
                for future in futures_as_completed(futures):
                    done_count += 1
                    try:
                        result = future.result()
                        coint_results.append(result)
                    except Exception:
                        pass
                    if done_count % 100 == 0 or done_count == len(filtered):
                        yield _event({"type": "coint_progress", "done": done_count, "total": len(filtered)})

            cointegrated = [r for r in coint_results if r.get("is_cointegrated")]
            yield _event({"type": "coint_done", "cointegrated": len(cointegrated)})

            # Benjamini-Hochberg correction
            if len(coint_results) > 1:
                pvalues = [r["pvalue"] for r in coint_results]
                _, adj_pvalues, _, _ = multipletests(pvalues, alpha=0.1, method="fdr_bh")
                for r, adj_p in zip(coint_results, adj_pvalues):
                    r["adjusted_pvalue"] = round(float(adj_p), 4)
                    r["bh_significant"] = bool(adj_p < 0.1)
            else:
                for r in coint_results:
                    r["adjusted_pvalue"] = r["pvalue"]
                    r["bh_significant"] = bool(r["pvalue"] < 0.1)

            bh_pairs = [r for r in coint_results if r.get("bh_significant")]
            yield _event({"type": "bh_correction", "significant": len(bh_pairs)})

            if not bh_pairs:
                yield _event({"type": "complete", "pairs": [], "universe": req.universe, "label": label, "total_backtested": 0})
                return

            # Backtest each BH-significant pair (parallelised)
            bt_args = [(r["ticker1"], r["ticker2"], prices, req) for r in bh_pairs]
            bt_results: dict[str, dict] = {}

            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {executor.submit(_run_backtest, args): args for args in bt_args}
                done_count = 0
                for future in futures_as_completed(futures):
                    done_count += 1
                    try:
                        bt = future.result()
                        key = f"{bt['ticker1']}:{bt['ticker2']}"
                        bt_results[key] = bt
                    except Exception:
                        pass
                    if done_count % 10 == 0 or done_count == len(bh_pairs):
                        yield _event({"type": "backtest_progress", "done": done_count, "total": len(bh_pairs)})

            # Merge coint stats + backtest metrics and rank by Sharpe
            combined: list[dict] = []
            for r in bh_pairs:
                key = f"{r['ticker1']}:{r['ticker2']}"
                bt = bt_results.get(key)
                if bt is None:
                    continue
                metrics = bt["metrics"]
                combined.append({
                    "ticker1": r["ticker1"],
                    "ticker2": r["ticker2"],
                    "pvalue": r["pvalue"],
                    "adjusted_pvalue": r["adjusted_pvalue"],
                    "hedge_ratio": r["hedge_ratio"],
                    "half_life": r.get("half_life"),
                    "correlation": r.get("correlation"),
                    "sharpe_ratio": metrics["sharpe_ratio"],
                    "total_return": metrics["total_return"],
                    "max_drawdown": metrics["max_drawdown"],
                    "num_trades": metrics["num_trades"],
                    "win_rate": metrics.get("win_rate"),
                    "profit_factor": metrics.get("profit_factor"),
                    "calmar_ratio": metrics.get("calmar_ratio"),
                })

            combined.sort(key=lambda x: x["sharpe_ratio"], reverse=True)
            top = combined[: req.top_n]

            yield _event({
                "type": "complete",
                "pairs": top,
                "universe": req.universe,
                "label": label,
                "total_backtested": len(combined),
            })

        except ValueError as exc:
            yield _event({"type": "error", "message": str(exc)})
        except Exception as exc:
            yield _event({"type": "error", "message": f"Universe scan failed: {exc}"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class PairSpec(BaseModel):
    ticker1: str = Field(..., min_length=1, max_length=10)
    ticker2: str = Field(..., min_length=1, max_length=10)


class PortfolioBacktestRequest(BaseModel):
    pairs: list[PairSpec] = Field(..., min_length=2, max_length=50)
    lookback_days: int = Field(default=365, ge=90, le=1825)
    zscore_window: int = Field(default=30, ge=10, le=120)
    entry_z: float = Field(default=2.0, ge=0.5, le=4.0)
    exit_z: float = Field(default=0.5, ge=0.0, le=2.0)
    stop_z: float = Field(default=4.0, ge=2.5, le=6.0)
    transaction_cost_bps: float = Field(default=5.0, ge=0.0, le=50.0)
    insample_pct: float = Field(default=0.7, ge=0.5, le=0.9)
    use_kalman: bool = Field(default=False)
    use_regime: bool = Field(default=False)
    use_log_prices: bool = Field(default=False)
    use_vol_target: bool = Field(default=False)
    max_holding_days: Optional[int] = Field(default=None, ge=5, le=200)
    use_halflife_hold: bool = Field(default=False)
    halflife_multiplier: float = Field(default=2.0, ge=0.5, le=2.0)
    sizing_method: str = Field(default="equal", pattern="^(equal|inverse_vol|signal_strength)$")

    @model_validator(mode="after")
    def check_valid(self) -> "PortfolioBacktestRequest":
        if self.lookback_days < self.zscore_window * 3:
            raise ValueError(
                f"lookback_days ({self.lookback_days}) must be at least "
                f"3× zscore_window ({self.zscore_window * 3} days minimum)."
            )
        if self.exit_z >= self.entry_z:
            raise ValueError("exit_z must be strictly less than entry_z.")
        if self.entry_z >= self.stop_z:
            raise ValueError("stop_z must be strictly greater than entry_z.")
        return self


@app.post("/api/portfolio/backtest")
def portfolio_backtest(req: PortfolioBacktestRequest) -> dict:
    """
    Run equal-weight portfolio simulation across a list of pairs.

    Fetches prices for all unique tickers, backtests each pair independently,
    then averages daily OOS returns across pairs to produce a combined equity
    curve and portfolio-level metrics.
    """
    import pandas as pd
    from concurrent.futures import ThreadPoolExecutor, as_completed as futures_as_completed

    try:
        unique_tickers = list({t for p in req.pairs for t in (p.ticker1.upper(), p.ticker2.upper())})
        prices = fetch_prices_batch(unique_tickers, req.lookback_days)
        available = set(prices.columns)

        valid_pairs = [p for p in req.pairs if p.ticker1.upper() in available and p.ticker2.upper() in available]
        if len(valid_pairs) < 2:
            raise HTTPException(status_code=400, detail="Fewer than 2 valid pairs after price fetch.")

        def _run_one(pair: PairSpec):
            t1, t2 = pair.ticker1.upper(), pair.ticker2.upper()
            bt = run_backtest(
                prices[t1], prices[t2],
                req.zscore_window, req.entry_z, req.exit_z, req.stop_z,
                req.transaction_cost_bps, req.insample_pct,
                req.use_kalman, req.use_regime, req.use_log_prices,
                max_holding_days=req.max_holding_days,
                use_halflife_hold=req.use_halflife_hold,
                halflife_multiplier=req.halflife_multiplier,
                use_vol_target=req.use_vol_target,
            )
            return t1, t2, bt

        pair_results: list[tuple] = []
        with ThreadPoolExecutor(max_workers=min(16, len(valid_pairs))) as executor:
            futures_map = {executor.submit(_run_one, p): p for p in valid_pairs}
            for future in futures_as_completed(futures_map):
                try:
                    pair_results.append(future.result())
                except Exception:
                    pass

        if not pair_results:
            raise HTTPException(status_code=400, detail="All pair backtests failed.")

        # Build per-pair OOS daily return series indexed by date
        returns_list = []
        for t1, t2, bt in pair_results:
            oos_data = [(d, e) for d, e in zip(bt["dates"], bt["equity_curve"]) if e is not None]
            if not oos_data:
                continue
            oos_dates, oos_equity = zip(*oos_data)
            s = pd.Series(list(oos_equity), index=pd.to_datetime(list(oos_dates)))
            ret = s.pct_change().fillna(0)
            returns_list.append(ret.rename(f"{t1}:{t2}"))

        if not returns_list:
            raise HTTPException(status_code=400, detail="No out-of-sample data available.")

        ret_df = pd.concat(returns_list, axis=1).fillna(0)

        # Compute per-pair weights based on sizing method
        pair_keys = [r.name for r in returns_list]
        n = len(pair_keys)

        if req.sizing_method == "inverse_vol":
            vols = ret_df.std()
            vols = vols.replace(0, float("nan")).fillna(vols.mean())
            raw_w = 1.0 / vols
        elif req.sizing_method == "signal_strength":
            # Weight by mean |entry_z| across completed trades
            strength: dict[str, float] = {}
            for t1, t2, bt in pair_results:
                key = f"{t1}:{t2}"
                completed = [tr for tr in bt.get("trades", []) if tr.get("exit_date")]
                if completed:
                    strength[key] = float(pd.Series([abs(tr["entry_z"]) for tr in completed]).mean())
                else:
                    strength[key] = 1.0
            raw_w = pd.Series({k: strength.get(k, 1.0) for k in pair_keys})
        else:
            raw_w = pd.Series({k: 1.0 for k in pair_keys})

        weights = raw_w / raw_w.sum()

        portfolio_ret = (ret_df * weights).sum(axis=1)
        portfolio_equity = (1 + portfolio_ret).cumprod() * 100

        total_return = float(portfolio_equity.iloc[-1] / 100 - 1)
        max_dd = compute_max_drawdown(portfolio_equity)
        sharpe = compute_sharpe(portfolio_ret)
        total_trades = sum(bt["metrics"]["num_trades"] for _, _, bt in pair_results)

        sorted_results = sorted(pair_results, key=lambda x: x[2]["metrics"]["sharpe_ratio"], reverse=True)

        return {
            "portfolio_equity": [round(float(v), 2) for v in portfolio_equity],
            "dates": portfolio_equity.index.strftime("%Y-%m-%d").tolist(),
            "portfolio_metrics": {
                "sharpe_ratio": round(sharpe, 3),
                "total_return": round(total_return, 4),
                "max_drawdown": round(max_dd, 4),
                "total_trades": total_trades,
            },
            "sizing_method": req.sizing_method,
            "pairs": [
                {
                    "ticker1": t1,
                    "ticker2": t2,
                    "metrics": bt["metrics"],
                    "weight": round(float(weights.get(f"{t1}:{t2}", 1.0 / n)), 4),
                }
                for t1, t2, bt in sorted_results
            ],
        }
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Portfolio backtest failed: {exc}")


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
            halflife_multiplier=req.halflife_multiplier,
            use_vol_target=req.use_vol_target,
            spy=spy,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}")
