"""Seasonal risk: probabilities of dry, wet, drought, hot and frost seasons, and irrigation need.

Rain and extremes can't be forecast as single numbers years ahead, but their odds can be estimated:

1. Take the observed daily weather of every season in 1991–2020 (30 plausible "weather patterns").
2. Shift each one by the forecast for that season: temperatures by forecast − normal,
   rain / ET0 / radiation by forecast ÷ normal (as in the delta method of the climate projection).
3. Recompute the indicators for each shifted year → 30 possible outcomes for the coming season.
4. Probability of an event = share of outcomes beyond a threshold set from 1991–2020 (e.g. the
   driest 20 % of seasons), compared with the normal odds and with what actually happened recently.

With soil information (see soil.py), each outcome also runs through the FAO-56 soil water balance:
days of water stress for a rain-fed crop and the irrigation need, both accounting for the water the
soil stores. Each season starts from the soil moisture that year actually had at that date – and the
season right after the last observation starts from today's soil moisture, so a dry soil now
carries into the forecast.
"""
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from .features import to_monthly
from .soil import DEFAULT_DEPLETION_FRACTION, water_balance

SEASONS = {"Dec–Feb": (12, 1, 2), "Mar–May": (3, 4, 5), "Jun–Aug": (6, 7, 8), "Sep–Nov": (9, 10, 11)}
BASE_YEARS = (1991, 2020)
RECENT_YEARS = 15
SHIFT_ADDITIVE = ("tmax", "tmin", "tmean")
SHIFT_RATIO = ("precip", "et0", "radiation")
RATIO_LIMITS = (0.5, 2.0)
LOW_Q, HIGH_Q = 0.2, 0.8  # "1 in 5" seasons

EVENTS = {
    # name: (variable, side, description)
    "dry": ("precip", "low", "Rain among the driest 20 % of 1991–2020 seasons"),
    "wet": ("precip", "high", "Rain among the wettest 20 % of 1991–2020 seasons"),
    "drought": ("water_balance", "low", "Rain − ET0 among the lowest 20 % (drought stress)"),
    "hot": ("heat_days", "high", "Heat days (Tmax ≥ 30 °C) among the highest 20 %"),
    "frost": ("frost_days", "high", "Frost days among the highest 20 %"),
}


def _season_year(idx: pd.DatetimeIndex, months) -> np.ndarray:
    # December belongs to the following year's Dec–Feb season
    return idx.year + ((idx.month == 12) & (1 in months)).astype(int)


def _season_totals(monthly: pd.DataFrame, months) -> pd.DataFrame:
    sel = monthly[monthly.index.month.isin(months)].copy()
    sel["deficit"] = (sel["et0"] - sel["precip"]).clip(lower=0)
    sel["season_year"] = _season_year(sel.index, months)
    cols = ["precip", "water_balance", "heat_days", "frost_days", "deficit"]
    grouped = sel.groupby("season_year")
    totals = grouped[cols].sum()
    return totals[grouped.size() == len(months)]


def _threshold(normal: pd.Series, side: str):
    """Returns (threshold, rule).

    Day counts saturate: with '≥ 1 day' when the 80th percentile is 0 days, and '≥ maximum' when it
    already equals the most that ever happened (e.g. a rain-fed crop in a semi-arid climate is stressed
    nearly every day) – otherwise the event could never occur and would always show 0 %.
    """
    q = float(normal.quantile(LOW_Q if side == "low" else HIGH_Q))
    if side == "low":
        return q, "<="
    if q <= 0:
        return 1.0, ">="
    if q >= float(normal.max()):
        return q, ">="
    return q, ">"


def event_occurred(values, threshold: float, rule: str):
    values = np.asarray(values, dtype=float)
    return {"<=": values <= threshold, ">=": values >= threshold, ">": values > threshold}[rule]


def _season_start(season_year: int, months) -> pd.Timestamp:
    return pd.Timestamp(season_year - 1 if months[0] == 12 else season_year, months[0], 1)


def _soil_seasons(days: pd.DataFrame, months, start_depletion: Callable[[int], float], soil: Dict) -> pd.DataFrame:
    """Per season-year: stress days (rain-fed) and irrigation need (mm) from the soil water balance."""
    rows = {}
    for year, block in days.groupby(_season_year(days.index, months)):
        if block.index.month.nunique() < len(months):
            continue
        rain, et0 = block["precip"].fillna(0).values, block["et0"].fillna(0).values
        args = dict(taw=soil["taw_mm"], p=soil.get("p", DEFAULT_DEPLETION_FRACTION), kc=soil.get("kc", 1.0),
                    initial_depletion=start_depletion(year))
        rows[year] = {"stress_days": float(water_balance(rain, et0, **args)["stressed"].sum()),
                      "irrigation_mm": float(water_balance(rain, et0, irrigate=True, **args)["irrigation"].sum())}
    return pd.DataFrame.from_dict(rows, orient="index")


def seasonal_risk(daily: pd.DataFrame, forecasts: Dict[str, List[Dict]], soil: Optional[Dict] = None) -> List[Dict]:
    """`forecasts`: variable -> list of {"month": "YYYY-MM", "forecast": value} (the /forecast rows).

    `soil`: {"taw_mm": total available water, "kc": crop coefficient, "p": depletion fraction} to add
    soil water stress and irrigation need; without it only climate-based indicators are returned.
    """
    monthly = to_monthly(daily)
    in_base = (monthly.index.year >= BASE_YEARS[0]) & (monthly.index.year <= BASE_YEARS[1])
    normals = monthly[in_base].groupby(monthly[in_base].index.month).mean()
    base_daily = daily[(daily.index >= f"{BASE_YEARS[0] - 1}-12-01") & (daily.index <= f"{BASE_YEARS[1]}-12-31")]

    fc = pd.DataFrame({var: {pd.Timestamp(r["month"]): r["forecast"] for r in rows}
                       for var, rows in forecasts.items()})
    last_observed_year = monthly.index[-1].year
    next_month = monthly.index[-1] + pd.offsets.MonthBegin(1)

    if soil:
        observed = water_balance(daily["precip"].fillna(0).values, daily["et0"].fillna(0).values, soil["taw_mm"],
                                 p=soil.get("p", DEFAULT_DEPLETION_FRACTION), kc=soil.get("kc", 1.0))["depletion"]
        observed = pd.Series(observed, index=daily.index)
        current_depletion = float(observed.iloc[-1])

    out = []
    for name, months in SEASONS.items():
        normal_totals = _season_totals(monthly, months)
        base_totals = normal_totals.loc[BASE_YEARS[0]:BASE_YEARS[1]]
        recent = normal_totals.loc[last_observed_year - RECENT_YEARS:last_observed_year]
        if soil:
            def historical_start(year, months=months):
                day = _season_start(year, months) - pd.Timedelta(days=1)
                return float(observed.get(day, 0.0))

            season_days = daily[daily.index.month.isin(months)]
            soil_all = _soil_seasons(season_days, months, historical_start, soil)
            soil_base = soil_all.loc[BASE_YEARS[0]:BASE_YEARS[1]]
            soil_recent = soil_all.loc[last_observed_year - RECENT_YEARS:last_observed_year]

        for season_year in sorted(set(_season_year(fc.index, months)[fc.index.month.isin(months)])):
            target = [pd.Timestamp(season_year - (m == 12 and 1 in months), m, 1) for m in months]
            if not all(t in fc.index for t in target):
                continue  # season not fully inside the forecast
            shifted = base_daily[base_daily.index.month.isin(months)].copy()
            for t in target:
                mask = shifted.index.month == t.month
                for var in SHIFT_ADDITIVE:
                    if var in fc and var in shifted:
                        shifted.loc[mask, var] += fc.at[t, var] - normals.at[t.month, var]
                for var in SHIFT_RATIO:
                    if var in fc and var in shifted and normals.at[t.month, var] > 0:
                        ratio = np.clip(fc.at[t, var] / normals.at[t.month, var], *RATIO_LIMITS)
                        shifted.loc[mask, var] *= ratio
            outcomes = _season_totals(to_monthly(shifted), months).loc[BASE_YEARS[0]:BASE_YEARS[1]]
            if soil:
                # First season after the last observation (up to 2 months gap): start from today's soil
                # moisture, carried through the gap months with each historical year's weather
                gap = pd.date_range(next_month, target[0] - pd.offsets.MonthBegin(1), freq="MS")
                starts_now = target[0] >= next_month and len(gap) <= 2

                def start_from_today(year, gap=gap, months=months, target=target):
                    d = current_depletion
                    for i, _ in enumerate(gap):
                        month = _season_start(year, months) - pd.DateOffset(months=len(gap) - i)
                        block = daily[month:month + pd.offsets.MonthEnd(0)]
                        if len(block):
                            d = float(water_balance(block["precip"].fillna(0).values, block["et0"].fillna(0).values,
                                                    soil["taw_mm"], p=soil.get("p", DEFAULT_DEPLETION_FRACTION),
                                                    kc=soil.get("kc", 1.0), initial_depletion=d)["depletion"][-1])
                    return d

                start = start_from_today if starts_now else historical_start
                soil_outcomes = _soil_seasons(shifted, months, start, soil).loc[BASE_YEARS[0]:BASE_YEARS[1]]

            events = {}
            for event, (var, side, description) in EVENTS.items():
                if base_totals[var].max() <= 0 and side == "high":
                    continue  # e.g. no frost ever in this season here
                threshold, rule = _threshold(base_totals[var], side)
                events[event] = {
                    "probability": round(float(event_occurred(outcomes[var], threshold, rule).mean()), 2),
                    "normal_probability": round(float(event_occurred(base_totals[var], threshold, rule).mean()), 2),
                    f"observed_last_{RECENT_YEARS}_years": round(float(event_occurred(recent[var], threshold, rule).mean()), 2),
                    "threshold": round(threshold, 1),
                    "rule": f"{var} {rule} {threshold:.1f}",
                    "variable": var,
                    "description": description,
                }
            soil_water = None
            if soil and not soil_base.empty:
                if soil_base["stress_days"].max() > 0:
                    threshold, rule = _threshold(soil_base["stress_days"], "high")
                    events["water_stress"] = {
                        "probability": round(float(event_occurred(soil_outcomes["stress_days"], threshold, rule).mean()), 2),
                        "normal_probability": round(float(event_occurred(soil_base["stress_days"], threshold, rule).mean()), 2),
                        f"observed_last_{RECENT_YEARS}_years": round(float(event_occurred(soil_recent["stress_days"], threshold, rule).mean()), 2),
                        "threshold": round(threshold, 1),
                        "rule": f"stress_days {rule} {threshold:.1f}",
                        "variable": "stress_days",
                        "description": "Days with soil water stress (rain-fed, this soil) among the highest 20 %",
                    }
                stress, irrigation = soil_outcomes["stress_days"], soil_outcomes["irrigation_mm"]
                soil_water = {
                    "note": "Kc is applied to every season – read the seasons your crop is actually in the field",
                    "start_condition": ("today's soil moisture" + (f", carried through {len(gap)} month(s) of weather"
                                                                    if len(gap) else "")) if starts_now
                                       else "soil moisture of each historical year",
                    "stress_days": {"typical": round(float(stress.median()), 0),
                                    "dry_year_1_in_5": round(float(stress.quantile(0.8)), 0),
                                    "normal_typical": round(float(soil_base["stress_days"].median()), 0)},
                    "irrigation_need_mm": {"typical": round(float(irrigation.median()), 0),
                                           "dry_year_1_in_5": round(float(irrigation.quantile(0.8)), 0),
                                           "extreme_1_in_10": round(float(irrigation.quantile(0.9)), 0),
                                           "normal_typical": round(float(soil_base["irrigation_mm"].median()), 0)},
                }
            deficit = outcomes["deficit"]
            out.append({
                "season": f"{name} {season_year}",
                "season_name": name,
                "season_year": int(season_year),
                "months": [f"{t:%Y-%m}" for t in target],
                "events": events,
                "water_deficit_mm": {
                    "typical": round(float(deficit.median()), 0),
                    "dry_year_1_in_5": round(float(deficit.quantile(0.8)), 0),
                    "extreme_1_in_10": round(float(deficit.quantile(0.9)), 0),
                    "normal_typical": round(float(base_totals["deficit"].median()), 0),
                    "note": "Σ max(0, ET0 − rain) per month, ignoring soil storage – see soil_water for the soil-aware need",
                },
                "soil_water": soil_water,
            })
    return sorted(out, key=lambda s: s["months"][0])
