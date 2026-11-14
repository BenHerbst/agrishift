"""Data sources, all cached on disk under data_cache/.

* Observations:       Open-Meteo Historical API (ERA5 / ERA5-Land reanalysis), daily, 1980 → last full month.
* Climate projections: Open-Meteo Climate API (CMIP6 HighResMIP, ~10–50 km), daily 2000–2040, stored monthly.
* Climate drivers:    NOAA monthly indices – ENSO (Niño 3.4), NAO, PDO.

Open-Meteo's free tier counts long requests as many calls (≈1 call per 2 weeks of data). One new
location costs roughly 1,300 calls for the history plus ~1,100 per climate model, against a limit of
5,000 per hour / 10,000 per day. Set OPEN_METEO_API_KEY to use the commercial endpoints instead.
"""
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests

CACHE_DIR = Path(__file__).resolve().parent.parent / "data_cache"
HISTORY_START = "1980-01-01"

API_KEY = os.environ.get("OPEN_METEO_API_KEY")
_PREFIX = "customer-" if API_KEY else ""
ARCHIVE_URL = f"https://{_PREFIX}archive-api.open-meteo.com/v1/archive"
CLIMATE_URL = f"https://{_PREFIX}climate-api.open-meteo.com/v1/climate"

# Open-Meteo name -> short column name used everywhere else
DAILY_VARS = {
    "temperature_2m_max": "tmax",
    "temperature_2m_min": "tmin",
    "temperature_2m_mean": "tmean",
    "precipitation_sum": "precip",
    "et0_fao_evapotranspiration": "et0",
    "shortwave_radiation_sum": "radiation",
    "wind_speed_10m_max": "wind_max",
    "relative_humidity_2m_mean": "humidity",
    "soil_moisture_0_to_7cm_mean": "soil_moisture",
    "soil_moisture_7_to_28cm_mean": "soil_moisture_7_28",
    "soil_moisture_28_to_100cm_mean": "soil_moisture_28_100",
}

CMIP_MODELS = os.environ.get("CMIP_MODELS", "EC_Earth3P_HR,MPI_ESM1_2_XR,MRI_AGCM3_2_S").split(",")
CMIP_START, CMIP_END = "2000-01-01", "2040-12-31"
CMIP_VARS = {
    "temperature_2m_max": "tmax",
    "temperature_2m_min": "tmin",
    "temperature_2m_mean": "tmean",
    "precipitation_sum": "precip",
    "et0_fao_evapotranspiration_sum": "et0",
    "shortwave_radiation_sum": "radiation",
    "wind_speed_10m_max": "wind_max",
    "relative_humidity_2m_mean": "humidity",
    "soil_moisture_0_to_10cm_mean": "soil_moisture",
}
CMIP_SUM_VARS = {"precip", "et0", "radiation"}

INDEX_MAX_AGE = timedelta(days=3)


class RateLimited(RuntimeError):
    pass


def _get(url: str, params: Dict, retries: int = 3) -> Dict:
    if API_KEY:
        params = {**params, "apikey": API_KEY}
    for attempt in range(retries):
        resp = requests.get(url, params=params, timeout=180)
        if resp.status_code == 429:
            reason = resp.json().get("reason", "rate limited")
            if "Minutely" in reason and attempt < retries - 1:
                time.sleep(61)
                continue
            raise RateLimited(reason)
        if resp.status_code == 400:
            raise RuntimeError(resp.json().get("reason", resp.text))
        resp.raise_for_status()
        return resp.json()
    raise RateLimited("still rate limited after retries")


def _daily_frame(daily: Dict, names: Dict[str, str], suffix: str = "") -> pd.DataFrame:
    df = pd.DataFrame({names[k[: len(k) - len(suffix)] if suffix and k.endswith(suffix) else k]: v
                       for k, v in daily.items() if k != "time"})
    df.index = pd.to_datetime(daily["time"])
    df.index.name = "date"
    return df.astype(float)


def _last_complete_month_end() -> date:
    # The archive lags real time by ~5 days, so stop at the end of the previous full month.
    first_of_this_month = (date.today() - timedelta(days=7)).replace(day=1)
    return first_of_this_month - timedelta(days=1)


def fetch_daily(lat: float, lon: float, start: str = HISTORY_START, end: Optional[str] = None) -> pd.DataFrame:
    """Daily reanalysis history. Only columns missing from the cache are downloaded."""
    lat, lon = round(lat, 2), round(lon, 2)
    end = end or _last_complete_month_end().isoformat()
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{lat}_{lon}_{start}_{end}.csv"

    cached = pd.read_csv(cache_file, index_col="date", parse_dates=True) if cache_file.exists() else None
    missing = [k for k, v in DAILY_VARS.items() if cached is None or v not in cached.columns]
    if missing:
        data = _get(ARCHIVE_URL, {
            "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
            "daily": ",".join(missing), "timezone": "auto",
        })
        new = _daily_frame(data["daily"], DAILY_VARS)
        cached = new if cached is None else cached.join(new)
        cached.to_csv(cache_file)
    return cached[list(DAILY_VARS.values())]


def _cmip_monthly(daily: pd.DataFrame) -> pd.DataFrame:
    agg = {c: ("sum" if c in CMIP_SUM_VARS else "mean") for c in daily.columns}
    # Some climate models use 365/360-day calendars; scale sums to the true month length.
    monthly = daily.resample("MS").agg(agg)
    counts = daily.resample("MS").count()
    for c in CMIP_SUM_VARS & set(daily.columns):
        monthly[c] = monthly[c] * monthly.index.days_in_month / counts[c].replace(0, np.nan)
    return monthly


def fetch_projections(lat: float, lon: float) -> Tuple[Optional[pd.DataFrame], List[str], List[str]]:
    """Monthly CMIP6 multi-model mean. Returns (frame or None, models used, errors)."""
    lat, lon = round(lat, 2), round(lon, 2)
    CACHE_DIR.mkdir(exist_ok=True)
    frames, used, errors = [], [], []
    for model in CMIP_MODELS:
        cache_file = CACHE_DIR / f"cmip_{model}_{lat}_{lon}_{CMIP_START}_{CMIP_END}.csv"
        try:
            if cache_file.exists():
                monthly = pd.read_csv(cache_file, index_col="date", parse_dates=True)
            else:
                data = _get(CLIMATE_URL, {
                    "latitude": lat, "longitude": lon, "start_date": CMIP_START, "end_date": CMIP_END,
                    "models": model, "daily": ",".join(CMIP_VARS),
                })
                monthly = _cmip_monthly(_daily_frame(data["daily"], CMIP_VARS, suffix=f"_{model}"))
                monthly.to_csv(cache_file)
            frames.append(monthly)
            used.append(model)
        except Exception as exc:
            errors.append(f"{model}: {exc}")
    if not frames:
        return None, used, errors
    return pd.concat(frames).groupby(level=0).mean(), used, errors


# ---------------------------------------------------------------- climate indices (NOAA)

def _parse_nino34(text: str) -> pd.Series:
    rows = [line.split() for line in text.splitlines()[1:] if line.strip()]
    return pd.Series({pd.Timestamp(int(r[0]), int(r[1]), 1): float(r[-1]) for r in rows})


def _parse_nao(text: str) -> pd.Series:
    rows = [line.split() for line in text.splitlines() if line.strip()]
    return pd.Series({pd.Timestamp(int(r[0]), int(r[1]), 1): float(r[2]) for r in rows})


def _parse_pdo(text: str) -> pd.Series:
    values = {}
    for line in text.splitlines():
        parts = line.split()
        if not parts or not parts[0].isdigit():
            continue
        for month, v in enumerate(parts[1:13], start=1):
            if abs(float(v)) < 99:
                values[pd.Timestamp(int(parts[0]), month, 1)] = float(v)
    return pd.Series(values)


INDEX_SOURCES = {
    "nino34": ("https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices", _parse_nino34),
    "nao": ("https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/norm.nao.monthly.b5001.current.ascii", _parse_nao),
    "pdo": ("https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat", _parse_pdo),
}


def fetch_climate_indices() -> pd.DataFrame:
    """Monthly ENSO/NAO/PDO indices. Falls back to a stale cache, or an empty frame, if NOAA is down."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / "climate_indices.csv"
    fresh = cache_file.exists() and datetime.now() - datetime.fromtimestamp(cache_file.stat().st_mtime) < INDEX_MAX_AGE
    if not fresh:
        try:
            series = {}
            for name, (url, parse) in INDEX_SOURCES.items():
                resp = requests.get(url, timeout=60)
                resp.raise_for_status()
                series[name] = parse(resp.text)
            df = pd.DataFrame(series).sort_index()
            df.index.name = "date"
            df.to_csv(cache_file)
            return df
        except Exception:
            if not cache_file.exists():
                return pd.DataFrame(columns=list(INDEX_SOURCES))
    return pd.read_csv(cache_file, index_col="date", parse_dates=True)
