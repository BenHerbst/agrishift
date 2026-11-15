"""Crop safety: pollution from the infrastructure around a field.

Two independent signals:

1. What is nearby – OpenStreetMap via the Overpass API: motorways, main roads, railways, industrial
   areas, fossil power plants, airports, landfills and quarries, and the distance from the field to
   the nearest one of each. Traffic and industry deposit heavy metals (lead, cadmium, zinc, copper),
   PAHs and dust on leaves and soil. The load falls off steeply with distance: most of it lands within
   50–100 m of a busy road and within ~1–2 km of heavy industry.
2. How clean the air is – CAMS global reanalysis (EAC4, Copernicus Atmosphere Data Store, free account,
   3-hourly, ~80 km) for the last full calendar year: ozone AOT40 for May–July (the EU indicator for
   crop damage), and annual NO₂, SO₂ and PM2.5, NO₂ and SO₂ against the EU critical levels for
   vegetation. The ADS queue is slow, so scripts/download_copernicus.py downloads it and the API only
   reads the cached summary; without it the verdict uses the distances alone.

Both become a verdict per crop group (safe / caution / avoid). This is a screening from distances and
modelled air, not a measurement: at a 'caution' or 'avoid' site a soil test for heavy metals decides.
"""
import json
import logging
import tempfile
import zipfile
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import requests

from .data import CACHE_DIR

log = logging.getLogger(__name__)

POLLUTION_DIR = CACHE_DIR / "pollution"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CAMS_DIR = CACHE_DIR / "cams"
ADS_URL = "https://ads.atmosphere.copernicus.eu/api"
CAMS_DATASET = "cams-global-reanalysis-eac4"
# ADS variable -> (netCDF short name, our column); gases are mass mixing ratios on the lowest model level
CAMS_GASES = {"ozone": ("go3", "ozone"), "nitrogen_dioxide": ("no2", "nitrogen_dioxide"),
              "sulphur_dioxide": ("so2", "sulphur_dioxide")}
CAMS_PM25 = ("particulate_matter_2.5um", "pm2p5")
SURFACE_MODEL_LEVEL = "60"
AIR_DENSITY = 1.204  # kg/m³ at 20 °C, 1 atm – the EU reference conditions for µg/m³
HEADERS = {"User-Agent": "terra-tuta-agri-backend/1.0"}  # Overpass answers 406 without one

# shortcut: distances are rule-of-thumb screening values from roadside/industry deposition studies,
# replace with measured soil data (e.g. LUCAS topsoil heavy metals) when that is integrated.
SOURCES = {
    # category: (OSM element types, tag, values, search radius m, high-exposure within m, moderate within m, emissions)
    "motorway": ("way", "highway", ("motorway", "trunk"), 1000, 50, 150,
                 "traffic: lead, zinc, cadmium, PAHs, tyre and brake dust"),
    "main_road": ("way", "highway", ("primary", "secondary"), 500, 25, 75, "traffic: heavy metals, PAHs, dust"),
    "railway": ("way", "railway", ("rail",), 500, 15, 50, "herbicides on the track bed, brake and overhead-line dust (copper)"),
    "industrial": ("nwr", "landuse", ("industrial",), 3000, 300, 1000, "industrial emissions: heavy metals, dust, SO₂"),
    "power_plant": ("nwr", "power", ("plant",), 3000, 500, 2000, "combustion: SO₂, NOx, dust, mercury"),
    "airport": ("nwr", "aeroway", ("aerodrome",), 3000, 500, 1500, "kerosene exhaust, de-icing fluids, PFAS from fire-fighting foam"),
    "landfill": ("nwr", "landuse", ("landfill",), 2000, 200, 500, "leachate, blown dust and plastics"),
    "quarry": ("nwr", "landuse", ("quarry",), 2000, 200, 500, "mineral dust"),
}
CLEAN_POWER = {"solar", "wind", "hydro"}

CROP_GROUPS = {
    # group: (examples, sensitive to deposition: eaten leaves catch dust, roots take up metals from soil)
    "leafy_vegetables": ("lettuce, spinach, kale, herbs", True),
    "root_vegetables": ("carrots, potatoes, beets, radish", True),
    "fodder": ("grass, clover, silage maize, hay – passes into milk and meat", True),
    "fruit_vegetables": ("tomatoes, beans, peas, cucumbers", False),
    "grain_crops": ("wheat, barley, maize grain, oilseeds, pulses", False),
    "orchard_fruit": ("apples, berries, grapes", False),
}
OZONE_SENSITIVE = {"leafy_vegetables", "fruit_vegetables", "grain_crops"}  # wheat, soy, beans, lettuce, tomato
AOT40_TARGET = 18000      # µg/m³·h, May–July, EU target value for the protection of vegetation
AOT40_LONG_TERM = 6000    # µg/m³·h, EU long-term objective
SO2_CRITICAL = 20         # µg/m³ annual mean, EU critical level for vegetation
NO2_CRITICAL = 30         # µg/m³ annual mean – EU critical level is for NOx, NO₂ used as a proxy
VERDICTS = ("safe", "caution", "avoid")


# ------------------------------------------------------------------ OpenStreetMap

def _category(tags: Dict) -> Optional[str]:
    for name, (_, key, values, *_rest) in SOURCES.items():
        if tags.get(key) in values and not (name == "power_plant" and tags.get("plant:source") in CLEAN_POWER):
            return name
    return None


def _lines(element: Dict) -> List[np.ndarray]:
    """(lat, lon) polylines of a node, way or relation from Overpass `out geom`."""
    if element["type"] == "node":
        return [np.array([[element["lat"], element["lon"]]])]
    parts = [element.get("geometry")] + [m.get("geometry") for m in element.get("members", [])]
    return [np.array([[g["lat"], g["lon"]] for g in part if g]) for part in parts if part]


def distance_m(lat: float, lon: float, line: np.ndarray) -> float:
    """Shortest distance from the point to a polyline, in a local flat projection (fine below ~10 km)."""
    xy = np.column_stack([(line[:, 1] - lon) * 111320 * np.cos(np.radians(lat)), (line[:, 0] - lat) * 110540])
    if len(xy) == 1:
        return float(np.hypot(*xy[0]))
    a, ab = xy[:-1], xy[1:] - xy[:-1]
    length2 = (ab ** 2).sum(axis=1)
    t = np.clip(np.where(length2 > 0, -(a * ab).sum(axis=1) / np.where(length2 > 0, length2, 1), 0), 0, 1)
    return float(np.hypot(*(a + t[:, None] * ab).T).min())


def inside(lat: float, lon: float, line: np.ndarray) -> bool:
    """Point in a closed ring (first point == last), by ray casting."""
    if len(line) < 4 or not np.array_equal(line[0], line[-1]):
        return False
    y, x = line[:, 0], line[:, 1]
    spans = (y[:-1] > lat) != (y[1:] > lat)
    dy = np.where(y[1:] != y[:-1], y[1:] - y[:-1], 1)
    return bool((spans & (lon < x[:-1] + (x[1:] - x[:-1]) * (lat - y[:-1]) / dy)).sum() % 2)


def nearest_sources(elements: List[Dict], lat: float, lon: float) -> Dict[str, Dict]:
    """Nearest element per category; a field inside an area (industrial zone, airport …) is 0 m away.

    shortcut: multipolygon outlines split over several ways are not closed rings, so a point inside
    one of those still gets the distance to its edge – join the member ways if that case matters.
    """
    nearest = {}
    for element in elements:
        tags = element.get("tags", {})
        category = _category(tags)
        lines = _lines(element)
        if category is None or not lines:
            continue
        d = 0.0 if any(inside(lat, lon, line) for line in lines) else min(distance_m(lat, lon, line) for line in lines)
        if category not in nearest or d < nearest[category]["distance_m"]:
            nearest[category] = {"distance_m": round(d), "name": tags.get("name") or tags.get("ref"),
                                 "osm_id": f"{element['type']}/{element['id']}"}
    return dict(sorted(nearest.items(), key=lambda kv: kv[1]["distance_m"]))


def fetch_infrastructure(lat: float, lon: float) -> Dict[str, Dict]:
    """Nearest pollution source per category (cached per ~10 m location)."""
    lat, lon = round(lat, 4), round(lon, 4)
    POLLUTION_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = POLLUTION_DIR / f"osm_{lat}_{lon}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())
    parts = "".join(f'{types}["{key}"~"^({"|".join(values)})$"](around:{radius},{lat},{lon});'
                    for types, key, values, radius, *_ in SOURCES.values())
    resp = requests.post(OVERPASS_URL, data={"data": f"[out:json][timeout:60];({parts});out tags geom;"},
                         headers=HEADERS, timeout=90)
    resp.raise_for_status()
    nearest = nearest_sources(resp.json()["elements"], lat, lon)
    cache_file.write_text(json.dumps(nearest, indent=1))
    return nearest


# ------------------------------------------------------------------ air quality (CAMS reanalysis)

def air_summary(hourly: pd.DataFrame, lon: float, year: int) -> Dict:
    """AOT40 (May–July, 08–20 h local) and annual means from values in µg/m³ with a UTC index (any time step)."""
    local = hourly.index + pd.Timedelta(hours=round(lon / 15))  # solar time is close enough for 08–20 h
    ozone = hourly["ozone"][local.month.isin([5, 6, 7]) & (local.hour >= 8) & (local.hour < 20)]
    valid = ozone.notna().sum()
    # 3-hourly values and missing hours are scaled up to all 92 days × 12 h (the EU rule for missing data)
    aot40 = float((ozone - 80).clip(lower=0).sum() * 92 * 12 / valid) if valid else None
    monthly = hourly.groupby(hourly.index.month).mean()  # every month counts once, whatever its coverage

    def mean(col):
        return round(float(monthly[col].mean()), 1) if monthly[col].notna().any() else None

    return {
        "year": year,
        "source": "CAMS global reanalysis EAC4 (Copernicus Atmosphere Monitoring Service), 3-hourly, ~80 km",
        "ozone_aot40_may_jul_ug_m3_h": None if aot40 is None else round(aot40),
        "no2_mean_ug_m3": mean("nitrogen_dioxide"),
        "so2_mean_ug_m3": mean("sulphur_dioxide"),
        "pm25_mean_ug_m3": mean("pm25"),
    }


def _cams_file(lat: float, lon: float, year: int):
    return CAMS_DIR / f"{round(lat, 2)}_{round(lon, 2)}_{year}.json"


def read_air_quality(lat: float, lon: float) -> Optional[Dict]:
    """Newest cached CAMS summary for the location, or None if not downloaded yet."""
    files = sorted(CAMS_DIR.glob(f"{round(lat, 2)}_{round(lon, 2)}_*.json")) if CAMS_DIR.exists() else []
    return json.loads(files[-1].read_text()) if files else None


def _cams_frame(path, lat: float, lon: float) -> pd.DataFrame:
    """Nearest grid point of an EAC4 netCDF → µg/m³ per time step (UTC)."""
    import xarray as xr

    with xr.open_dataset(path) as ds:
        point = ds.sel(latitude=lat, longitude=lon, method="nearest").squeeze(drop=True)
        time = "valid_time" if "valid_time" in point.coords else "time"
        out = pd.DataFrame({col: point[short].values * AIR_DENSITY * 1e9 for short, col in CAMS_GASES.values()
                            if short in point}, index=pd.DatetimeIndex(point[time].values))
        if CAMS_PM25[1] in point:
            out["pm25"] = point[CAMS_PM25[1]].values * 1e9  # kg/m³ → µg/m³
    return out


def download_air_quality(lat: float, lon: float, year: Optional[int] = None) -> Dict:
    """Download one year of CAMS reanalysis around the point from the ADS and cache its summary.

    Uses the key from ~/.cdsapirc (the same ECMWF account works for the ADS; its terms of use must be
    accepted once at https://ads.atmosphere.copernicus.eu). EAC4 lags real time by several months, so
    the year before is tried when the last full year isn't complete yet.
    """
    import cdsapi

    CAMS_DIR.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client(url=ADS_URL, quiet=True, progress=False)  # key from ~/.cdsapirc or CDSAPI_KEY
    years = [year] if year else [date.today().year - 1, date.today().year - 2]
    errors = []
    for y in years:
        with tempfile.TemporaryDirectory(dir=CAMS_DIR) as tmp:
            target = Path(tmp) / "download.nc"
            try:
                client.retrieve(CAMS_DATASET, {
                    "variable": [*CAMS_GASES, CAMS_PM25[0]], "model_level": [SURFACE_MODEL_LEVEL],
                    "date": [f"{y}-01-01/{y}-12-31"], "time": [f"{h:02d}:00" for h in range(0, 24, 3)],
                    "area": [lat + 1, lon - 1, lat - 1, lon + 1], "data_format": "netcdf",
                }, str(target))
                paths = [target]
                if zipfile.is_zipfile(target):  # gases (model level) and PM2.5 (surface) come as two netCDFs
                    with zipfile.ZipFile(target) as archive:
                        archive.extractall(tmp)
                    paths = sorted(Path(tmp).glob("*.nc"))
                    paths.remove(target)
                frame = pd.concat([_cams_frame(path, lat, lon) for path in paths], axis=1)
                summary = air_summary(frame, lon, y)
                _cams_file(lat, lon, y).write_text(json.dumps(summary, indent=1))
                return summary
            except Exception as exc:
                log.info("CAMS %s for %s,%s failed: %s", y, lat, lon, exc)
                errors.append(f"{y}: {exc}")
    raise RuntimeError("CAMS download failed – " + "; ".join(errors))


# ------------------------------------------------------------------ verdict

def crop_safety(nearest: Dict[str, Dict], air: Optional[Dict]) -> Dict:
    exposures = []  # (level 1 = moderate / 2 = high, reason)
    for category, source in nearest.items():
        *_, high, moderate, emits = SOURCES[category]
        d = source["distance_m"]
        level = 2 if d <= high else 1 if d <= moderate else 0
        if level:
            name = f" ({source['name']})" if source.get("name") else ""
            exposures.append((level, f"{category.replace('_', ' ')}{name} {d} m away – {emits}"))

    air_reasons, ozone_reason = [], None
    if air:
        aot40 = air.get("ozone_aot40_may_jul_ug_m3_h")
        if aot40 is not None and aot40 > AOT40_TARGET:
            ozone_reason = f"High ozone (AOT40 {aot40:,} µg/m³·h > EU target {AOT40_TARGET:,}): yield loss in sensitive crops"
        if (air.get("so2_mean_ug_m3") or 0) > SO2_CRITICAL:
            air_reasons.append(f"SO₂ {air['so2_mean_ug_m3']} µg/m³ above the EU critical level for vegetation ({SO2_CRITICAL})")
        if (air.get("no2_mean_ug_m3") or 0) > NO2_CRITICAL:
            air_reasons.append(f"NO₂ {air['no2_mean_ug_m3']} µg/m³ above the EU critical level for vegetation ({NO2_CRITICAL})")

    groups = {}
    for group, (examples, sensitive) in CROP_GROUPS.items():
        level, reasons = 0, []
        for exposure, reason in exposures:
            effect = exposure if sensitive else exposure - 1
            if effect > 0:
                level, reasons = max(level, effect), reasons + [reason]
        for reason in air_reasons + ([ozone_reason] if ozone_reason and group in OZONE_SENSITIVE else []):
            level, reasons = max(level, 1), reasons + [reason]
        groups[group] = {"examples": examples, "verdict": VERDICTS[level],
                         "reasons": reasons or ["No pollution source close enough to matter"]}

    recommendations = []
    if any(g["verdict"] != "safe" for g in groups.values()):
        recommendations.append("Test the soil for lead, cadmium, zinc and copper (near roads also PAHs) before growing food crops.")
    if any(c in nearest and nearest[c]["distance_m"] <= SOURCES[c][5] for c in ("motorway", "main_road", "railway")):
        recommendations.append("A hedge or a 10–20 m strip of non-food plants toward the road or railway catches much of the dust.")
    if groups["leafy_vegetables"]["verdict"] != "safe":
        recommendations.append("Wash leafy produce thoroughly and peel root vegetables; grow them on the far side of the field.")
    if ozone_reason:
        recommendations.append("Prefer ozone-tolerant crops (barley, oats, maize) over wheat, soy and beans.")
    elif air and (air.get("ozone_aot40_may_jul_ug_m3_h") or 0) > AOT40_LONG_TERM:
        recommendations.append("Ozone is above the EU long-term objective: small yield losses in wheat, soy and beans are likely.")
    return {"crop_groups": groups, "recommendations": recommendations}
