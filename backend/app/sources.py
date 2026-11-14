"""Which data source is used: primary sources with automatic fallback.

Weather history (order set by WEATHER_SOURCES, default "era5land,nasa_power,open_meteo"):
  1. era5land   – ERA5-Land from Copernicus, ~9 km, from 1980. Cache only: the CDS queue can be slow,
                  so it is downloaded / updated by scripts/download_copernicus.py, never in a request.
  2. nasa_power – NASA POWER, ~50 km, from 1984. Downloaded on demand in seconds, no key.
  3. open_meteo – Open-Meteo (ERA5 based), from 1980. Last resort (free-tier rate limits).

Climate projections (PROJECTION_SOURCES, default "cds_cmip6,open_meteo"):
  1. cds_cmip6  – CMIP6 (3 models, SSP2-4.5) from Copernicus, cache only, see app/cmip6.py
  2. open_meteo – Open-Meteo Climate API (CMIP6 HighResMIP)

The source that was used is reported in every response and is part of the forecast-cache
fingerprint, so when ERA5-Land arrives for a location its forecasts are retrained automatically.
"""
import logging
import os
from typing import List, Optional, Tuple

import pandas as pd

from . import cmip6, era5land, nasa_power
from .data import fetch_open_meteo_daily, fetch_open_meteo_projections

log = logging.getLogger(__name__)

WEATHER_SOURCES = os.environ.get("WEATHER_SOURCES", "era5land,nasa_power,open_meteo").split(",")
PROJECTION_SOURCES = os.environ.get("PROJECTION_SOURCES", "cds_cmip6,open_meteo").split(",")
SOURCE_LABELS = {
    "era5land": "ERA5-Land (Copernicus CDS), ~9 km",
    "nasa_power": "NASA POWER (MERRA-2 / CERES), ~50 km",
    "open_meteo": "Open-Meteo Historical API (ERA5 / ERA5-Land)",
}
MIN_YEARS = 25  # less history than this isn't enough for the 30-year normals and the backtest


def _weather(name: str, lat: float, lon: float) -> Optional[pd.DataFrame]:
    if name == "era5land":
        return era5land.read_cache(lat, lon)
    if name == "nasa_power":
        return nasa_power.fetch(lat, lon)
    if name == "open_meteo":
        return fetch_open_meteo_daily(lat, lon)
    raise ValueError(f"Unknown weather source {name!r}")


def fetch_daily(lat: float, lon: float) -> pd.DataFrame:
    """Daily history from the first source that has enough data. `df.attrs` names the source."""
    errors = []
    for name in WEATHER_SOURCES:
        try:
            df = _weather(name, lat, lon)
        except Exception as exc:  # network, rate limit, sea point without land data …
            errors.append(f"{name}: {exc}")
            continue
        if df is None:
            errors.append(f"{name}: not downloaded")
            continue
        years = (df.index[-1] - df.index[0]).days / 365.25
        if years < MIN_YEARS:
            errors.append(f"{name}: only {years:.0f} years")
            continue
        df.attrs = {"source": name, "label": SOURCE_LABELS[name], "skipped": errors}
        return df
    raise RuntimeError("No weather source available – " + "; ".join(errors))


def fetch_projections(lat: float, lon: float) -> Tuple[Optional[pd.DataFrame], List[str], List[str]]:
    """Monthly multi-model projections: (frame or None, models used as 'source:model', problems).

    Problems only refer to the source actually used (e.g. one Open-Meteo model hit a rate limit) –
    a primary source that simply isn't downloaded yet is a normal fallback, not a problem.
    """
    errors: List[str] = []
    for name in PROJECTION_SOURCES:
        if name == "cds_cmip6":
            frame, models = cmip6.read_projections(lat, lon)
            if frame is not None:
                return frame, [f"cds_cmip6:{m}" for m in models], []
        elif name == "open_meteo":
            frame, models, errors = fetch_open_meteo_projections(lat, lon)
            if frame is not None:
                return frame, [f"open_meteo:{m}" for m in models], errors
        else:
            raise ValueError(f"Unknown projection source {name!r}")
    return None, [], errors or ["no projection source available"]
