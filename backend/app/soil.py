"""Soil at the field and a daily soil water balance.

Soil properties come from ISRIC SoilGrids 2.0 (global, 250 m, 0–200 cm) through its WCS map
service (the SoilGrids REST point API currently returns no data). For each property and depth
layer the median of the valid pixels around the point is used; towns and roads have no data, so
the search widens from ~1 km to ~6 km until enough soil pixels are found. Results are cached
per location forever in data_cache/soil/.

From the profile:
  * texture class (USDA), topsoil organic matter, pH, CEC, bulk density, gravel
  * total available water (TAW, mm) in the root zone = Σ (field capacity − wilting point)
    × (1 − gravel) × layer thickness. SoilGrids' own water-retention layers are used; where they
    are missing, Saxton & Rawls (2006) pedotransfer functions estimate them from texture and OM.

`water_balance` is the FAO-56 single-bucket model: the root zone is a bucket of size TAW that
rain fills and crop evapotranspiration (Kc × ET0) empties. Plants are stressed once the depletion
passes RAW = p × TAW, and actual ET then drops linearly to zero at TAW. The irrigated run refills
the bucket whenever the depletion reaches RAW – its total is the irrigation need.
"""
import io
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

import numpy as np
import pandas as pd
import requests

from .data import CACHE_DIR

log = logging.getLogger(__name__)

SOIL_DIR = CACHE_DIR / "soil"
WCS_URL = "https://maps.isric.org/mapserv"
DEPTHS = [("0-5cm", 0, 5), ("5-15cm", 5, 15), ("15-30cm", 15, 30), ("30-60cm", 30, 60), ("60-100cm", 60, 100)]
# SoilGrids property -> (divide raw integer by, unit after conversion)
PROPERTIES = {
    "clay": (10, "%"), "sand": (10, "%"), "silt": (10, "%"),
    "soc": (10, "g/kg"),        # soil organic carbon
    "phh2o": (10, "pH"),
    "bdod": (100, "g/cm³"),     # bulk density
    "cec": (10, "cmol(c)/kg"),  # cation exchange capacity
    "cfvo": (10, "vol %"),      # coarse fragments (gravel)
    "nitrogen": (100, "g/kg"),
    "wv0033": (10, "vol %"),    # water content at field capacity (−33 kPa)
    "wv1500": (10, "vol %"),    # water content at wilting point (−1500 kPa)
}
SEARCH_RADII_DEG = (0.01, 0.03, 0.06)
MIN_PIXELS = 5
DEFAULT_ROOT_DEPTH_CM = 100
DEFAULT_DEPLETION_FRACTION = 0.5  # FAO-56 p for most field crops


# ------------------------------------------------------------------ SoilGrids download

def _coverage(prop: str, depth: str, lat: float, lon: float, radius: float) -> np.ndarray:
    """Valid raw pixel values of one SoilGrids layer in a box around the point."""
    import tifffile

    resp = requests.get(WCS_URL, params=[
        ("map", f"/map/{prop}.map"), ("SERVICE", "WCS"), ("VERSION", "2.0.1"), ("REQUEST", "GetCoverage"),
        ("COVERAGEID", f"{prop}_{depth}_mean"), ("FORMAT", "image/tiff"),
        ("SUBSET", f"long({lon - radius},{lon + radius})"), ("SUBSET", f"lat({lat - radius},{lat + radius})"),
        ("SUBSETTINGCRS", "http://www.opengis.net/def/crs/EPSG/0/4326"),
        ("OUTPUTCRS", "http://www.opengis.net/def/crs/EPSG/0/4326"),
    ], timeout=90)
    resp.raise_for_status()
    if not resp.headers.get("content-type", "").startswith("image/tiff"):
        raise RuntimeError(f"SoilGrids returned no raster for {prop} {depth}: {resp.text[:200]}")
    values = tifffile.imread(io.BytesIO(resp.content)).astype(float).ravel()
    return values[values > 0]  # 0 / negative = no data (water, built-up areas)


def fetch_soil(lat: float, lon: float) -> Dict:
    """SoilGrids profile around the point (cached). Raises if no soil data is found within ~6 km."""
    lat, lon = round(lat, 2), round(lon, 2)
    SOIL_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = SOIL_DIR / f"{lat}_{lon}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    radius = next((r for r in SEARCH_RADII_DEG if len(_coverage("clay", "0-5cm", lat, lon, r)) >= MIN_PIXELS), None)
    if radius is None:
        raise RuntimeError("No SoilGrids soil data within ~6 km (water, glacier or built-up area?)")

    jobs = [(prop, depth) for prop in PROPERTIES for depth, _, _ in DEPTHS]
    with ThreadPoolExecutor(max_workers=4) as pool:  # be polite to the ISRIC server
        raw = dict(zip(jobs, pool.map(lambda job: _coverage(job[0], job[1], lat, lon, radius), jobs)))

    layers = {}
    for depth, top, bottom in DEPTHS:
        layer = {"top_cm": top, "bottom_cm": bottom}
        for prop, (divisor, _) in PROPERTIES.items():
            values = raw[(prop, depth)]
            layer[prop] = round(float(np.median(values)) / divisor, 3) if len(values) >= MIN_PIXELS else None
        layers[depth] = layer
    soil = {
        "source": "ISRIC SoilGrids 2.0 (250 m), median of the soil pixels around the point",
        "search_radius_km": round(radius * 111, 1),
        "pixels": int(len(raw[("clay", "0-5cm")])),
        "units": {prop: unit for prop, (_, unit) in PROPERTIES.items()},
        "layers": layers,
    }
    cache_file.write_text(json.dumps(soil, indent=1))
    return soil


# ------------------------------------------------------------------ soil physics

def usda_texture(sand: float, silt: float, clay: float) -> str:
    total = sand + silt + clay
    sand, silt, clay = (100 * v / total for v in (sand, silt, clay))
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 2 * clay < 30:
        return "loamy sand"
    if (7 <= clay < 20 and sand > 52) or (clay < 7 and silt < 50):
        return "sandy loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12):
        return "silt loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45:
        return "sandy clay loam"
    if 27 <= clay < 40 and 20 < sand <= 45:
        return "clay loam"
    if 27 <= clay < 40 and sand <= 20:
        return "silty clay loam"
    if clay >= 35 and sand > 45:
        return "sandy clay"
    if clay >= 40 and silt >= 40:
        return "silty clay"
    return "clay"


def saxton_rawls(sand: float, clay: float, organic_matter: float):
    """(field capacity, wilting point) in m³/m³ from sand/clay % and organic matter % (Saxton & Rawls 2006)."""
    S, C, OM = sand / 100, clay / 100, min(max(organic_matter, 0.0), 8.0)
    wp_t = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031
    fc_t = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299
    return fc_t + (1.283 * fc_t ** 2 - 0.374 * fc_t - 0.015), wp_t + (0.14 * wp_t - 0.02)


def _organic_matter(soc_g_per_kg: Optional[float]) -> float:
    return (soc_g_per_kg or 0.0) / 10 * 1.724  # % organic matter = % organic carbon × 1.724


def soil_profile(soil: Dict, root_depth_cm: float = DEFAULT_ROOT_DEPTH_CM) -> Dict:
    """Derived soil characteristics for the root zone, with plain-language notes."""
    layers, taw = [], 0.0
    for depth, top, bottom in DEPTHS:
        l = soil["layers"][depth]
        if l["wv0033"] is not None and l["wv1500"] is not None:
            fc, wp, method = l["wv0033"] / 100, l["wv1500"] / 100, "SoilGrids"
        elif None not in (l["sand"], l["clay"]):
            fc, wp = saxton_rawls(l["sand"], l["clay"], _organic_matter(l["soc"]))
            method = "Saxton & Rawls"
        else:
            continue
        gravel = (l["cfvo"] or 0.0) / 100
        in_root_zone = max(0.0, min(bottom, root_depth_cm) - top) * 10  # mm
        available = max(fc - wp, 0.0) * (1 - gravel) * in_root_zone
        taw += available
        layers.append({"depth": depth, "field_capacity": round(fc, 3), "wilting_point": round(wp, 3),
                       "available_water_mm": round(available, 1), "retention_from": method})

    def topsoil(prop):  # thickness-weighted mean of 0–30 cm
        pairs = [(soil["layers"][d][prop], b - t) for d, t, b in DEPTHS[:3] if soil["layers"][d][prop] is not None]
        return sum(v * w for v, w in pairs) / sum(w for _, w in pairs) if pairs else None

    sand, silt, clay = topsoil("sand"), topsoil("silt"), topsoil("clay")
    ph, cec, soc = topsoil("phh2o"), topsoil("cec"), topsoil("soc")
    texture = usda_texture(sand, silt, clay) if None not in (sand, silt, clay) else None
    om = _organic_matter(soc) if soc is not None else None
    return {
        "texture_class": texture,
        "topsoil_0_30cm": {"sand_%": _r(sand), "silt_%": _r(silt), "clay_%": _r(clay), "organic_matter_%": _r(om),
                           "ph": _r(ph), "cec_cmol_per_kg": _r(cec), "bulk_density_g_cm3": _r(topsoil("bdod"), 2)},
        "root_depth_cm": root_depth_cm,
        "total_available_water_mm": round(taw, 0),
        "layers": layers,
        "notes": _notes(texture, clay, sand, taw, root_depth_cm, ph, om, cec),
    }


def _r(value, digits=1):
    return None if value is None else round(float(value), digits)


def _notes(texture, clay, sand, taw, root_depth_cm, ph, om, cec):
    notes = []
    per_metre = taw / max(root_depth_cm, 1) * 100
    if per_metre < 80:
        notes.append(f"Low water storage ({taw:.0f} mm in {root_depth_cm:.0f} cm): crops run dry quickly, irrigation pays off sooner.")
    elif per_metre < 140:
        notes.append(f"Medium water storage ({taw:.0f} mm in {root_depth_cm:.0f} cm).")
    else:
        notes.append(f"High water storage ({taw:.0f} mm in {root_depth_cm:.0f} cm): buffers dry spells of several weeks.")
    if clay is not None and clay >= 35:
        notes.append("Clay-rich: slow drainage, compaction risk, fewer workable days after rain.")
    elif sand is not None and sand >= 65:
        notes.append("Sandy: drains and warms up fast, nutrients (nitrate) leach easily.")
    if ph is not None:
        if ph < 5.5:
            notes.append(f"Strongly acidic (pH {ph:.1f}): liming usually needed; aluminium can limit roots.")
        elif ph < 6.2:
            notes.append(f"Slightly acidic (pH {ph:.1f}): fine for most crops; legumes and barley prefer liming towards 6.5.")
        elif ph > 8.0:
            notes.append(f"Alkaline (pH {ph:.1f}): phosphorus, iron and zinc are less available.")
    if om is not None and om < 1.5:
        notes.append(f"Low organic matter ({om:.1f} %): low nutrient and water buffering, prone to crusting.")
    if cec is not None and cec < 10:
        notes.append(f"Low nutrient storage (CEC {cec:.0f} cmol/kg): split fertiliser applications.")
    if texture:
        notes.append(f"Texture class: {texture}.")
    return notes


# ------------------------------------------------------------------ soil water balance (FAO-56)

def water_balance(precip: np.ndarray, et0: np.ndarray, taw: float, p: float = DEFAULT_DEPLETION_FRACTION,
                  kc: float = 1.0, initial_depletion: float = 0.0, irrigate: bool = False) -> Dict[str, np.ndarray]:
    """Daily root-zone depletion (mm below field capacity), water stress and irrigation.

    Rain fills the bucket (runoff ignored), Kc × ET0 empties it. Above RAW = p × TAW the crop is
    stressed and actual ET falls linearly to zero at TAW. With irrigate=True the bucket is refilled
    to field capacity whenever the depletion reaches RAW.
    """
    raw = p * taw
    depletion = np.empty(len(precip))
    stressed = np.zeros(len(precip), dtype=bool)
    irrigation = np.zeros(len(precip))
    d = min(max(initial_depletion, 0.0), taw)
    for i in range(len(precip)):
        ks = 1.0 if d <= raw or taw <= raw else max(0.0, (taw - d) / (taw - raw))
        d = min(max(d - precip[i] + ks * kc * et0[i], 0.0), taw)
        if irrigate and d >= raw:
            irrigation[i] = d
            d = 0.0
        stressed[i] = d > raw
        depletion[i] = d
    return {"depletion": depletion, "stressed": stressed, "irrigation": irrigation}


def historical_water_stats(daily: pd.DataFrame, taw: float, kc: float = 1.0) -> Dict:
    """Water stress days and irrigation need per year, observed weather, with this soil."""
    years = daily.index.year
    rain = daily["precip"].fillna(0).values
    et0 = daily["et0"].fillna(0).values
    rainfed = water_balance(rain, et0, taw, kc=kc)
    irrigated = water_balance(rain, et0, taw, kc=kc, irrigate=True)
    per_year = pd.DataFrame({
        "stress_days": rainfed["stressed"], "irrigation_mm": irrigated["irrigation"],
        "no_soil_storage_mm": np.clip(kc * et0 - rain, 0, None),  # what ignoring the soil would say (daily)
    }, index=daily.index).groupby(years).sum()
    full = per_year.loc[(per_year.index >= years.min() + 1) & (per_year.index <= years.max())]

    def summary(frame):
        return {"stress_days_per_year": round(float(frame["stress_days"].mean()), 0),
                "irrigation_need_mm_per_year": round(float(frame["irrigation_mm"].mean()), 0)}

    return {
        "assumption": f"Crop with Kc {kc:g} in the field all year, rain-fed vs. irrigated at {DEFAULT_DEPLETION_FRACTION:.0%} depletion",
        "1991-2020": summary(full.loc[1991:2020]),
        f"last_10_years ({full.index[-10]}–{full.index[-1]})": summary(full.iloc[-10:]),
        "irrigation_need_if_soil_storage_ignored_mm_per_year": round(float(full["no_soil_storage_mm"].loc[1991:2020].mean()), 0),
        "current_depletion_mm": round(float(rainfed["depletion"][-1]), 0),
        "current_plant_available_water_%": round(100 * (1 - rainfed["depletion"][-1] / taw), 0) if taw > 0 else None,
        "as_of": f"{daily.index[-1]:%Y-%m-%d}",
    }
