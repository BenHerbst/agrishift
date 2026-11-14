"""ECMWF SEAS5 seasonal forecasts (monthly means, lead months 1–6) from the Copernicus Climate Data Store.

Unlike the other members, SEAS5 is a physical ocean–atmosphere model started from the observed state
of the ocean each month, so it can see a developing El Niño, warm sea surfaces or dry soils.

Needs a free CDS account: https://cds.climate.copernicus.eu → profile → API key, then either
  ~/.cdsapirc  containing   url: https://cds.climate.copernicus.eu/api
                            key: <your-key>
or the environment variables CDSAPI_URL / CDSAPI_KEY. You also have to accept the dataset licence once
on the dataset page ("seasonal-monthly-single-levels" → Download → Terms of use).

The archive is downloaded once per location (1993 → now, a few requests, can take a while in the CDS
queue) and cached in data_cache/seas5/. Without credentials everything else keeps working.
"""
import logging
import os
import tempfile
import zipfile
from datetime import date
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd

from .data import CACHE_DIR

log = logging.getLogger(__name__)

DATASET = "seasonal-monthly-single-levels"
SEAS5_DIR = CACHE_DIR / "seas5"
FIRST_YEAR = 1993
CLIMATOLOGY_YEARS = (1993, 2016)  # SEAS5 hindcast period, used for bias correction
LEAD_MONTHS = 6
CDS_VARIABLES = [
    "2m_temperature",
    "maximum_2m_temperature_in_the_last_24_hours",
    "minimum_2m_temperature_in_the_last_24_hours",
    "total_precipitation",
    "surface_solar_radiation_downwards",
]
SEASONAL_VARIABLES = ["tmean", "tmax", "tmin", "precip", "radiation"]
# SEAS5 (system 5) ran until Oct 2022, SEAS5.1 (system 51) since Nov 2022.
SYSTEM_51_FROM = pd.Timestamp("2022-11-01")


def cds_configured() -> bool:
    return bool(os.environ.get("CDSAPI_KEY")) or (Path.home() / ".cdsapirc").exists()


def _chunks(until: pd.Timestamp) -> List[Tuple[List[int], List[int], List[str]]]:
    """(years, months, systems to try) per request, split where the system changes."""
    all_months = list(range(1, 13))
    chunks = [
        (list(range(FIRST_YEAR, CLIMATOLOGY_YEARS[1] + 1)), all_months, ["51", "5"]),  # hindcasts
        (list(range(2017, 2022)), all_months, ["5"]),
        ([2022], list(range(1, 11)), ["5"]),
        ([2022], [11, 12], ["51"]),
    ]
    if until.year > 2023:
        chunks.append((list(range(2023, until.year)), all_months, ["51"]))
    if until.year >= 2023:
        chunks.append(([until.year], list(range(1, until.month + 1)), ["51"]))
    return chunks


def _var_name(name: str) -> Optional[str]:
    n = name.lower()
    if "mx2t" in n:
        return "tmax"
    if "mn2t" in n:
        return "tmin"
    if "t2m" in n:
        return "tmean"
    if "tprate" in n or n in ("tp", "avg_tprate"):
        return "precip"
    if "dsrf" in n or "swrf" in n or "ssrd" in n:  # msdsrf (CDS netCDF) / msdwswrf / avg_sdswrf / ssrd
        return "radiation"
    return None


def _to_monthly_units(var: str, values: np.ndarray, units: str, target: pd.DatetimeIndex) -> np.ndarray:
    seconds = target.days_in_month.values * 86400.0
    units = (units or "").replace("**", "^")
    if var in ("tmean", "tmax", "tmin"):
        return values - 273.15 if units.startswith("K") or np.nanmean(values) > 150 else values
    if var == "precip":  # mean rate m/s → mm per month
        return values * seconds * 1000.0
    if var == "radiation":  # mean flux W/m² → MJ/m² per month
        return values * seconds / 1e6 if "W" in units or not units else values * target.days_in_month.values / 1e6
    return values


def _parse(path: Path, lat: float, lon: float) -> pd.DataFrame:
    import xarray as xr

    paths = [path]
    if zipfile.is_zipfile(path):
        out_dir = Path(tempfile.mkdtemp(dir=SEAS5_DIR))
        with zipfile.ZipFile(path) as z:
            z.extractall(out_dir)
        paths = sorted(out_dir.glob("*.nc"))

    frames = []
    for p in paths:
        ds = xr.open_dataset(p)
        lat_name = "latitude" if "latitude" in ds.coords else "lat"
        lon_name = "longitude" if "longitude" in ds.coords else "lon"
        ds = ds.sel({lat_name: lat, lon_name: lon}, method="nearest")
        start_name = next(c for c in ("forecast_reference_time", "time", "indexing_time") if c in ds.coords)
        lead_name = next(c for c in ("forecastMonth", "forecast_month", "leadtime_month") if c in ds.coords or c in ds.dims)
        for name, da in ds.data_vars.items():
            var = _var_name(name)
            if var is None:
                continue
            if "number" in da.dims:  # individual members → ensemble mean
                da = da.mean("number")
            df = da.to_dataframe(name="value").reset_index()[[start_name, lead_name, "value"]]
            df.columns = ["start", "lead", "value"]
            df["start"] = pd.to_datetime(df["start"]).dt.to_period("M").dt.to_timestamp()
            df["lead"] = df["lead"].astype(int)
            target = pd.DatetimeIndex([s + pd.DateOffset(months=l - 1) for s, l in zip(df["start"], df["lead"])])
            df["value"] = _to_monthly_units(var, df["value"].values, da.attrs.get("units", ""), target)
            df["variable"] = var
            frames.append(df)
    if not frames:
        raise RuntimeError(f"No known variables in {path.name}")
    out = pd.concat(frames).pivot_table(index=["start", "lead"], columns="variable", values="value")
    return out.reset_index()


def _download(years: List[int], months: List[int], systems: List[str], lat: float, lon: float, target: Path):
    import cdsapi

    client = cdsapi.Client(quiet=True, progress=False)
    last_error = None
    for system in systems:
        for product in ("ensemble_mean", "monthly_mean"):
            try:
                client.retrieve(DATASET, {
                    "originating_centre": "ecmwf",
                    "system": system,
                    "variable": CDS_VARIABLES,
                    "product_type": [product],
                    "year": [str(y) for y in years],
                    "month": [f"{m:02d}" for m in months],
                    "leadtime_month": [str(l) for l in range(1, LEAD_MONTHS + 1)],
                    "data_format": "netcdf",
                    "area": [lat + 1, lon - 1, lat - 1, lon + 1],
                }, str(target))
                return
            except Exception as exc:
                last_error = exc
                log.warning("SEAS5 request system=%s product=%s %s failed: %s", system, product, years, exc)
    raise RuntimeError(f"SEAS5 download failed for {years}: {last_error}")


def _latest_issued_start() -> pd.Timestamp:
    # SEAS5 is published on the 5th of each month for the forecast starting on the 1st
    today = date.today()
    month = pd.Timestamp(today.year, today.month, 1)
    return month if today.day >= 6 else month - pd.DateOffset(months=1)


def fetch_seasonal(lat: float, lon: float, download: bool = True) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
    """SEAS5 ensemble-mean monthly forecasts as a frame indexed by (start, lead). Returns (frame, error).

    With download=False only cached data is used – the CDS queue can take hours, so the API never waits
    on it. Download with:  python scripts/download_seas5.py --lat 50.78 --lon 6.08
    """
    if not cds_configured():
        return None, "no Copernicus CDS credentials (see app/seasonal.py)"
    lat, lon = round(lat, 2), round(lon, 2)
    SEAS5_DIR.mkdir(parents=True, exist_ok=True)
    until = _latest_issued_start()
    frames, errors = [], []
    for years, months, systems in _chunks(until):
        key = f"{lat}_{lon}_{years[0]}-{years[-1]}_{months[0]:02d}-{months[-1]:02d}"
        cache_csv = SEAS5_DIR / f"{key}.csv"
        if cache_csv.exists():
            frames.append(pd.read_csv(cache_csv, parse_dates=["start"]))
            continue
        if not download:
            errors.append(f"SEAS5 {years[0]}–{years[-1]} not downloaded yet "
                          f"(run: python scripts/download_seas5.py --lat {lat} --lon {lon})")
            continue
        raw = SEAS5_DIR / f"{key}.download"
        try:
            _download(years, months, systems, lat, lon, raw)
            df = _parse(raw, lat, lon)
            df.to_csv(cache_csv, index=False)
            frames.append(df)
        except Exception as exc:
            errors.append(str(exc))
        finally:
            raw.unlink(missing_ok=True)
    if not frames:
        return None, "; ".join(errors) or "no SEAS5 data"
    df = pd.concat(frames).drop_duplicates(["start", "lead"]).set_index(["start", "lead"]).sort_index()
    return df, ("; ".join(errors) or None)


def seasonal_anomalies(seasonal: pd.DataFrame, start: pd.Timestamp) -> Optional[pd.DataFrame]:
    """Bias-corrected signal for one forecast start: lead × variable.

    Temperatures: forecast − SEAS5 climatology (°C). Precipitation / radiation: forecast ÷ climatology.
    The climatology is SEAS5's own 1993–2016 mean for the same start month and lead.
    """
    if start not in seasonal.index.get_level_values("start"):
        return None
    fc = seasonal.loc[start]
    starts = seasonal.index.get_level_values("start")
    hindcast = seasonal[(starts.month == start.month) & (starts.year >= CLIMATOLOGY_YEARS[0])
                        & (starts.year <= CLIMATOLOGY_YEARS[1])]
    if hindcast.empty:
        return None
    clim = hindcast.groupby(level="lead").mean()
    out = pd.DataFrame(index=fc.index)
    for var in fc.columns:
        if var in ("precip", "radiation"):
            out[var] = (fc[var] / clim[var].replace(0, np.nan)).clip(0.5, 2.0).fillna(1.0)
        else:
            out[var] = fc[var] - clim[var]
    for var in ("tmax", "tmin"):  # fall back to the mean-temperature signal if a field is missing
        if var not in out and "tmean" in out:
            out[var] = out["tmean"]
    return out

