"""FastAPI service exposing long-range agricultural weather forecasts.

Run:  uvicorn app.main:app --reload
Docs: http://127.0.0.1:8000/docs
"""
import os
import threading
import time
from collections import OrderedDict
from functools import lru_cache
from typing import Dict, List, Literal, Optional, Tuple

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import cache as forecast_cache
from .calibration import (
    CALIBRATABLE, apply_corrections, compute_corrections, delete_station_data, load_station_data, save_station_data,
)
from .data import fetch_climate_indices
from .ensemble import forecast_location
from .features import MONTHLY_VARIABLES, period_means, to_monthly
from .members import MAX_HORIZON_MONTHS, PROPHET_AVAILABLE
from .pollution import SOURCES, crop_safety, fetch_infrastructure, read_air_quality
from .risk import BASE_YEARS, RECENT_YEARS, seasonal_risk
from .rotation import CROPS, forecast_frame, plan_rotation, yearly_crop_scores
from .rotation_compare import DIMENSIONS, compare as compare_rotations, parse_weights
from .seasonal import fetch_seasonal
from .soil import DEFAULT_ROOT_DEPTH_CM, fetch_soil, historical_water_stats, soil_profile
from .sources import fetch_daily, fetch_projections

# Meta Prophet as an extra ensemble member (on by default when installed; USE_PROPHET=0 disables)
USE_PROPHET = PROPHET_AVAILABLE and os.environ.get("USE_PROPHET", "1") != "0"

app = FastAPI(
    title="Agri Weather Forecast API",
    description=(
        "Monthly climate forecasts 1–3 years ahead for agricultural planning. Built from ERA5 reanalysis "
        "(optionally calibrated to your own weather station), CMIP6 climate projections and ENSO/NAO/PDO "
        "climate drivers, combined by a backtested ensemble. These are expected monthly conditions with "
        "uncertainty ranges, not day-by-day weather."
    ),
    version="2.0.0",
)

# The AgriShift frontend talks to this API either through its own dev-server proxy (/api/climate/*)
# or directly from the browser. CORS_ORIGINS="https://a.example,https://b.example" restricts the
# allowed origins; the default is open so the hackathon demo works from any host.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

LatQuery = Query(..., ge=-90, le=90, description="Latitude in decimal degrees")
LonQuery = Query(..., ge=-180, le=180, description="Longitude in decimal degrees")
RootDepthQuery = Query(DEFAULT_ROOT_DEPTH_CM, ge=20, le=100,
                       description="Rooting depth in cm (e.g. lettuce 30, potato 50, wheat/maize 100)")
PeriodQuery = Query("month", description="Average per 'month', meteorological 'season' (Dec–Feb, Mar–May, …) "
                                         "or calendar 'year'. Values stay monthly means in the variable's unit.")
KcQuery = Query(1.0, ge=0.1, le=1.5, description="Crop coefficient: crop water use = Kc × ET0 (1.0 = reference grass; "
                                                  "maize/wheat mid-season ~1.15–1.2)")


def _key(lat: float, lon: float) -> Tuple[float, float]:
    return round(lat, 2), round(lon, 2)


@lru_cache(maxsize=32)
def _daily(lat: float, lon: float) -> Tuple[pd.DataFrame, Dict]:
    """Reanalysis history, corrected toward the station if one was uploaded."""
    daily = fetch_daily(lat, lon)
    station = load_station_data(lat, lon)
    corrections = compute_corrections(daily, station) if station is not None else {}
    if corrections:
        attrs = daily.attrs
        daily = apply_corrections(daily, corrections)
        daily.attrs = attrs  # keep the source label
    return daily, corrections


MEMORY_ENTRIES = 32
_memory: "OrderedDict[str, Dict]" = OrderedDict()  # fingerprint key -> cache entry, newest last
# A degraded result (some climate models failed to load) is never written to
# disk; it is kept in memory for DEGRADED_TTL_S only, so a later request retries the models without
# every request in between re-training the whole ensemble.
DEGRADED_TTL_S = float(os.environ.get("DEGRADED_CACHE_TTL_S", 900))
_degraded: Dict[Tuple[float, float], Tuple[float, Dict, Dict]] = {}  # location -> (expiry, result, cache info)
_location_locks: Dict[Tuple[float, float], threading.Lock] = {}
_locks_guard = threading.Lock()


def _trained_until(daily: pd.DataFrame) -> str:
    last = daily.index[-1]
    month = last.to_period("M").to_timestamp()
    if last != month + pd.offsets.MonthEnd(0):  # trailing partial month is not used for training
        month -= pd.DateOffset(months=1)
    return f"{month:%Y-%m}"


def _remember(cache_key: str, entry: Dict):
    _memory[cache_key] = entry
    _memory.move_to_end(cache_key)
    while len(_memory) > MEMORY_ENTRIES:
        _memory.popitem(last=False)


def _location(lat: float, lon: float, refresh: bool = False) -> Tuple[Dict, Dict]:
    """Forecast for one location: from memory, else from the disk cache, else trained now.

    Returns (result, cache info). `refresh=True` retrains even if a valid cached forecast exists.
    One training run per location: concurrent requests (the frontend asks /agri-summary and /risk
    in parallel) wait for it and then get the cached result instead of training again.
    """
    with _locks_guard:
        lock = _location_locks.setdefault((lat, lon), threading.Lock())
    with lock:
        return _cached_or_trained(lat, lon, refresh)


def _cached_or_trained(lat: float, lon: float, refresh: bool) -> Tuple[Dict, Dict]:
    if not refresh:
        degraded = _degraded.get((lat, lon))
        if degraded is not None and degraded[0] > time.monotonic():
            return degraded[1], degraded[2]
    daily, corrections = _daily(lat, lon)
    projections, cmip_models, cmip_errors = fetch_projections(lat, lon)
    indices = fetch_climate_indices()
    seasonal, seasonal_error = fetch_seasonal(lat, lon, download=False)
    sources = {
        "history": daily.attrs.get("label", "unknown"),
        "history_source": daily.attrs.get("source"),
        "history_period": f"{daily.index[0]:%Y-%m} – {daily.index[-1]:%Y-%m}",
        "history_sources_skipped": daily.attrs.get("skipped") or None,
        "prophet_member": USE_PROPHET,
        "seasonal_forecast": (
            f"ECMWF SEAS5 via Copernicus, starts {seasonal.index.get_level_values(0).min():%Y-%m} – "
            f"{seasonal.index.get_level_values(0).max():%Y-%m}" if seasonal is not None else None
        ),
        "seasonal_forecast_error": seasonal_error,
        "station_calibration": sorted(corrections) or None,
        "climate_projections": cmip_models or None,
        "climate_projection_errors": cmip_errors or None,
        "climate_indices": {
            c: indices[c].dropna().index[-1].strftime("%Y-%m") for c in indices.columns if indices[c].notna().any()
        } or None,
    }
    fingerprint = {"lat": lat, "lon": lon, "trained_until": _trained_until(daily), "code": forecast_cache.CODE_VERSION,
                   "sources": sources, "corrections": corrections}
    cache_key = forecast_cache.key(fingerprint)

    if not refresh:
        if cache_key in _memory:
            _memory.move_to_end(cache_key)
            return _memory[cache_key]["result"], {"status": "memory", "created": _memory[cache_key]["created"]}
        entry = forecast_cache.load(lat, lon, fingerprint)
        if entry is not None:
            _remember(cache_key, entry)
            return entry["result"], {"status": "disk", "created": entry["created"]}

    result = forecast_location(daily, projections, indices, use_prophet=USE_PROPHET, seasonal=seasonal)
    result["sources"] = sources
    if cmip_errors:
        info = {"status": f"memory only for {DEGRADED_TTL_S / 60:.0f} min (climate projections incomplete)",
                "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
        _degraded[(lat, lon)] = (time.monotonic() + DEGRADED_TTL_S, result, info)
        return result, info
    entry = forecast_cache.save(lat, lon, fingerprint, result)
    _remember(cache_key, entry)
    return result, {"status": "computed", "created": entry["created"]}


@lru_cache(maxsize=64)
def _soil(lat: float, lon: float) -> Dict:
    return fetch_soil(lat, lon)


@lru_cache(maxsize=64)
def _infrastructure(lat: float, lon: float) -> Dict:
    return fetch_infrastructure(lat, lon)


def _site_pollution(lat: float, lon: float) -> Dict:
    """Nearby pollution sources, air quality and the crop-safety verdict. Raises if OpenStreetMap fails."""
    nearest = _infrastructure(round(lat, 4), round(lon, 4))  # road distances need ~10 m, not the 1 km grid
    # Air quality is a second opinion – without it the distances alone still give a verdict
    air = read_air_quality(*_key(lat, lon)) or {
        "error": f"Not downloaded yet: python scripts/download_copernicus.py --lat {lat} --lon {lon} --only cams"}
    return {
        "infrastructure": {c: {**s, "emits": SOURCES[c][-1]} for c, s in nearest.items()},
        "air_quality": air,
        **crop_safety(nearest, None if "error" in air else air),
        "note": "Screening from distances (OpenStreetMap) and modelled air (CAMS reanalysis), not a measurement – "
                "a soil test decides at 'caution' and 'avoid' sites.",
    }


def _clear_caches():
    """Forget everything held in memory (the disk cache is keyed by its inputs and stays valid)."""
    _daily.cache_clear()
    _memory.clear()
    _degraded.clear()


def _upstream(fn, *args):
    try:
        return fn(*args)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load data: {exc}")


def _parse_variables(variables: Optional[str]) -> List[str]:
    if not variables:
        return list(MONTHLY_VARIABLES)
    names = [v.strip() for v in variables.split(",") if v.strip()]
    unknown = [v for v in names if v not in MONTHLY_VARIABLES]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown variables: {unknown}. See /variables.")
    return names


@app.get("/")
def root():
    return {
        "status": "ok",
        "docs": "/docs",
        "endpoints": ["/variables", "/history", "/forecast", "/agri-summary", "/risk", "/soil", "/rotation",
                      "/pollution", "/calibration", "/cache"],
    }


@app.get("/variables")
def variables():
    """All forecast variables, their units and why they matter for agriculture."""
    return [
        {"name": name, "monthly_aggregation": how, "unit": unit, "agricultural_relevance": why}
        for name, (how, unit, why) in MONTHLY_VARIABLES.items()
    ]


@app.get("/history")
def history(
    lat: float = LatQuery,
    lon: float = LonQuery,
    start_year: int = Query(2000, ge=1980),
    variables: Optional[str] = Query(None, description="Comma-separated, e.g. 'precip,gdd'. Default: all"),
    period: Literal["month", "season", "year"] = PeriodQuery,
):
    """Observed monthly values (station-calibrated if a station was uploaded), optionally averaged per period."""
    names = _parse_variables(variables)
    daily, _ = _upstream(_daily, *_key(lat, lon))
    df = to_monthly(daily)
    df = df[df.index.year >= start_year][names]
    out = {"latitude": lat, "longitude": lon, "period": period}
    if period == "month":
        out["months"] = [{"month": idx.strftime("%Y-%m"), **row.to_dict()} for idx, row in df.round(3).iterrows()]
    else:
        agg = period_means(df, period).round(3)
        out["periods"] = [{"period": label, **row.to_dict()} for label, row in agg.iterrows()]
    return out


@app.get("/forecast")
def forecast(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3, description="Forecast horizon in years"),
    variables: Optional[str] = Query(None, description="Comma-separated, e.g. 'tmean,precip'. Default: all"),
    refresh: bool = Query(False, description="Ignore the cached forecast and retrain (~25 s)"),
    period: Literal["month", "season", "year"] = PeriodQuery,
):
    """Monthly ensemble forecast with 80 % range, per-model values and out-of-sample backtest skill.

    With period=season|year the monthly rows are additionally averaged into `periods` (forecast, range and
    per-model values); `forecast` keeps the monthly rows.

    The first request for a new location downloads data and trains all models (~1–2 min); after that the
    forecast comes from the cache until a new month of data arrives.
    """
    names = _parse_variables(variables)
    result, cache_info = _upstream(_location, *_key(lat, lon), refresh)
    months = min(years * 12, MAX_HORIZON_MONTHS)
    variables_out = {}
    for name in names:
        rows = result["variables"][name]["forecast"][:months]
        variables_out[name] = {
            "unit": MONTHLY_VARIABLES[name][1],
            "backtest": result["variables"][name]["backtest"],
            "forecast": rows,
        }
        if period != "month":
            variables_out[name]["periods"] = _forecast_periods(rows, period)
    return {
        "latitude": lat,
        "longitude": lon,
        "trained_until": result["trained_until"],
        "horizon_months": months,
        "period": period,
        "cache": cache_info,
        "sources": result["sources"],
        "variables": variables_out,
    }


def _forecast_periods(rows: List[Dict], period: str) -> List[Dict]:
    # shortcut: averaging the monthly 80 % bounds gives a slightly too wide range (errors partly cancel
    # over a season), upgrade to aggregating the ensemble spread if period ranges get used for decisions
    frame = pd.DataFrame(
        [{"forecast": r["forecast"], "lower_80": r["lower_80"], "upper_80": r["upper_80"],
          **{f"model:{m}": v for m, v in r["models"].items()}} for r in rows],
        index=pd.DatetimeIndex([pd.Timestamp(r["month"]) for r in rows]),
    )
    agg = period_means(frame, period).round(2)
    out = []
    for label, row in agg.iterrows():
        models = {k[6:]: v for k, v in row.items() if k.startswith("model:") and pd.notna(v)}
        out.append({"period": label, **{k: v for k, v in row.items() if not k.startswith("model:")},
                    "models": models})
    return out


@app.get("/agri-summary")
def agri_summary(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3),
    refresh: bool = Query(False, description="Ignore the cached forecast and retrain (~25 s)"),
):
    """Per calendar year: key farming indicators vs. the 1991–2020 normal for the same months."""
    key = _key(lat, lon)
    result, cache_info = _upstream(_location, *key, refresh)
    daily, _ = _daily(*key)
    df = to_monthly(daily)
    months = min(years * 12, MAX_HORIZON_MONTHS)
    keys = ["gdd", "precip", "et0", "water_balance", "frost_days", "heat_days", "wet_days", "tmean", "soil_moisture_root"]

    fc = pd.DataFrame({
        k: {pd.Timestamp(r["month"]): r["forecast"] for r in result["variables"][k]["forecast"][:months]}
        for k in keys
    })
    normal_period = df[(df.index.year >= 1991) & (df.index.year <= 2020)]
    normals = normal_period[keys].groupby(normal_period.index.month).mean()

    summary = []
    for year, block in fc.groupby(fc.index.year):
        norm = normals.loc[block.index.month]
        entry = {
            "year": int(year),
            "months_covered": f"{block.index[0]:%Y-%m} – {block.index[-1]:%Y-%m}",
            "complete_year": len(block) == 12,
            "indicators": {},
        }
        for k in keys:
            how, unit, _ = MONTHLY_VARIABLES[k]
            value = block[k].sum() if how == "sum" else block[k].mean()
            normal = norm[k].sum() if how == "sum" else norm[k].mean()
            digits = 3 if unit == "m³/m³" else 1
            entry["indicators"][k] = {
                "forecast": round(float(value), digits),
                "normal_1991_2020": round(float(normal), digits),
                "anomaly": round(float(value - normal), digits),
                "unit": unit,
            }
        entry["deficit_months"] = [f"{m:%Y-%m}" for m in block.index[block["water_balance"] < 0]]
        entry["frost_free_months"] = int((block["frost_days"] < 0.5).sum())
        summary.append(entry)

    return {"latitude": lat, "longitude": lon, "cache": cache_info, "sources": result["sources"], "summary": summary}


@app.get("/risk")
def risk(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3),
    root_depth_cm: float = RootDepthQuery,
    kc: float = KcQuery,
    use_soil: bool = Query(True, description="Include soil water stress and soil-aware irrigation need"),
    refresh: bool = Query(False, description="Ignore the cached forecast and retrain (~25 s)"),
):
    """Per season: probability of a dry, wet, drought, hot or frost season, and the irrigation need.

    Compare `probability` with `normal_probability` (1991–2020) and with how often it actually happened
    recently. For rain the forecast has little skill, so the main signal is the climate trend.
    """
    key = _key(lat, lon)
    result, cache_info = _upstream(_location, *key, refresh)
    daily, _ = _daily(*key)
    months = min(years * 12, MAX_HORIZON_MONTHS)
    forecasts = {v: r["forecast"][:months] for v, r in result["variables"].items()}
    soil, soil_info = None, None
    if use_soil:
        try:
            profile = soil_profile(_soil(*key), root_depth_cm)
            soil = {"taw_mm": profile["total_available_water_mm"], "kc": kc}
            soil_info = {"texture_class": profile["texture_class"], "root_depth_cm": root_depth_cm, "kc": kc,
                         "total_available_water_mm": profile["total_available_water_mm"]}
        except Exception as exc:  # soil server down or no soil here → climate-only risk
            soil_info = {"error": f"No soil data, soil water left out: {exc}"}
    return {
        "latitude": lat,
        "longitude": lon,
        "method": (f"Observed weather of {BASE_YEARS[0]}–{BASE_YEARS[1]} shifted by the forecast → 30 possible "
                   f"outcomes per season; thresholds from {BASE_YEARS[0]}–{BASE_YEARS[1]}; "
                   f"'observed_last_{RECENT_YEARS}_years' shows what actually happened recently"),
        "cache": cache_info,
        "sources": result["sources"],
        "soil": soil_info,
        "seasons": seasonal_risk(daily, forecasts, soil),
    }


@app.get("/soil")
def soil(
    lat: float = LatQuery,
    lon: float = LonQuery,
    root_depth_cm: float = RootDepthQuery,
    kc: float = KcQuery,
):
    """The soil at this location (ISRIC SoilGrids, 250 m) and what it means for crops.

    Texture, organic matter, pH, nutrient storage and plant-available water in the root zone, plus a
    daily soil water balance on the observed weather: days of water stress for a rain-fed crop and the
    irrigation need per year – then vs. now – and today's soil water status.
    """
    key = _key(lat, lon)
    try:
        raw = _soil(*key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load soil data: {exc}")
    profile = soil_profile(raw, root_depth_cm)
    daily, _ = _upstream(_daily, *key)
    return {
        "latitude": lat,
        "longitude": lon,
        "source": raw["source"],
        "search_radius_km": raw["search_radius_km"],
        "profile": profile,
        "water": historical_water_stats(daily, profile["total_available_water_mm"], kc),
        "layers": raw["layers"],
        "units": raw["units"],
    }


@app.get("/pollution")
def pollution(lat: float = LatQuery, lon: float = LonQuery):
    """Is it safe to grow food here? Pollution from roads, railways, industry, power plants, airports,
    landfills and quarries around the field (OpenStreetMap) plus air quality (CAMS reanalysis: ozone, NO₂, SO₂, PM2.5),
    turned into a safe / caution / avoid verdict per crop group with what to do about it.
    """
    try:
        return {"latitude": lat, "longitude": lon, **_site_pollution(lat, lon)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load OpenStreetMap data: {exc}")


HistoryQuery = Query(None, description=f"Crops of the last years, oldest first, comma-separated. "
                                       f"Known crops: {', '.join(CROPS)}")


def _crop_list(text: Optional[str]) -> List[str]:
    crops = [c.strip() for c in (text or "").split(",") if c.strip()]
    unknown = [c for c in crops if c not in CROPS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown crops: {unknown}. Known crops: {list(CROPS)}")
    return crops


def _rotation_inputs(lat: float, lon: float, years: int, use_pollution: bool, refresh: bool) -> Dict:
    """Forecast, soil and pollution for one field, as the rotation endpoints need them."""
    key = _key(lat, lon)
    result, cache_info = _upstream(_location, *key, refresh)
    horizon = min(years * 12, MAX_HORIZON_MONTHS)
    taw = ph = texture = None
    try:
        profile = soil_profile(_soil(*key))
        taw, ph, texture = profile["total_available_water_mm"], profile["topsoil_0_30cm"]["ph"], profile["texture_class"]
        soil_info = {"texture_class": texture, "ph": ph, "total_available_water_mm": taw}
    except Exception as exc:
        soil_info = {"error": f"No soil data, soil storage and pH left out: {exc}"}
    safety = aot40 = pollution_info = None
    if use_pollution:
        try:
            safety = _site_pollution(lat, lon)
            aot40 = safety["air_quality"].get("ozone_aot40_may_jul_ug_m3_h")
            pollution_info = {g: v["verdict"] for g, v in safety["crop_groups"].items()}
        except Exception as exc:
            safety = None
            pollution_info = {"error": f"No pollution data, left out: {exc}"}
    return {
        "forecasts": {v: r["forecast"][:horizon] for v, r in result["variables"].items()},
        "taw": taw, "ph": ph, "texture": texture, "safety": safety, "aot40": aot40,
        "meta": {"latitude": lat, "longitude": lon, "cache": cache_info, "sources": result["sources"],
                 "soil": soil_info, "pollution": pollution_info},
    }


@app.get("/rotation")
def rotation(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3),
    history: Optional[str] = HistoryQuery,
    use_pollution: bool = Query(True, description="Leave out crops that are unsafe here because of nearby pollution"),
    refresh: bool = Query(False, description="Ignore the cached forecast and retrain (~25 s)"),
):
    """Crop rotation: one crop per forecast year, scored on the forecast warmth, water and heat for its
    growing months, the soil and nearby pollution, and chosen so the rotation stays healthy (breaks
    between crop families, legumes before nitrogen-hungry crops). Each year lists the alternatives too.
    """
    planted = _crop_list(history)
    inputs = _rotation_inputs(lat, lon, years, use_pollution, refresh)
    return {
        **inputs["meta"],
        "history": planted,
        "plan": plan_rotation(inputs["forecasts"], lat, planted, inputs["taw"], inputs["ph"], inputs["safety"],
                              inputs["aot40"]),
        "crops": {name: crop["family"] for name, crop in CROPS.items()},
    }


@app.get("/rotation/compare")
def rotation_compare(
    lat: float = LatQuery,
    lon: float = LonQuery,
    years: int = Query(3, ge=1, le=3),
    history: Optional[str] = HistoryQuery,
    weights: Optional[str] = Query(None, description=f"How much each dimension counts in the overall score, "
                                                     f"e.g. 'erosion=2,market=0.5' (default 1 each). "
                                                     f"Dimensions: {', '.join(DIMENSIONS)}"),
    rotations: Optional[str] = Query(None, description="Your own rotations to compare, ';'-separated, each a "
                                                       "','-separated crop per year, e.g. "
                                                       "'winter_wheat,maize,field_pea;oats,faba_bean,winter_wheat'"),
    use_pollution: bool = Query(True, description="Leave out crops that are unsafe here because of nearby pollution"),
    refresh: bool = Query(False, description="Ignore the cached forecast and retrain (~25 s)"),
):
    """Rotation scenarios side by side: the climate-best plan, the best rotation for each goal (soil building,
    water saving, erosion control, forage, market) and your own rotations, each scored 0–100 on climate fit,
    nutrient cycling, organic matter, erosion risk, pest-cycle disruption, water use, forage potential and
    market, with the figures behind the scores and what each scenario gains or gives up against the plan /rotation recommends.
    """
    planted = _crop_list(history)
    try:
        weight_map = parse_weights(weights)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    custom = [_crop_list(r) for r in (rotations or "").split(";") if r.strip()]
    inputs = _rotation_inputs(lat, lon, years, use_pollution, refresh)
    year_scores = yearly_crop_scores(forecast_frame(inputs["forecasts"]), lat, inputs["taw"], inputs["ph"],
                                     inputs["safety"], inputs["aot40"])
    if any(len(c) != len(year_scores) for c in custom):
        raise HTTPException(status_code=400, detail=f"Each rotation needs one crop per forecast year "
                                                    f"({len(year_scores)} here: {[y for y, _ in year_scores]})")
    plan = plan_rotation(inputs["forecasts"], lat, planted, inputs["taw"], inputs["ph"], inputs["safety"],
                         inputs["aot40"])
    annual_rain = float(forecast_frame(inputs["forecasts"])["precip"].mean() * 12)
    return {
        **inputs["meta"],
        "history": planted,
        **compare_rotations(year_scores, plan, planted, inputs["texture"], annual_rain, weight_map, custom),
    }


@app.post("/calibration")
async def upload_station(lat: float = LatQuery, lon: float = LonQuery, file: UploadFile = File(...)):
    """Upload daily station observations (CSV) to calibrate this location.

    Columns: `date` (YYYY-MM-DD) plus any of the calibratable variables, e.g.
    `date,tmax,tmin,precip`. At least 365 days overlapping 1980–today are needed per variable.
    """
    try:
        station = save_station_data(lat, lon, await file.read())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _clear_caches()
    return {
        "stored_columns": list(station.columns),
        "date_range": [f"{station.index[0]:%Y-%m-%d}", f"{station.index[-1]:%Y-%m-%d}"],
        **get_calibration(lat, lon),
    }


@app.get("/calibration")
def get_calibration(lat: float = LatQuery, lon: float = LonQuery):
    """Corrections currently applied to this location (per variable and calendar month)."""
    if load_station_data(lat, lon) is None:
        return {"calibrated": False, "calibratable_variables": sorted(CALIBRATABLE)}
    _, corrections = _upstream(_daily, *_key(lat, lon))
    return {"calibrated": bool(corrections), "corrections": corrections}


@app.delete("/calibration")
def remove_calibration(lat: float = LatQuery, lon: float = LonQuery):
    removed = delete_station_data(lat, lon)
    _clear_caches()
    return {"removed": removed}


@app.get("/cache")
def list_cache():
    """Forecasts stored on disk. `current_code: false` entries were made by older model code and are never reused."""
    return {"code_version": forecast_cache.CODE_VERSION, "in_memory": len(_memory), "entries": forecast_cache.entries()}


@app.delete("/cache")
def clear_cache(lat: Optional[float] = Query(None, ge=-90, le=90), lon: Optional[float] = Query(None, ge=-180, le=180)):
    """Delete cached forecasts – for one location (lat + lon) or all."""
    if (lat is None) != (lon is None):
        raise HTTPException(status_code=400, detail="Give both lat and lon, or neither to clear everything.")
    removed = forecast_cache.clear(*_key(lat, lon)) if lat is not None else forecast_cache.clear()
    _memory.clear()
    return {"removed": removed}
