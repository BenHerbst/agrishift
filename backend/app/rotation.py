"""Crop rotation plan for the forecast years.

Each year every crop gets a 0–100 suitability score from the forecast for its growing months:
  * warmth – forecast growing degree days (base 10 °C) vs. what the crop needs to ripen
  * water  – crop demand Kc × ET0 minus rain, less half the soil's plant-available water,
             weighted by the crop's drought tolerance
  * heat   – forecast heat days (Tmax ≥ 30 °C), weighted by the crop's heat tolerance
  * frost  – frost days after sowing, for frost-sensitive crops
  * disease – humid air and many wet days favour fungal disease (sunflower, potato blight, peas …)
  * soil pH – points lost per pH unit outside the crop's range
  * pollution (pollution.py) – a crop whose group is 'avoid' at this site is left out, 'caution'
    costs points, ozone-sensitive crops lose points where ozone is high
Then, year by year, the best-scoring crop that keeps the rotation healthy is chosen:
  * never the same crop twice in a row, at most two cereal years in a row
  * a family comes back only after its break (legumes, rapeseed, potato, beet, sunflower), otherwise
    soil-borne diseases and pests build up
  * cereals, maize and rapeseed after a legume or clover-grass get a bonus (nitrogen left in the soil)
  * wheat right after maize loses points (Fusarium head blight / mycotoxins from maize residue)

shortcut: crop requirements are rule-of-thumb values for temperate Europe; winter crops are scored
on their main growing months only (no winter hardiness). Calibrate per region when yield data exists.
"""
from typing import Dict, List, Optional

import pandas as pd

from .pollution import AOT40_LONG_TERM, AOT40_TARGET

CROPS = {
    # months: main growing months in the northern hemisphere; gdd: °C·days (base 10 °C) needed in them;
    # drought / heat: tolerance 0–1; disease: how much humid, wet weather raises fungal disease 0–1;
    # ph: range without yield loss (barley, beet and pulses suffer most on acid soils); group: crop group in pollution.py
    "winter_wheat": dict(family="cereal", months=(3, 7), gdd=450, kc=1.15, drought=0.5, heat=0.4, frost_sensitive=False,
                         disease=0.2, ph=(5.8, 7.5), group="grain_crops", ozone_sensitive=True),  # Septoria
    "winter_barley": dict(family="cereal", months=(3, 6), gdd=300, kc=1.15, drought=0.5, heat=0.4, frost_sensitive=False,
                          disease=0.1, ph=(6.2, 7.8), group="grain_crops", ozone_sensitive=False),
    "spring_barley": dict(family="cereal", months=(4, 7), gdd=450, kc=1.1, drought=0.4, heat=0.4, frost_sensitive=False,
                          disease=0.1, ph=(6.2, 7.8), group="grain_crops", ozone_sensitive=False),
    "oats": dict(family="cereal", months=(4, 7), gdd=400, kc=1.1, drought=0.3, heat=0.3, frost_sensitive=False,
                 disease=0.0, ph=(5.0, 7.5), group="grain_crops", ozone_sensitive=False),
    "maize": dict(family="maize", months=(5, 9), gdd=800, kc=1.2, drought=0.4, heat=0.7, frost_sensitive=True,
                  disease=0.0, ph=(5.5, 7.5), group="fodder", ozone_sensitive=False),
    "winter_rapeseed": dict(family="brassica", months=(3, 7), gdd=400, kc=1.1, drought=0.5, heat=0.4,
                            frost_sensitive=False, disease=0.3, ph=(6.0, 7.5), group="grain_crops",
                            ozone_sensitive=False),  # Sclerotinia
    "sunflower": dict(family="asteraceae", months=(5, 9), gdd=1000, kc=1.05, drought=0.8, heat=0.8, frost_sensitive=True,
                      disease=1.0, ph=(6.0, 7.5), group="grain_crops", ozone_sensitive=False),  # Sclerotinia, Botrytis
    "potato": dict(family="solanaceae", months=(4, 9), gdd=600, kc=1.15, drought=0.2, heat=0.3, frost_sensitive=True,
                   disease=0.5, ph=(5.0, 6.5), group="root_vegetables", ozone_sensitive=True),  # late blight
    "sugar_beet": dict(family="beet", months=(4, 10), gdd=900, kc=1.2, drought=0.5, heat=0.5, frost_sensitive=False,
                       disease=0.1, ph=(6.5, 8.0), group="root_vegetables", ozone_sensitive=False),
    "field_pea": dict(family="legume", months=(3, 7), gdd=400, kc=1.05, drought=0.4, heat=0.3, frost_sensitive=False,
                      disease=0.4, ph=(6.2, 7.5), group="grain_crops", ozone_sensitive=True),
    "faba_bean": dict(family="legume", months=(3, 8), gdd=550, kc=1.1, drought=0.3, heat=0.3, frost_sensitive=False,
                      disease=0.2, ph=(6.2, 7.5), group="grain_crops", ozone_sensitive=True),
    "soybean": dict(family="legume", months=(5, 9), gdd=900, kc=1.1, drought=0.5, heat=0.6, frost_sensitive=True,
                    disease=0.3, ph=(6.0, 7.0), group="grain_crops", ozone_sensitive=True),
    "clover_grass": dict(family="ley", months=(4, 9), gdd=300, kc=1.0, drought=0.4, heat=0.4, frost_sensitive=False,
                         disease=0.0, ph=(5.5, 7.5), group="fodder", ozone_sensitive=False),
}
HUMID_FROM_PCT, WET_DAYS_FROM = 65, 8  # disease pressure grows above these season means (humidity, wet days / month)
# Years the family must stay off the field before it may come back
FAMILY_BREAK = {"cereal": 0, "maize": 0, "ley": 0, "legume": 4, "brassica": 3, "solanaceae": 3, "beet": 3, "asteraceae": 4}
NITROGEN_FIXERS = {"legume", "ley"}
NITROGEN_USERS = {"cereal", "maize", "brassica"}


def season_months(start: int, end: int) -> List[int]:
    """Calendar months from start to end, wrapping over New Year (e.g. 9 → 1 in the southern hemisphere)."""
    return [(start - 1 + i) % 12 + 1 for i in range((end - start) % 12 + 1)]


def season_targets(months: List[int], year: int) -> List[pd.Timestamp]:
    """First day of each month of the season harvested in `year`."""
    return [pd.Timestamp(year - int(m > months[-1]), m, 1) for m in months]


def _growing_months(crop: Dict, lat: float) -> List[int]:
    start, end = crop["months"]
    if lat < 0:  # southern hemisphere: same season six months later
        start, end = (start + 5) % 12 + 1, (end + 5) % 12 + 1
    return season_months(start, end)


def crop_score(name: str, fc: pd.DataFrame, year: int, lat: float, taw: Optional[float] = None,
               ph: Optional[float] = None, safety: Optional[Dict] = None, aot40: Optional[float] = None) -> Optional[Dict]:
    """Suitability of one crop harvested in `year`; None if its growing months are not all in the forecast."""
    crop = CROPS[name]
    target = season_targets(_growing_months(crop, lat), year)
    if not all(t in fc.index for t in target):
        return None
    block = fc.loc[target]
    score, reasons = 100.0, []

    def penalty(points, reason):
        nonlocal score
        if points >= 1:
            score -= points
            reasons.append(f"{reason} (−{points:.0f})")

    gdd = float(block["gdd"].sum())
    penalty(100 * max(0.0, 1 - gdd / crop["gdd"]), f"Too cool: {gdd:.0f} of {crop['gdd']} °C·days needed")
    demand = float((crop["kc"] * block["et0"]).sum())
    deficit = max(0.0, demand - float(block["precip"].sum()) - 0.5 * (taw or 0))
    if demand > 0:
        penalty(60 * deficit / demand * (1 - crop["drought"]), f"Rain-fed water shortfall {deficit:.0f} mm")
    heat = float(block["heat_days"].sum())
    penalty(min(30.0, 1.5 * heat * (1 - crop["heat"])), f"{heat:.0f} heat days")
    if crop["frost_sensitive"]:
        frost = float(block["frost_days"].iloc[1:].sum())
        penalty(min(30.0, 5 * frost), f"{frost:.1f} frost days after sowing")
    if crop["disease"]:
        humidity, wet = float(block["humidity"].mean()), float(block["wet_days"].mean())
        pressure = 2 * max(0.0, humidity - HUMID_FROM_PCT) + 2 * max(0.0, wet - WET_DAYS_FROM)
        penalty(min(40.0, crop["disease"] * pressure),
                f"Humid and wet ({humidity:.0f} % humidity, {wet:.0f} wet days/month): fungal disease pressure")
    low, high = crop["ph"]
    if ph is not None:
        off = low - ph if ph < low else ph - high if ph > high else 0.0
        penalty(min(30.0, 15 * off), f"Soil pH {ph:.1f} outside {low}–{high}" + (", lime first" if ph < low else ""))
    if safety:
        verdict = safety["crop_groups"][crop["group"]]
        if verdict["verdict"] == "avoid":
            return {"score": 0, "excluded": "Pollution: " + "; ".join(verdict["reasons"])}
        if verdict["verdict"] == "caution":
            penalty(15, "Pollution caution: " + verdict["reasons"][0])
    if crop["ozone_sensitive"] and aot40:
        penalty(10 if aot40 > AOT40_TARGET else 4 if aot40 > AOT40_LONG_TERM else 0, "Ozone-sensitive crop")
    return {"score": max(0.0, score), "reasons": reasons or ["Climate and soil suit this crop well"],
            "water_demand_mm": round(demand), "water_shortfall_mm": round(deficit)}


def rotation_block(name: str, planted: List[str]) -> Optional[str]:
    """Why this crop can't follow the crops planted so far (oldest first), or None."""
    family = CROPS[name]["family"]
    if planted and planted[-1] == name:
        return "Same crop as last year"
    if family == "cereal" and len(planted) >= 2 and all(CROPS[p]["family"] == "cereal" for p in planted[-2:]):
        return "Would be the third cereal year in a row"
    gap = FAMILY_BREAK[family]
    if gap and any(CROPS[p]["family"] == family for p in planted[-gap:]):
        return f"{family} needs {gap} years off the field (soil-borne diseases and pests)"
    return None


def _rotation_effect(name: str, planted: List[str]):
    if not planted:
        return 0, []
    previous, family = planted[-1], CROPS[name]["family"]
    if CROPS[previous]["family"] in NITROGEN_FIXERS and family in NITROGEN_USERS:
        return 10, [f"Uses the nitrogen left by {previous} (+10)"]
    if previous == "maize" and name == "winter_wheat":
        return -20, ["Fusarium / mycotoxin risk from the maize residue (−20)"]
    return 0, []


def forecast_frame(forecasts: Dict[str, List[Dict]]) -> pd.DataFrame:
    """The /forecast rows (variable -> [{"month": "YYYY-MM", "forecast": value}]) as month × variable."""
    return pd.DataFrame({var: {pd.Timestamp(r["month"]): r["forecast"] for r in rows} for var, rows in forecasts.items()})


def yearly_crop_scores(fc: pd.DataFrame, lat: float, taw: Optional[float] = None, ph: Optional[float] = None,
                       safety: Optional[Dict] = None, aot40: Optional[float] = None) -> List[tuple]:
    """[(year, {crop: crop_score result})] for every year whose growing seasons lie fully inside the forecast."""
    out = []
    for year in sorted(set(fc.index.year)):
        results = {name: crop_score(name, fc, year, lat, taw, ph, safety, aot40) for name in CROPS}
        if not any(r is None for r in results.values()):
            out.append((int(year), results))
    return out


def plan_rotation(forecasts: Dict[str, List[Dict]], lat: float, history: List[str] = (), taw: Optional[float] = None,
                  ph: Optional[float] = None, safety: Optional[Dict] = None, aot40: Optional[float] = None) -> List[Dict]:
    """`forecasts`: variable -> list of {"month": "YYYY-MM", "forecast": value}; `history`: crops so far, oldest first."""
    planted, plan = list(history), []
    for year, results in yearly_crop_scores(forecast_frame(forecasts), lat, taw, ph, safety, aot40):
        options, not_possible = {}, {}
        for name, result in results.items():
            why_not = result.get("excluded") or rotation_block(name, planted)
            if why_not:
                not_possible[name] = why_not
                continue
            bonus, notes = _rotation_effect(name, planted)
            options[name] = {"score": round(min(100.0, max(0.0, result["score"] + bonus))), "reasons": result["reasons"] + notes}
        ranked = sorted(options, key=lambda n: options[n]["score"], reverse=True)
        best = ranked[0] if ranked else None
        if best:
            planted.append(best)
        plan.append({
            "year": year,
            "crop": best,
            "family": CROPS[best]["family"] if best else None,
            "score": options[best]["score"] if best else None,
            "reasons": options[best]["reasons"] if best else ["No crop fits – sow a cover crop and rest the field"],
            "alternatives": [{"crop": n, "score": options[n]["score"]} for n in ranked[1:4]],
            "not_possible": not_possible,
        })
    return plan
