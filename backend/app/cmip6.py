"""CMIP6 climate projections straight from the Copernicus Climate Data Store (`projections-cmip6`).

Monthly model output, historical run 2000–2014 + SSP2-4.5 2015–2040, for three models with a spread
of climate sensitivity. The CDS only allows one model × experiment × variable per request, so data is
downloaded per 5° × 5° region (plus a 1° margin) and shared by every location inside it. ET0 is
computed per model with FAO-56 Penman-Monteith from the model's own temperature, radiation, wind and
humidity. Models without humidity use the minimum temperature as dew point (FAO-56 fallback).

The output has the same columns and units as the Open-Meteo projections (monthly sums / means), so
`projections.cmip_trends` works on either. Download with scripts/download_copernicus.py; the API only
reads the cache.
"""
import logging
import math
import os
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .data import CACHE_DIR
from .et0 import WIND_10M_TO_2M, penman_monteith, saturation_vapour_pressure

log = logging.getLogger(__name__)

DATASET = "projections-cmip6"
CMIP6_DIR = CACHE_DIR / "cmip6"
MODELS = os.environ.get("CDS_CMIP6_MODELS", "mri_esm2_0,cnrm_cm6_1_hr,ipsl_cm6a_lr").split(",")
SCENARIO = os.environ.get("CDS_CMIP6_SCENARIO", "ssp2_4_5")
PERIODS = {"historical": (2000, 2014), SCENARIO: (2015, 2040)}
TILE_DEG = 5
QUEUE_FULL = "Maximum number queued requests"
RETRIES = 5
# CDS variable -> (netCDF short name, our column)
VARIABLES = {
    "near_surface_air_temperature": ("tas", "tmean"),
    "daily_maximum_near_surface_air_temperature": ("tasmax", "tmax"),
    "daily_minimum_near_surface_air_temperature": ("tasmin", "tmin"),
    "precipitation": ("pr", "precip"),
    "surface_downwelling_shortwave_radiation": ("rsds", "radiation"),
    "near_surface_relative_humidity": ("hurs", "humidity"),
    "near_surface_wind_speed": ("sfcWind", "wind_max"),
    "moisture_in_upper_portion_of_soil_column": ("mrsos", "soil_moisture"),
}


def _tile(lat: float, lon: float) -> Tuple[int, int]:
    return math.floor(lat / TILE_DEG) * TILE_DEG, math.floor(lon / TILE_DEG) * TILE_DEG


def _path(model: str, experiment: str, variable: str, tile: Tuple[int, int]) -> Path:
    return CMIP6_DIR / f"{model}_{experiment}_{VARIABLES[variable][0]}_{tile[0]}_{tile[1]}.nc"


def _download_one(model: str, experiment: str, variable: str, tile: Tuple[int, int]) -> Optional[str]:
    """Download one file into the cache. Returns an error text, or None on success / already cached."""
    import cdsapi

    path = _path(model, experiment, variable, tile)
    if path.exists():
        return None
    first, last = PERIODS[experiment]
    lat0, lon0 = tile
    target = path.with_suffix(".zip")
    request = {
        "temporal_resolution": "monthly", "experiment": experiment, "variable": variable, "model": model,
        "year": [str(y) for y in range(first, last + 1)], "month": [f"{m:02d}" for m in range(1, 13)],
        "area": [lat0 + TILE_DEG + 1, lon0 - 1, lat0 - 1, lon0 + TILE_DEG + 1],
    }
    try:
        for attempt in range(RETRIES):
            try:
                cdsapi.Client(quiet=True, progress=False).retrieve(DATASET, request, str(target))
                break
            except Exception as exc:
                if QUEUE_FULL not in str(exc) or attempt == RETRIES - 1:
                    raise
                time.sleep(60 * (attempt + 1))  # the CDS limits queued requests per user and dataset
        with zipfile.ZipFile(target) as z:
            nc = next(n for n in z.namelist() if n.endswith(".nc"))
            path.write_bytes(z.read(nc))
        return None
    except Exception as exc:
        return f"{model} {experiment} {VARIABLES[variable][0]}: {str(exc).splitlines()[-1]}"
    finally:
        target.unlink(missing_ok=True)


def download(lat: float, lon: float) -> List[str]:
    """Fill the cache for the region around the point, one request at a time (the CDS rejects parallel
    requests for this dataset). Returns the errors (combinations the CDS doesn't have)."""
    CMIP6_DIR.mkdir(parents=True, exist_ok=True)
    tile = _tile(lat, lon)
    errors = [_download_one(m, e, v, tile) for m in MODELS for e in PERIODS for v in VARIABLES]
    return [e for e in errors if e]


def _point_series(path: Path, short: str, lat: float, lon: float) -> pd.Series:
    import xarray as xr

    with xr.open_dataset(path) as ds:
        grid_lon = lon % 360 if float(ds["lon"].max()) > 180 else lon
        da = ds[short].sel(lat=lat, lon=grid_lon, method="nearest").load()
    # .dt works for numpy datetimes and for the cftime calendars (365-day, 360-day) some models use
    index = pd.DatetimeIndex([pd.Timestamp(y, m, 1) for y, m in zip(da["time"].dt.year.values, da["time"].dt.month.values)])
    return pd.Series(da.values.astype(float), index=index)


def _model_monthly(model: str, lat: float, lon: float) -> Optional[pd.DataFrame]:
    tile = _tile(lat, lon)
    columns = {}
    for variable, (short, column) in VARIABLES.items():
        parts = [_point_series(_path(model, e, variable, tile), short, lat, lon)
                 for e in PERIODS if _path(model, e, variable, tile).exists()]
        if len(parts) == len(PERIODS):
            columns[column] = pd.concat(parts).sort_index()
    if not {"tmean", "tmax", "tmin", "precip"} <= set(columns):
        return None
    df = pd.DataFrame(columns)
    seconds = df.index.days_in_month.values * 86400.0
    for c in ("tmean", "tmax", "tmin"):
        df[c] = df[c] - 273.15
    df["precip"] = df["precip"] * seconds                  # kg/m²/s → mm per month
    if "radiation" in df:
        df["radiation"] = df["radiation"] * seconds / 1e6  # W/m² → MJ/m² per month
    if "wind_max" in df:
        df["wind_max"] = df["wind_max"] * 3.6              # mean wind m/s → km/h (only its trend is used)
    if "soil_moisture" in df:
        df["soil_moisture"] = df["soil_moisture"] / 100    # kg/m² in the top 10 cm → m³/m³
    if {"radiation", "wind_max"} <= set(df):
        ea = (saturation_vapour_pressure(df["tmax"]) + saturation_vapour_pressure(df["tmin"])) / 2 * df["humidity"] / 100 \
            if "humidity" in df else saturation_vapour_pressure(df["tmin"])
        mid_month = (df.index + pd.Timedelta(days=14)).dayofyear
        df["et0"] = penman_monteith(df["tmax"], df["tmin"], df["radiation"] / df.index.days_in_month,
                                    df["wind_max"] / 3.6 * WIND_10M_TO_2M, ea, lat, mid_month) * df.index.days_in_month
    return df


def read_projections(lat: float, lon: float) -> Tuple[Optional[pd.DataFrame], List[str]]:
    """Monthly multi-model mean from the cache, and the models used (empty if nothing is cached)."""
    frames, used = [], []
    for model in MODELS:
        df = _model_monthly(model, lat, lon)
        if df is not None:
            frames.append(df)
            used.append(model)
    if not frames:
        return None, []
    return pd.concat(frames).groupby(level=0).mean(), used
