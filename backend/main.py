"""FastAPI application — pairs trading analysis and backtesting endpoints."""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from backtest import run_backtest
from cointegration import analyze_pair
from data import fetch_prices

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

    @model_validator(mode="after")
    def check_thresholds(self) -> "BacktestRequest":
        if self.exit_z >= self.entry_z:
            raise ValueError("exit_z must be strictly less than entry_z.")
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
        return analyze_pair(p1, p2, req.zscore_window)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")


@app.post("/api/backtest")
def backtest(req: BacktestRequest) -> dict:
    """
    Simulate the pairs trading strategy and return equity curve + performance metrics.

    Combines cointegration + backtest in one call so the frontend can
    run both in parallel with /api/analyze.
    """
    try:
        p1, p2 = fetch_prices(req.ticker1, req.ticker2, req.lookback_days)
        return run_backtest(p1, p2, req.zscore_window, req.entry_z, req.exit_z)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc}")
