"""Which data source is used: primary sources with automatic fallback.

Weather history (order set by WEATHER_SOURCES, default "era5land,nasa_power"):
  1. era5land   – ERA5-Land from Copernicus, ~9 km, from 1980. Cache only: the CDS queue can be slow,
                  so it is downloaded / updated by scripts/download_copernicus.py, never in a request.
  2. nasa_power – NASA POWER, ~50 km, from 1984. Downloaded on demand in seconds, no key.

Climate projections (PROJECTION_SOURCES, default "cds_cmip6"):
  1. cds_cmip6  – CMIP6 (3 models, SSP2-4.5) from Copernicus, cache only, see app/cmip6.py.
                  Not downloaded yet → the forecast runs without the climate-model member.

The source that was used is reported in every response and is part of the forecast-cache
fingerprint, so when ERA5-Land arrives for a location its forecasts are retrained automatically.
"""
import logging
import os
from typing import List, Optional, Tuple

import pandas as pd

from . import cmip6, era5land, nasa_power

log = logging.getLogger(__name__)

WEATHER_SOURCES = os.environ.get("WEATHER_SOURCES", "era5land,nasa_power").split(",")
PROJECTION_SOURCES = os.environ.get("PROJECTION_SOURCES", "cds_cmip6").split(",")
SOURCE_LABELS = {
    "era5land": "ERA5-Land (Copernicus CDS), ~9 km",
    "nasa_power": "NASA POWER (MERRA-2 / CERES), ~50 km",
}
MIN_YEARS = 25  # less history than this isn't enough for the 30-year normals and the backtest


def _weather(name: str, lat: float, lon: float) -> Optional[pd.DataFrame]:
    if name == "era5land":
        return era5land.read_cache(lat, lon)
    if name == "nasa_power":
        return nasa_power.fetch(lat, lon)
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

    Projections that simply aren't downloaded yet are a normal state, not a problem: the forecast is
    cached without them and retrained once they arrive (the models used are in its fingerprint).
    """
    for name in PROJECTION_SOURCES:
        if name == "cds_cmip6":
            frame, models = cmip6.read_projections(lat, lon)
            if frame is not None:
                return frame, [f"cds_cmip6:{m}" for m in models], []
        else:
            raise ValueError(f"Unknown projection source {name!r}")
    return None, [], []
