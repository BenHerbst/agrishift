"""Shared data definitions and NOAA climate indices, cached on disk under data_cache/.

* Climate drivers: NOAA monthly indices – ENSO (Niño 3.4), NAO, PDO.

The weather and projection sources (ERA5-Land and CMIP6 from Copernicus, NASA POWER) and their
fallback order live in sources.py. DAILY_VARS lists the daily columns every weather source delivers.
"""
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import requests

CACHE_DIR = Path(__file__).resolve().parent.parent / "data_cache"
HISTORY_START = "1980-01-01"

DAILY_VARS = [
    "tmax", "tmin", "tmean", "precip", "et0", "radiation", "wind_max", "humidity",
    "soil_moisture", "soil_moisture_7_28", "soil_moisture_28_100",
]

INDEX_MAX_AGE = timedelta(days=3)


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
