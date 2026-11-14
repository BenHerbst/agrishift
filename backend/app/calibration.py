"""Correct gridded reanalysis toward a local weather station (farm station, national met service).

Reanalysis smooths out valleys, slopes, lakes and city heat. If you upload daily station data for a
location, a correction is learned per calendar month from the days both sources cover and applied
to the whole reanalysis history before any model is trained:

* additive (station − reanalysis) for temperature, humidity, wind, soil moisture
* multiplicative (station ÷ reanalysis) for precipitation, ET0, radiation
"""
import io
from typing import Dict, Optional

import pandas as pd

from .data import CACHE_DIR

STATION_DIR = CACHE_DIR / "stations"
ADDITIVE = {"tmax", "tmin", "tmean", "humidity", "wind_max", "soil_moisture", "soil_moisture_7_28", "soil_moisture_28_100"}
MULTIPLICATIVE = {"precip", "et0", "radiation"}
CALIBRATABLE = ADDITIVE | MULTIPLICATIVE
MIN_OVERLAP_DAYS = 365
MIN_DAYS_PER_MONTH = 20
RATIO_LIMITS = (0.3, 3.0)


def _station_file(lat: float, lon: float):
    return STATION_DIR / f"{round(lat, 2)}_{round(lon, 2)}.csv"


def save_station_data(lat: float, lon: float, raw: bytes) -> pd.DataFrame:
    df = pd.read_csv(io.BytesIO(raw))
    if "date" not in df.columns:
        raise ValueError("CSV needs a 'date' column (YYYY-MM-DD).")
    usable = [c for c in df.columns if c in CALIBRATABLE]
    if not usable:
        raise ValueError(f"No usable columns. Provide any of: {sorted(CALIBRATABLE)}")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")[usable].apply(pd.to_numeric, errors="coerce").sort_index()
    STATION_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(_station_file(lat, lon))
    return df


def load_station_data(lat: float, lon: float) -> Optional[pd.DataFrame]:
    path = _station_file(lat, lon)
    return pd.read_csv(path, index_col="date", parse_dates=True) if path.exists() else None


def delete_station_data(lat: float, lon: float) -> bool:
    path = _station_file(lat, lon)
    if path.exists():
        path.unlink()
        return True
    return False


def compute_corrections(reanalysis: pd.DataFrame, station: pd.DataFrame) -> Dict[str, Dict]:
    corrections = {}
    for var in station.columns:
        pair = pd.concat([station[var].rename("st"), reanalysis[var].rename("re")], axis=1, join="inner").dropna()
        if len(pair) < MIN_OVERLAP_DAYS:
            continue
        multiplicative = var in MULTIPLICATIVE

        def factor(p: pd.DataFrame) -> float:
            if multiplicative:
                ratio = p["st"].sum() / p["re"].sum() if p["re"].sum() > 0 else 1.0
                return float(min(max(ratio, RATIO_LIMITS[0]), RATIO_LIMITS[1]))
            return float((p["st"] - p["re"]).mean())

        overall = factor(pair)
        by_month = {}
        for month in range(1, 13):
            p = pair[pair.index.month == month]
            by_month[month] = round(factor(p), 4) if len(p) >= MIN_DAYS_PER_MONTH else round(overall, 4)
        corrections[var] = {
            "method": "multiplicative" if multiplicative else "additive",
            "overlap_days": int(len(pair)),
            "by_month": by_month,
        }

    # Keep tmean consistent with corrected tmax/tmin if the station has no tmean
    if "tmean" not in corrections and {"tmax", "tmin"} <= set(corrections):
        corrections["tmean"] = {
            "method": "additive",
            "overlap_days": min(corrections["tmax"]["overlap_days"], corrections["tmin"]["overlap_days"]),
            "by_month": {m: round((corrections["tmax"]["by_month"][m] + corrections["tmin"]["by_month"][m]) / 2, 4)
                         for m in range(1, 13)},
            "derived_from": "tmax/tmin",
        }
    return corrections


def apply_corrections(daily: pd.DataFrame, corrections: Dict[str, Dict]) -> pd.DataFrame:
    daily = daily.copy()
    for var, c in corrections.items():
        f = daily.index.month.map(c["by_month"]).astype(float).values
        daily[var] = daily[var] * f if c["method"] == "multiplicative" else daily[var] + f
    return daily
