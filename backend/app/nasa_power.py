"""NASA POWER daily agro-climatology (fallback source: no key, answers in seconds, global).

https://power.larc.nasa.gov – MERRA-2 meteorology with CERES solar radiation on a ~0.5° grid.
Solar radiation starts in 1984, so the history starts there. ET0 is computed with FAO-56
Penman-Monteith. POWER gives soil *wetness* (fraction of the pore space that holds water); it is
converted to volumetric water content with a typical porosity of 0.45.
"""
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import requests

from .data import CACHE_DIR, DAILY_VARS
from .et0 import penman_monteith, saturation_vapour_pressure

URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_DIR = CACHE_DIR / "nasa_power"
START = date(1984, 1, 1)
PARAMETERS = ["T2M", "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "RH2M", "WS2M", "WS10M_MAX",
              "PS", "GWETTOP", "GWETROOT"]
POROSITY = 0.45
LATENCY_DAYS = 7


def _cache_file(lat: float, lon: float):
    return POWER_DIR / f"{round(lat, 2)}_{round(lon, 2)}.csv"


def to_daily(payload: dict, lat: float) -> pd.DataFrame:
    """POWER JSON → daily columns as in DAILY_VARS."""
    p = pd.DataFrame(payload["properties"]["parameter"])
    p.index = pd.to_datetime(p.index, format="%Y%m%d")
    p = p.replace(-999.0, np.nan).astype(float)
    es = (saturation_vapour_pressure(p["T2M_MAX"]) + saturation_vapour_pressure(p["T2M_MIN"])) / 2
    daily = pd.DataFrame({
        "tmax": p["T2M_MAX"], "tmin": p["T2M_MIN"], "tmean": p["T2M"], "precip": p["PRECTOTCORR"],
        "radiation": p["ALLSKY_SFC_SW_DWN"], "wind_max": p["WS10M_MAX"] * 3.6, "humidity": p["RH2M"],
        "soil_moisture": p["GWETTOP"] * POROSITY, "soil_moisture_7_28": p["GWETROOT"] * POROSITY,
        "soil_moisture_28_100": p["GWETROOT"] * POROSITY,
    })
    daily["et0"] = penman_monteith(p["T2M_MAX"], p["T2M_MIN"], p["ALLSKY_SFC_SW_DWN"], p["WS2M"],
                                   p["RH2M"] / 100 * es, lat, p.index.dayofyear, pressure_kpa=p["PS"])
    daily.index.name = "date"
    return daily[DAILY_VARS].dropna(subset=["tmax", "tmin", "precip"])


def fetch(lat: float, lon: float) -> Optional[pd.DataFrame]:
    """Daily history from 1984; only days missing from the cache are downloaded."""
    lat, lon = round(lat, 2), round(lon, 2)
    POWER_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_file(lat, lon)
    cached = pd.read_csv(path, index_col="date", parse_dates=True) if path.exists() else None
    end = date.today() - timedelta(days=LATENCY_DAYS)
    start = START if cached is None else (cached.index[-1] + timedelta(days=1)).date()
    if start <= end:
        resp = requests.get(URL, params={
            "parameters": ",".join(PARAMETERS), "community": "AG", "latitude": lat, "longitude": lon,
            "start": f"{start:%Y%m%d}", "end": f"{end:%Y%m%d}", "format": "JSON",
        }, timeout=180)
        resp.raise_for_status()
        new = to_daily(resp.json(), lat)
        cached = new if cached is None else pd.concat([cached, new])
        cached = cached[~cached.index.duplicated(keep="last")].sort_index()
        cached.to_csv(path)
    return cached[DAILY_VARS] if cached is not None else None
