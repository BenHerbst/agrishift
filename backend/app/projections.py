"""Ensemble members built from outside forecasts: CMIP6 climate projections and ECMWF SEAS5.

All three use the delta method: take observed daily weather, shift it by the signal from the
outside model (temperatures additively, rain / ET0 / radiation as a ratio), then recompute every
agricultural indicator (GDD, frost days, …) from the shifted days. The outside models' own
biases therefore never reach the forecast.
"""
from typing import Dict, Optional

import numpy as np
import pandas as pd

from .features import DAY_COUNT_VARIABLES, to_monthly
from .members import NORMAL_YEARS
from .seasonal import CLIMATOLOGY_YEARS, seasonal_anomalies

MULTIPLICATIVE = {"precip", "et0", "radiation"}
MAX_RELATIVE_TREND = 0.03  # per year, guards against noisy ratios in very dry months

ANCHOR_MONTHS = 60
ANCHOR_RATIO_VARIABLES = MULTIPLICATIVE | DAY_COUNT_VARIABLES | {"gdd"}
ANCHOR_RATIO_LIMITS = (0.5, 2.0)


def cmip_trends(cmip: pd.DataFrame) -> Dict[str, np.ndarray]:
    """Projected change per year for each calendar month (array of 12), per variable.

    Fits month intercepts + a trend whose size varies smoothly through the year (1st harmonic),
    which is far more stable than 12 separate trends from 40 years of one climate run.
    Multiplicative variables get a relative trend (fraction per year).
    """
    idx = cmip.index
    t = idx.year + (idx.month - 0.5) / 12 - 2020
    angle = 2 * np.pi * (idx.month - 1) / 12
    X = np.column_stack([np.eye(12)[idx.month - 1], t, t * np.sin(angle), t * np.cos(angle)])
    month_angle = 2 * np.pi * np.arange(12) / 12
    trends = {}
    for var in cmip.columns:
        y = cmip[var].values
        ok = ~np.isnan(y)
        if ok.sum() < 120:
            continue
        coef, *_ = np.linalg.lstsq(X[ok], y[ok], rcond=None)
        slope = coef[12] + coef[13] * np.sin(month_angle) + coef[14] * np.cos(month_angle)
        if var in MULTIPLICATIVE:
            slope = np.clip(slope / np.maximum(coef[:12], 1e-6), -MAX_RELATIVE_TREND, MAX_RELATIVE_TREND)
        trends[var] = slope
    return trends


def projection_forecast(daily: pd.DataFrame, trends: Dict[str, np.ndarray],
                        origin: pd.Timestamp, idx: pd.DatetimeIndex) -> pd.DataFrame:
    """`climate_projection`: the last 30 observed years, shifted to each target year by the CMIP6 trend."""
    origin_end = origin + pd.offsets.MonthEnd(0)
    base = daily[(daily.index > origin_end - pd.DateOffset(years=NORMAL_YEARS)) & (daily.index <= origin_end)]
    base_center = float(np.mean(base.index.year + base.index.dayofyear / 365.25))
    month_pos = base.index.month.values - 1

    rows = {}
    for year in sorted(set(idx.year)):
        dt = year + 0.5 - base_center
        shifted = base.copy()
        for var, slope in trends.items():
            if var not in shifted:
                continue
            change = slope[month_pos] * dt
            if var in MULTIPLICATIVE:
                shifted[var] = shifted[var] * np.clip(1 + change, 0.5, 2.0)
            else:
                shifted[var] = shifted[var] + change
        monthly = to_monthly(shifted)
        clim = monthly.groupby(monthly.index.month).mean()
        for month in idx[idx.year == year]:
            rows[month] = clim.loc[month.month]
    return pd.DataFrame(rows).T


def anchor_projection(monthly: pd.DataFrame, daily: pd.DataFrame, trends: Dict[str, np.ndarray],
                      origin: pd.Timestamp, projection: pd.DataFrame) -> pd.DataFrame:
    """`projection_anchored`: the CMIP6 projection moved to the level observed in the last 5 years.

    The climate models miss the recent *level* in some regions (Western Europe has warmed about
    3× faster than CMIP6 HighResMIP simulates). For a 1–3 year horizon the level matters most, so:
    offset = observed − projected over the last 60 months (a ratio for rain, ET0, radiation,
    day counts and GDD), applied to the projection ahead.
    """
    recent = pd.date_range(origin - pd.DateOffset(months=ANCHOR_MONTHS - 1), origin, freq="MS")
    past = projection_forecast(daily, trends, origin, recent)
    observed = monthly.reindex(recent)
    out = projection.copy()
    for var in out.columns:
        if var not in observed or var not in past:
            continue
        ok = observed[var].notna() & past[var].notna()
        if ok.sum() < 24:
            continue
        if var in ANCHOR_RATIO_VARIABLES:
            total = past[var][ok].sum()
            if total > 0:
                out[var] = out[var] * np.clip(observed[var][ok].sum() / total, *ANCHOR_RATIO_LIMITS)
        else:
            out[var] = out[var] + (observed[var][ok] - past[var][ok]).mean()
    return out


def seasonal_forecast_member(daily: pd.DataFrame, seasonal: pd.DataFrame,
                             origin: pd.Timestamp) -> Optional[pd.DataFrame]:
    """`seasonal_forecast`: months 1–6 after `origin` from the SEAS5 forecast started right after it.

    Observed 1993–2016 weather for the target calendar month is shifted by SEAS5's anomaly against
    its own 1993–2016 climate, so SEAS5's systematic biases cancel out.
    """
    start = origin + pd.offsets.MonthBegin(1)
    anomalies = seasonal_anomalies(seasonal, start)
    if anomalies is None:
        return None
    years = daily.index.year
    base = daily[(years >= CLIMATOLOGY_YEARS[0]) & (years <= CLIMATOLOGY_YEARS[1])]
    rows = {}
    for lead, signal in anomalies.iterrows():
        month = start + pd.DateOffset(months=int(lead) - 1)
        shifted = base[base.index.month == month.month].copy()
        for var, value in signal.items():
            if var not in shifted or pd.isna(value):
                continue
            if var in MULTIPLICATIVE:
                shifted[var] = shifted[var] * value
            else:
                shifted[var] = shifted[var] + value
        rows[month] = to_monthly(shifted).mean()
    return pd.DataFrame(rows).T
