"""ERA5-Land daily weather straight from the Copernicus Climate Data Store (primary source).

The CDS point time-series dataset (`reanalysis-era5-land-timeseries`, ~9 km, hourly, 1950 →
about 5 days ago) returns hourly CSVs that are aggregated here to local days (UTC shifted by
longitude / 15 h). ET0 isn't part of ERA5-Land, so it is computed with FAO-56 Penman-Monteith from
temperature, dew point, wind, radiation and pressure.

Downloads go through the CDS queue (usually well under a minute per decade, sometimes much longer),
so the API only reads the cache. Fill / update it with scripts/download_copernicus.py; the first
download is split into 10-year requests, later updates only fetch the missing days.
"""
import io
import logging
import zipfile
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from .data import CACHE_DIR, DAILY_VARS, HISTORY_START
from .et0 import WIND_10M_TO_2M, penman_monteith, saturation_vapour_pressure

log = logging.getLogger(__name__)

DATASET = "reanalysis-era5-land-timeseries"
ERA5LAND_DIR = CACHE_DIR / "era5land"
VARIABLES = [
    "2m_temperature", "2m_dewpoint_temperature", "total_precipitation", "surface_solar_radiation_downwards",
    "10m_u_component_of_wind", "10m_v_component_of_wind", "surface_pressure",
    "volumetric_soil_water_level_1", "volumetric_soil_water_level_2", "volumetric_soil_water_level_3",
]
CHUNK_YEARS = 10
LATENCY_DAYS = 6


def _cache_file(lat: float, lon: float):
    return ERA5LAND_DIR / f"{round(lat, 2)}_{round(lon, 2)}.csv"


def read_cache(lat: float, lon: float) -> Optional[pd.DataFrame]:
    path = _cache_file(lat, lon)
    if not path.exists():
        return None
    return pd.read_csv(path, index_col="date", parse_dates=True)[DAILY_VARS]


def hourly_to_daily(hourly: pd.DataFrame, lat: float, lon: float) -> pd.DataFrame:
    """Hourly ERA5-Land (CDS short names, SI units, UTC index) → daily columns as in DAILY_VARS."""
    local = hourly.copy()
    local.index = local.index + pd.Timedelta(hours=round(lon / 15))  # local solar day boundaries
    t = local["t2m"] - 273.15
    td = local["d2m"] - 273.15
    ea_hourly = saturation_vapour_pressure(td)
    local["rh"] = np.clip(100 * ea_hourly / saturation_vapour_pressure(t), 0, 100)
    local["ea"] = ea_hourly
    local["t"] = t
    local["wind"] = np.hypot(local["u10"], local["v10"])
    g = local.groupby(local.index.floor("D"))

    daily = pd.DataFrame({
        "tmax": g["t"].max(), "tmin": g["t"].min(), "tmean": g["t"].mean(),
        "precip": g["tp"].sum() * 1000,             # m → mm (hourly amounts)
        "radiation": g["ssrd"].sum() / 1e6,         # J/m² → MJ/m²
        "wind_max": g["wind"].max() * 3.6,          # m/s → km/h
        "humidity": g["rh"].mean(),
        "soil_moisture": g["swvl1"].mean(), "soil_moisture_7_28": g["swvl2"].mean(),
        "soil_moisture_28_100": g["swvl3"].mean(),
    })
    daily["et0"] = penman_monteith(daily["tmax"], daily["tmin"], daily["radiation"],
                                   g["wind"].mean() * WIND_10M_TO_2M, g["ea"].mean(), lat,
                                   daily.index.dayofyear, pressure_kpa=g["sp"].mean() / 1000)
    complete = g["t"].count() >= 23  # drop the partial first/last local day
    daily = daily[complete]
    daily.index.name = "date"
    return daily[DAILY_VARS]


def _read_zip(raw: bytes) -> pd.DataFrame:
    frames = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            if name.endswith(".csv"):
                df = pd.read_csv(z.open(name), parse_dates=["valid_time"]).set_index("valid_time")
                frames.append(df.drop(columns=[c for c in ("latitude", "longitude") if c in df]))
    return pd.concat(frames, axis=1).sort_index()


def _download(lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
    import cdsapi

    client = cdsapi.Client(quiet=True, progress=False)
    target = ERA5LAND_DIR / f".{round(lat, 2)}_{round(lon, 2)}_{start}.zip"
    try:
        client.retrieve(DATASET, {
            "variable": VARIABLES, "location": {"longitude": lon, "latitude": lat},
            "date": [f"{start}/{end}"], "data_format": "csv",
        }, str(target))
        return _read_zip(target.read_bytes())
    finally:
        target.unlink(missing_ok=True)


def update(lat: float, lon: float) -> pd.DataFrame:
    """Download what is missing up to the newest available day and cache it. Returns the full daily frame."""
    lat, lon = round(lat, 2), round(lon, 2)
    ERA5LAND_DIR.mkdir(parents=True, exist_ok=True)
    cached = read_cache(lat, lon)
    end = date.today() - timedelta(days=LATENCY_DAYS)
    start = date.fromisoformat(HISTORY_START) if cached is None else (cached.index[-1] + timedelta(days=1)).date()
    # One extra day on both sides so local-day shifting leaves complete days at the edges
    chunks, chunk_start = [], start - timedelta(days=1)
    while chunk_start <= end:
        chunk_end = min(date(chunk_start.year + CHUNK_YEARS, 1, 1), end + timedelta(days=1))
        log.info("ERA5-Land %s,%s: %s → %s", lat, lon, chunk_start, chunk_end)
        chunks.append(_download(lat, lon, chunk_start, chunk_end))
        chunk_start = chunk_end
    if not chunks:
        return cached
    hourly = pd.concat(chunks).sort_index()
    hourly = hourly[~hourly.index.duplicated()]
    daily = hourly_to_daily(hourly, lat, lon)
    daily = daily[daily.index.date >= start]
    full = daily if cached is None else pd.concat([cached, daily])
    full = full[~full.index.duplicated(keep="last")].sort_index()
    full.to_csv(_cache_file(lat, lon))
    return full
