"""Seasonal risk: probabilities of dry, wet, drought, hot and frost seasons, and irrigation need.

Rain and extremes can't be forecast as single numbers years ahead, but their odds can be estimated:

1. Take the observed daily weather of every season in 1991–2020 (30 plausible "weather patterns").
2. Shift each one by the forecast for that season: temperatures by forecast − normal,
   rain / ET0 / radiation by forecast ÷ normal (as in the delta method of the climate projection).
3. Recompute the indicators for each shifted year → 30 possible outcomes for the coming season.
4. Probability of an event = share of outcomes beyond a threshold set from 1991–2020 (e.g. the
   driest 20 % of seasons), compared with the normal odds and with what actually happened recently.
"""
from typing import Dict, List

import numpy as np
import pandas as pd

from .features import to_monthly

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
    """Returns (threshold, rule). Uses '≥ 1 day' when the 80th percentile is 0 days."""
    q = float(normal.quantile(LOW_Q if side == "low" else HIGH_Q))
    if side == "low":
        return q, "<="
    if q <= 0:
        return 1.0, ">="
    return q, ">"


def event_occurred(values, threshold: float, rule: str):
    values = np.asarray(values, dtype=float)
    return {"<=": values <= threshold, ">=": values >= threshold, ">": values > threshold}[rule]


def seasonal_risk(daily: pd.DataFrame, forecasts: Dict[str, List[Dict]]) -> List[Dict]:
    """`forecasts`: variable -> list of {"month": "YYYY-MM", "forecast": value} (the /forecast rows)."""
    monthly = to_monthly(daily)
    in_base = (monthly.index.year >= BASE_YEARS[0]) & (monthly.index.year <= BASE_YEARS[1])
    normals = monthly[in_base].groupby(monthly[in_base].index.month).mean()
    base_daily = daily[(daily.index >= f"{BASE_YEARS[0] - 1}-12-01") & (daily.index <= f"{BASE_YEARS[1]}-12-31")]

    fc = pd.DataFrame({var: {pd.Timestamp(r["month"]): r["forecast"] for r in rows}
                       for var, rows in forecasts.items()})
    last_observed_year = monthly.index[-1].year

    out = []
    for name, months in SEASONS.items():
        normal_totals = _season_totals(monthly, months)
        base_totals = normal_totals.loc[BASE_YEARS[0]:BASE_YEARS[1]]
        recent = normal_totals.loc[last_observed_year - RECENT_YEARS:last_observed_year]

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
                    "note": "Σ max(0, ET0 − rain) per month; multiply ET0 by your crop coefficient (Kc) for crop-specific need",
                },
            })
    return sorted(out, key=lambda s: s["months"][0])
