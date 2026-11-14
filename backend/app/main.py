"""FastAPI service exposing long-range agricultural weather forecasts.

Run:  uvicorn app.main:app --reload
Docs: http://127.0.0.1:8000/docs
"""
import os
import threading
import time
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .calibration import (
    CALIBRATABLE, apply_corrections, compute_corrections, delete_station_data, load_station_data, save_station_data,
)
from .data import RateLimited, fetch_climate_indices, fetch_daily, fetch_projections
from .ensemble import forecast_location
from .features import MONTHLY_VARIABLES, to_monthly
from .members import MAX_HORIZON_MONTHS, PROPHET_AVAILABLE
from .risk import BASE_YEARS, RECENT_YEARS, seasonal_risk
from .seasonal import fetch_seasonal

# Meta Prophet as an extra ensemble member (on by default when installed; USE_PROPHET=0 disables)
USE_PROPHET = PROPHET_AVAILABLE and os.environ.get("USE_PROPHET", "1") != "0"

app = FastAPI(
    title="Agri Weather Forecast API",
    description=(
        "Monthly climate forecasts 1–3 years ahead for agricultural planning. Built from ERA5 reanalysis "
        "(optionally calibrated to your own weather station), CMIP6 climate projections and ENSO/NAO/PDO "
        "climate drivers, combined by a backtested ensemble. These are expected monthly conditions with "
        "uncertainty ranges, not day-by-day weather."
    ),
    version="2.0.0",
)

# The Terra Tuta frontend talks to this API either through its own dev-server proxy (/api/climate/*)
# or directly from the browser. CORS_ORIGINS="https://a.example,https://b.example" restricts the
# allowed origins; the default is open so the hackathon demo works from any host.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

LatQuery = Query(..., ge=-90, le=90, description="Latitude in decimal degrees")
LonQuery = Query(..., ge=-180, le=180, description="Longitude in decimal degrees")


def _key(lat: float, lon: float) -> Tuple[float, float]:
    return round(lat, 2), round(lon, 2)


@lru_cache(maxsize=32)
def _daily(lat: float, lon: float) -> Tuple[pd.DataFrame, Dict]:
    """Reanalysis history, corrected toward the station if one was uploaded."""
    daily = fetch_daily(lat, lon)
    station = load_station_data(lat, lon)
    corrections = compute_corrections(daily, station) if station is not None else {}
    return (apply_corrections(daily, corrections) if corrections else daily), corrections


# A complete result is kept for the life of the process. A degraded one (some CMIP6 models failed,
# e.g. Open-Meteo rate limit) is kept for DEGRADED_TTL_S only, so a later request retries the models
# without every request in between re-training the whole ensemble.
DEGRADED_TTL_S = float(os.environ.get("DEGRADED_CACHE_TTL_S", 900))
_location_cache: Dict[Tuple[float, float], Tuple[Dict, Optional[float]]] = {}  # key -> (result, expiry or None)
_location_locks: Dict[Tuple[float, float], threading.Lock] = {}
_locks_guard = threading.Lock()


def _location(lat: float, lon: float) -> Dict:
    key = (lat, lon)
    with _locks_guard:
        lock = _location_locks.setdefault(key, threading.Lock())
    # One training run per location: concurrent requests (the frontend asks /agri-summary and /risk
    # in parallel) wait for it instead of training the same ensemble several times at once.
    with lock:
        cached = _location_cache.get(key)
        if cached is not None and (cached[1] is None or cached[1] > time.monotonic()):
            return cached[0]
        result = _train_location(lat, lon)
        degraded = bool(result["sources"]["climate_projection_errors"])
        _location_cache[key] = (result, time.monotonic() + DEGRADED_TTL_S if degraded else None)
        return result


def _train_location(lat: float, lon: float) -> Dict:
    daily, corrections = _daily(lat, lon)
    projections, cmip_models, cmip_errors = fetch_projections(lat, lon)
    indices = fetch_climate_indices()
    seasonal, seasonal_error = fetch_seasonal(lat, lon, download=False)
    result = forecast_location(daily, projections, indices, use_prophet=USE_PROPHET, seasonal=seasonal)
    result["sources"] = {
        "history": "Open-Meteo Historical API (ERA5/ERA5-Land reanalysis), 1980 onwards",
        "prophet_member": USE_PROPHET,
        "seasonal_forecast": (
            f"ECMWF SEAS5 via Copernicus, starts {seasonal.index.get_level_values(0).min():%Y-%m} – "
            f"{seasonal.index.get_level_values(0).max():%Y-%m}" if seasonal is not None else None
        ),
        "seasonal_forecast_error": seasonal_error,
        "station_calibration": sorted(corrections) or None,
        "climate_projections": cmip_models or None,
        "climate_projection_errors": cmip_errors or None,
        "climate_indices": {
            c: indices[c].dropna().index[-1].strftime("%Y-%m") for c in indices.columns if indices[c].notna().any()
        } or None,
    }
    return result


def _clear_caches():
    _daily.cache_clear()
    _location_cache.clear()


def _upstream(fn, *args):
    try:
        return fn(*args)
    except RateLimited as exc:
        raise HTTPException(status_code=429, detail=f"Open-Meteo rate limit: {exc}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load data: {exc}")


def _parse_variables(variables: Optional[str]) -> List[str]:
    if not variables:
        return list(MONTHLY_VARIABLES)
    names = [v.strip() for v in variables.split(",") if v.strip()]
    unknown = [v for v in names if v not in MONTHLY_VARIABLES]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown variables: {unknown}. See /variables.")
    return names


@app.get("/")
def root():
    return {
        "status": "ok",
        "docs": "/docs",
        "endpoints": ["/variables", "/history", "/forecast", "/agri-summary", "/risk", "/calibration"],
    }


@app.get("/variables")
def variables():
    """All forecast variables, their units and why they matter for agriculture."""
    return [
        {"name": name, "monthly_aggregation": how, "unit": unit, "agricultural_relevance": why}
        for name, (how, unit, why) in MONTHLY_VARIABLES.items()
    ]


@app.get("/history")
def history(
    lat: float = LatQuery,
    lon: float = LonQuery,
    start_year: int = Query(2000, ge=1980),
    variables: Optional[str] = Query(None, description="Comma-separated, e.g. 'precip,gdd'. Default: all"),
):
    """Observed monthly values (station-calibrated if a station was uploaded)."""
    names = _parse_variables(variables)
    daily, _ = _upstream(_daily, *_key(lat, lon))
    df = to_monthly(daily)
    df = df[df.index.year >= start_year][names].round(3)
    return {
        "latitude": lat,
        "longitude": lon,
        "months": [{"month": idx.strftime("%Y-%m"), **row.to_dict()} for idx, row in df.iterrows()],
    }


@app.get("/forecast")
def forecast(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3, description="Forecast horizon in years"),
    variables: Optional[str] = Query(None, description="Comma-separated, e.g. 'tmean,precip'. Default: all"),
):
    """Monthly ensemble forecast with 80 % range, per-model values and out-of-sample backtest skill.

    The first request for a new location downloads data and trains all models (~30–60 s).
    """
    names = _parse_variables(variables)
    result = _upstream(_location, *_key(lat, lon))
    months = min(years * 12, MAX_HORIZON_MONTHS)
    return {
        "latitude": lat,
        "longitude": lon,
        "trained_until": result["trained_until"],
        "horizon_months": months,
        "sources": result["sources"],
        "variables": {
            name: {
                "unit": MONTHLY_VARIABLES[name][1],
                "backtest": result["variables"][name]["backtest"],
                "forecast": result["variables"][name]["forecast"][:months],
            }
            for name in names
        },
    }


@app.get("/agri-summary")
def agri_summary(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3),
):
    """Per calendar year: key farming indicators vs. the 1991–2020 normal for the same months."""
    key = _key(lat, lon)
    result = _upstream(_location, *key)
    daily, _ = _daily(*key)
    df = to_monthly(daily)
    months = min(years * 12, MAX_HORIZON_MONTHS)
    keys = ["gdd", "precip", "et0", "water_balance", "frost_days", "heat_days", "wet_days", "tmean", "soil_moisture_root"]

    fc = pd.DataFrame({
        k: {pd.Timestamp(r["month"]): r["forecast"] for r in result["variables"][k]["forecast"][:months]}
        for k in keys
    })
    normal_period = df[(df.index.year >= 1991) & (df.index.year <= 2020)]
    normals = normal_period[keys].groupby(normal_period.index.month).mean()

    summary = []
    for year, block in fc.groupby(fc.index.year):
        norm = normals.loc[block.index.month]
        entry = {
            "year": int(year),
            "months_covered": f"{block.index[0]:%Y-%m} – {block.index[-1]:%Y-%m}",
            "complete_year": len(block) == 12,
            "indicators": {},
        }
        for k in keys:
            how, unit, _ = MONTHLY_VARIABLES[k]
            value = block[k].sum() if how == "sum" else block[k].mean()
            normal = norm[k].sum() if how == "sum" else norm[k].mean()
            digits = 3 if unit == "m³/m³" else 1
            entry["indicators"][k] = {
                "forecast": round(float(value), digits),
                "normal_1991_2020": round(float(normal), digits),
                "anomaly": round(float(value - normal), digits),
                "unit": unit,
            }
        entry["deficit_months"] = [f"{m:%Y-%m}" for m in block.index[block["water_balance"] < 0]]
        entry["frost_free_months"] = int((block["frost_days"] < 0.5).sum())
        summary.append(entry)

    return {"latitude": lat, "longitude": lon, "sources": result["sources"], "summary": summary}


@app.get("/risk")
def risk(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3),
):
    """Per season: probability of a dry, wet, drought, hot or frost season, and the irrigation need.

    Compare `probability` with `normal_probability` (1991–2020) and with how often it actually happened
    recently. For rain the forecast has little skill, so the main signal is the climate trend.
    """
    key = _key(lat, lon)
    result = _upstream(_location, *key)
    daily, _ = _daily(*key)
    months = min(years * 12, MAX_HORIZON_MONTHS)
    forecasts = {v: r["forecast"][:months] for v, r in result["variables"].items()}
    return {
        "latitude": lat,
        "longitude": lon,
        "method": (f"Observed weather of {BASE_YEARS[0]}–{BASE_YEARS[1]} shifted by the forecast → 30 possible "
                   f"outcomes per season; thresholds from {BASE_YEARS[0]}–{BASE_YEARS[1]}; "
                   f"'observed_last_{RECENT_YEARS}_years' shows what actually happened recently"),
        "sources": result["sources"],
        "seasons": seasonal_risk(daily, forecasts),
    }


@app.post("/calibration")
async def upload_station(lat: float = LatQuery, lon: float = LonQuery, file: UploadFile = File(...)):
    """Upload daily station observations (CSV) to calibrate this location.

    Columns: `date` (YYYY-MM-DD) plus any of the calibratable variables, e.g.
    `date,tmax,tmin,precip`. At least 365 days overlapping 1980–today are needed per variable.
    """
    try:
        station = save_station_data(lat, lon, await file.read())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _clear_caches()
    return {
        "stored_columns": list(station.columns),
        "date_range": [f"{station.index[0]:%Y-%m-%d}", f"{station.index[-1]:%Y-%m-%d}"],
        **get_calibration(lat, lon),
    }


@app.get("/calibration")
def get_calibration(lat: float = LatQuery, lon: float = LonQuery):
    """Corrections currently applied to this location (per variable and calendar month)."""
    if load_station_data(lat, lon) is None:
        return {"calibrated": False, "calibratable_variables": sorted(CALIBRATABLE)}
    _, corrections = _upstream(_daily, *_key(lat, lon))
    return {"calibrated": bool(corrections), "corrections": corrections}


@app.delete("/calibration")
def remove_calibration(lat: float = LatQuery, lon: float = LonQuery):
    removed = delete_station_data(lat, lon)
    _clear_caches()
    return {"removed": removed}
