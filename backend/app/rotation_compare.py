"""Compare crop-rotation scenarios on more than climate fit.

Every rotation (a crop per forecast year) is scored 0–100 (higher is better) on eight dimensions:

  climate_fit      – mean suitability of its crops for the forecast (rotation.py)
  nutrient_cycling – mineral nitrogen that must be bought: each crop's N need minus what the previous
                     crop left behind (legumes and clover-grass fix nitrogen)
  organic_matter   – humus balance in kg C/ha/year (VDLUFA humus-reproduction values: root and silage crops
                     use up humus, legumes and clover-grass build it)
  erosion          – soil cover over the year (USLE cover factor C of each crop), scaled by the site's
                     rainfall and how erodible its soil texture is
  pest_cycle       – how well the sequence breaks host cycles: crop families that differ, family breaks kept
                     (rotation.py rules), no cereal-dominated sequence
  water_use        – rain-fed water shortfall (crop demand Kc × ET0 − rain − half the soil's stored water)
  forage           – feed value of the crops (forage, feed grain, protein, by-products)
  market           – indicative gross-margin level, minus penalties for volatile or contract-bound crops,
                     plus a small bonus for spreading revenue over several crops

Besides the plan that /rotation recommends (best crop year by year), the best rotation for climate fit and
for each goal (soil building, water saving, erosion control, forage, market) is searched among all
rotations that keep the rotation rules and whose crops all suit the climate (suitability ≥ MIN_SUITABILITY),
so goals are compared on what they cost in climate fit.

shortcut: the crop traits are rule-of-thumb values for temperate Europe (humus values from the VDLUFA
standard, cover factors from USLE tables, margin / feed indices are relative and not live prices).
Replace them with regional data (KTBL margins, local price feeds) when available.
"""
from typing import Dict, Iterator, List, Optional, Tuple

import numpy as np

from .rotation import CROPS, _rotation_effect, rotation_block

TRAITS = {
    # n_need: mineral N a crop needs in kg/ha; n_credit: kg/ha it leaves for the next crop; humus: kg C/ha/year;
    # cover: USLE C factor (lower = better soil cover); feed: feed value 0–100; margin: relative gross margin
    # 0–100; risk: price volatility / contract dependence 0–1
    "winter_wheat":    dict(n_need=200, n_credit=0,  humus=-280, cover=0.15, feed=35,  margin=65, risk=0.2),
    "winter_barley":   dict(n_need=150, n_credit=0,  humus=-280, cover=0.15, feed=60,  margin=50, risk=0.15),
    "spring_barley":   dict(n_need=130, n_credit=0,  humus=-280, cover=0.25, feed=55,  margin=45, risk=0.15),
    "oats":            dict(n_need=100, n_credit=0,  humus=-280, cover=0.25, feed=55,  margin=35, risk=0.3),
    "maize":           dict(n_need=180, n_credit=0,  humus=-560, cover=0.40, feed=90,  margin=70, risk=0.2),
    "winter_rapeseed": dict(n_need=190, n_credit=0,  humus=-280, cover=0.20, feed=40,  margin=65, risk=0.3),
    "sunflower":       dict(n_need=100, n_credit=0,  humus=-280, cover=0.35, feed=35,  margin=45, risk=0.35),
    "potato":          dict(n_need=180, n_credit=0,  humus=-760, cover=0.40, feed=20,  margin=95, risk=0.6),
    "sugar_beet":      dict(n_need=140, n_credit=0,  humus=-760, cover=0.35, feed=45,  margin=85, risk=0.4),
    "field_pea":       dict(n_need=0,   n_credit=30, humus=160,  cover=0.20, feed=55,  margin=40, risk=0.4),
    "faba_bean":       dict(n_need=0,   n_credit=40, humus=160,  cover=0.20, feed=55,  margin=40, risk=0.4),
    "soybean":         dict(n_need=0,   n_credit=20, humus=160,  cover=0.30, feed=50,  margin=50, risk=0.4),
    "clover_grass":    dict(n_need=0,   n_credit=60, humus=800,  cover=0.03, feed=100, margin=30, risk=0.3),
}
assert set(TRAITS) == set(CROPS)

DIMENSIONS = {
    "climate_fit": "Mean suitability of the crops for the forecast climate and soil",
    "nutrient_cycling": "Less mineral nitrogen to buy: nitrogen fixed by legumes and clover-grass is reused",
    "organic_matter": "Humus balance: legumes and clover-grass build humus, root and silage crops use it up",
    "erosion": "Soil cover through the year (lower erosion risk), scaled by site rainfall and soil texture",
    "pest_cycle": "Disruption of pest and disease cycles: different crop families, rotation breaks kept",
    "water_use": "Low rain-fed water shortfall of the crops' growing seasons",
    "forage": "Feed value: forage, feed grain, protein and by-products",
    "market": "Indicative margin, less price volatility and contract dependence, plus revenue spread",
}
GOALS = {
    # scenario label: dimensions it is optimised for
    "best_climate_fit": ["climate_fit"],
    "soil_building": ["organic_matter", "nutrient_cycling"],
    "water_saving": ["water_use"],
    "erosion_control": ["erosion"],
    "forage": ["forage"],
    "market": ["market"],
}
MIN_SUITABILITY = 40       # a crop scoring below this for its year is not offered in generated scenarios
CLIMATE_SHARE = 0.3        # weight of climate fit when searching the best rotation for a goal
ERODIBILITY = {"silt": 1.3, "silt loam": 1.25, "silty clay loam": 1.2, "loam": 1.0, "clay loam": 1.0,
               "sandy loam": 0.9, "sandy clay loam": 0.9, "silty clay": 1.0, "loamy sand": 0.8, "sand": 0.8,
               "sandy clay": 0.8, "clay": 0.8}
EROSION_RISK_AT_ZERO_SCORE = 0.5


def _clip(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return float(min(high, max(low, value)))


def parse_weights(text: Optional[str]) -> Dict[str, float]:
    """'erosion=2,water_use=0.5' → weights for all dimensions (default 1). Raises ValueError on bad input."""
    weights = {name: 1.0 for name in DIMENSIONS}
    for part in (text or "").split(","):
        if not part.strip():
            continue
        name, _, value = part.partition("=")
        name = name.strip()
        if name not in DIMENSIONS:
            raise ValueError(f"Unknown dimension {name!r}. Known: {', '.join(DIMENSIONS)}")
        try:
            weights[name] = float(value)
        except ValueError:
            raise ValueError(f"Weight for {name} is not a number: {value!r}")
        if weights[name] < 0:
            raise ValueError(f"Weight for {name} must not be negative")
    if not sum(weights.values()):
        raise ValueError("At least one weight must be above 0")
    return weights


def site_erosion_factor(texture: Optional[str], annual_rain_mm: float) -> float:
    """Rainfall erosivity (relative to 750 mm) × erodibility of the soil texture."""
    return float(np.clip(annual_rain_mm / 750, 0.6, 1.6)) * ERODIBILITY.get(texture or "", 1.0)


def evaluate(crops: List[str], year_results: List[Dict], history: List[str], site_factor: float) -> Dict:
    """Scores (0–100, higher is better) and the figures behind them for one rotation.

    `year_results`: one {crop: crop_score result} per rotation year, as from rotation.yearly_crop_scores.
    """
    n = len(crops)
    previous = [*history, *crops]
    offset = len(history)

    fit, fertiliser, credits, violations, unsafe, water = [], [], 0, [], [], []
    for i, crop in enumerate(crops):
        before = previous[:offset + i]
        result = year_results[i][crop]
        if result.get("excluded"):  # pollution: no climate score and no water figures for this crop-year
            fit.append(0.0)
            unsafe.append(f"{crop} in year {i + 1}: {result['excluded']}")
        else:
            bonus, _ = _rotation_effect(crop, before)
            fit.append(_clip(result["score"] + bonus))
            water.append((result["water_demand_mm"], result["water_shortfall_mm"]))
        credit = TRAITS[before[-1]]["n_credit"] if before else 0
        fertiliser.append(max(0, TRAITS[crop]["n_need"] - credit))
        credits += min(credit, TRAITS[crop]["n_need"])
        if (why := rotation_block(crop, before)):
            violations.append(f"{crop} in year {i + 1}: {why}")

    humus = float(np.mean([TRAITS[c]["humus"] for c in crops]))
    cover = float(np.mean([TRAITS[c]["cover"] for c in crops]))
    risk = cover * site_factor
    demand, shortfall = (float(np.mean(v)) for v in zip(*water)) if water else (0.0, 0.0)
    feed = float(np.mean([TRAITS[c]["feed"] for c in crops]))
    families = [CROPS[c]["family"] for c in crops]
    cereal_share = families.count("cereal") / n
    market_level = float(np.mean([TRAITS[c]["margin"] - 30 * TRAITS[c]["risk"] for c in crops]))

    scores = {
        "climate_fit": float(np.mean(fit)),
        "nutrient_cycling": _clip(100 - np.mean(fertiliser) / 2),
        "organic_matter": _clip(75 + min(25.0, humus / 16) if humus >= 0 else 75 + humus / 8),
        "erosion": _clip(100 - 100 * risk / EROSION_RISK_AT_ZERO_SCORE),
        "pest_cycle": _clip(100 * len(set(families)) / n - 35 * len(violations) - (15 if cereal_share > 0.5 else 0)),
        "water_use": _clip(100 - shortfall / 2.5),
        "forage": _clip(feed),
        "market": _clip(market_level + 5 * (len(set(crops)) - 1)),
    }
    return {
        "scores": {k: round(v) for k, v in scores.items()},
        "metrics": {
            "mineral_n_to_buy_kg_per_ha_year": round(float(np.mean(fertiliser))),
            "n_credit_reused_kg_per_ha": int(credits),
            "humus_balance_kg_c_per_ha_year": round(humus),
            "erosion_risk_index": round(risk, 2),
            "water_demand_mm_per_year": round(demand),
            "water_shortfall_mm_per_year": round(shortfall),
            "feed_value": round(feed),
            "indicative_margin_index": round(float(np.mean([TRAITS[c]["margin"] for c in crops]))),
            "crop_families": families,
        },
        "rule_violations": violations,
        "excluded_for_pollution": unsafe,
        "_raw": scores,
    }


def composite(scores: Dict[str, float], weights: Dict[str, float]) -> float:
    return sum(scores[d] * w for d, w in weights.items()) / sum(weights.values())


def _sequences(candidates: List[List[str]], history: List[str]) -> Iterator[List[str]]:
    """All crop sequences (one crop per year) that keep the rotation rules, depth first with pruning."""
    def extend(done: List[str]) -> Iterator[List[str]]:
        if len(done) == len(candidates):
            yield done
            return
        for crop in candidates[len(done)]:
            if not rotation_block(crop, [*history, *done]):
                yield from extend([*done, crop])
    yield from extend([])


def _strengths(scores: Dict[str, int]) -> str:
    ranked = sorted(scores, key=scores.get, reverse=True)
    best, worst = ranked[:2], ranked[-1]
    return ("Strong: " + ", ".join(f"{d.replace('_', ' ')} {scores[d]}" for d in best)
            + f". Weak: {worst.replace('_', ' ')} {scores[worst]}.")


def compare(year_scores: List[Tuple[int, Dict]], plan: List[Dict], history: List[str], texture: Optional[str],
            annual_rain_mm: float, weights: Dict[str, float], custom: Optional[List[List[str]]] = None) -> Dict:
    """Score the /rotation plan, the best rotation per goal and any custom rotations side by side."""
    years = [year for year, _ in year_scores]
    results = [r for _, r in year_scores]
    factor = site_erosion_factor(texture, annual_rain_mm)
    if not years:
        return {"years": [], "scenarios": [], "notes": ["The forecast covers no full growing season."]}

    candidates = [[c for c in CROPS if not r[c].get("excluded") and r[c]["score"] >= MIN_SUITABILITY] for r in results]
    found: Dict[Tuple[str, ...], Dict] = {}

    def add(crops: List[str], label: str):
        key = tuple(crops)
        if key not in found:
            found[key] = {"crops": list(crops), "labels": [], **evaluate(list(crops), results, history, factor)}
        found[key]["labels"].append(label)

    recommended = [y["crop"] for y in plan[:len(years)]]
    if len(recommended) == len(years) and all(recommended):
        add(recommended, "recommended_plan")

    sequences = list(_sequences(candidates, history))
    evaluated = [(seq, evaluate(seq, results, history, factor)) for seq in sequences]
    for label, focus in GOALS.items():
        if evaluated:
            def goal_score(item, focus=focus):
                raw = item[1]["_raw"]
                return (1 - CLIMATE_SHARE) * np.mean([raw[d] for d in focus]) + CLIMATE_SHARE * raw["climate_fit"]
            add(max(evaluated, key=goal_score)[0], label)
    if evaluated:
        add(max(evaluated, key=lambda item: composite(item[1]["_raw"], weights))[0], "balanced")
    for i, crops in enumerate(custom or [], start=1):
        add(crops, f"custom_{i}")

    scenarios = []
    for entry in found.values():
        entry["composite"] = round(composite(entry.pop("_raw"), weights))
        scenarios.append(entry)
    scenarios.sort(key=lambda s: s["composite"], reverse=True)

    reference = found.get(tuple(recommended)) if recommended else None
    for s in scenarios:
        s["rotation"] = [{"year": y, "crop": c} for y, c in zip(years, s.pop("crops"))]
        s["best_at"] = [d for d in DIMENSIONS if s["scores"][d] == max(o["scores"][d] for o in scenarios)]
        s["summary"] = _strengths(s["scores"])
        if reference is not None and s is not reference:
            s["vs_recommended_plan"] = {d: s["scores"][d] - reference["scores"][d] for d in DIMENSIONS}
    return {
        "years": years,
        "weights": weights,
        "dimensions": DIMENSIONS,
        "scenarios": scenarios,
        "notes": [
            "Scores are 0–100, higher is better. Generated scenarios only use crops scoring ≥ "
            f"{MIN_SUITABILITY} for the forecast and keep the rotation rules.",
            "Crop traits (humus, N, cover, feed, margin) are rule-of-thumb values for temperate Europe, and the "
            "market score is a relative margin level, not live prices.",
        ],
    }
