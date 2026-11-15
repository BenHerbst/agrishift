"""Backtest-weighted ensemble: monthly forecasts 1–36 months ahead with an 80 % range.

How the members are combined:
  * Rolling-origin backtest: 24 forecast origins 5 months apart (so they cover every season), each
    forecasting 36 months, using only data before the origin.
  * Weights per lead-time bucket (1–6, 7–12, 13–36 months) by constrained least squares
    (weights ≥ 0, sum to 1), averaged over 30 bootstrap resamples of the origins so they don't
    flip between similar members. ENSO can matter at 3 months and not at 30.
  * Reported skill is out-of-sample: the weights scored on each origin are fitted on the others.
  * 80 % range: each calendar month's year-to-year spread, scaled so that 80 % of the out-of-sample
    errors fall inside it (conformal finite-sample correction). If the recent half of the origins
    had larger errors (e.g. faster warming), the range is set from them instead.

Beyond a few weeks day-to-day weather is chaotic. These are expected monthly conditions and their
spread, and the backtest shows where they beat plain climatology.
"""
import logging
import warnings
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from scipy.optimize import minimize

from .features import DAY_COUNT_VARIABLES, MONTHLY_VARIABLES, NON_NEGATIVE_VARIABLES, to_monthly
from .members import (
    MAX_HORIZON_MONTHS, PROPHET_AVAILABLE, BoostedAnomaly, ClimateDrivers, Climatology, HoltWinters,
    ProphetForecaster, RecentClimatology, RecentTrend, TrendClimatology,
)
from .projections import anchor_projection, cmip_trends, projection_forecast, seasonal_forecast_member

N_ORIGINS = 24
# Not a multiple of 12, so origins fall in different seasons and lead time isn't confounded with season
ORIGIN_STEP_MONTHS = 5
N_BOOT = 30          # bootstrap resamples of origins for the final stacking weights
N_BOOT_NESTED = 10   # … and inside the leave-one-origin-out evaluation
HORIZON_BUCKETS = [(1, 6), (7, 12), (13, 36)]
INTERVAL_COVERAGE = 0.8


def _bucket(h: int) -> str:
    for lo, hi in HORIZON_BUCKETS:
        if lo <= h <= hi:
            return f"{lo}-{hi}"
    raise ValueError(h)


def _months_after(origin: pd.Timestamp, n: int = MAX_HORIZON_MONTHS) -> pd.DatetimeIndex:
    return pd.date_range(origin + pd.offsets.MonthBegin(1), periods=n, freq="MS", name="month")


def _clip(values: np.ndarray, variable: str, idx: pd.DatetimeIndex) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    if variable in DAY_COUNT_VARIABLES:
        return np.clip(values, 0, idx.days_in_month.values)
    if variable == "humidity":
        return np.clip(values, 0, 100)
    if variable in NON_NEGATIVE_VARIABLES:
        return np.clip(values, 0, None)
    return values


def _simplex_weights(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Least-squares weights constrained to w ≥ 0 and Σw = 1."""
    k = P.shape[1]
    scale = y.std() or 1.0
    P, y = P / scale, y / scale

    def loss(w):
        r = P @ w - y
        return r @ r / len(y)

    res = minimize(loss, np.full(k, 1 / k), method="SLSQP", bounds=[(0, 1)] * k,
                   constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1}])
    w = np.clip(res.x, 0, None) if res.success else np.full(k, 1 / k)
    return w / w.sum()


def _bagged_weights(P: np.ndarray, y: np.ndarray, groups: np.ndarray, n_boot: int, seed: int = 0) -> np.ndarray:
    """Average simplex weights over bootstrap resamples of whole forecast origins.

    A single fit on few origins tends to give one member 100 % and flip between similar members;
    bagging keeps a stable share for every member that is consistently useful.
    """
    unique = np.unique(groups)
    if len(unique) < 3 or n_boot <= 1:
        return _simplex_weights(P, y)
    rng = np.random.default_rng(seed)
    rows = {g: np.flatnonzero(groups == g) for g in unique}
    total = np.zeros(P.shape[1])
    for _ in range(n_boot):
        pick = np.concatenate([rows[g] for g in rng.choice(unique, size=len(unique), replace=True)])
        total += _simplex_weights(P[pick], y[pick])
    return total / n_boot


def _conformal_quantile(values: np.ndarray, coverage: float) -> float:
    values = values[np.isfinite(values)]
    n = len(values)
    if n == 0:
        return float("nan")
    level = min(1.0, np.ceil((n + 1) * coverage) / n)  # finite-sample correction
    return float(np.quantile(values, level))


def _origin_groups(frame: pd.DataFrame) -> np.ndarray:
    return frame["origin"].values.astype("datetime64[ns]").astype(np.int64)


def _member_predictions(y_train: pd.Series, idx: pd.DatetimeIndex, indices: pd.DataFrame,
                        extra: Dict[str, Optional[pd.Series]], opts: Dict) -> Dict[str, np.ndarray]:
    members = [Climatology(), TrendClimatology(), HoltWinters(), BoostedAnomaly(), ClimateDrivers(indices)]
    if opts["recent_climatology"]:
        members.append(RecentClimatology())
    if opts["recent_trend"]:
        members.append(RecentTrend())
    if opts["use_prophet"] and PROPHET_AVAILABLE:
        members.append(ProphetForecaster())

    preds = {}
    for member in members:
        try:
            preds[member.name] = np.asarray(member.fit(y_train).predict(idx), dtype=float)
        except Exception as exc:  # one failing member must not take down the forecast
            warnings.warn(f"{member.name} failed: {exc}")
    # Precomputed members (CMIP6 projection, anchored projection, SEAS5). SEAS5 is NaN beyond lead
    # month 6 – each lead bucket only uses members that cover all of its months.
    for name, series in extra.items():
        if series is not None and series.notna().any():
            preds[name] = series.reindex(idx).values.astype(float)
    return preds


def _forecast_variable(y: pd.Series, variable: str, indices: pd.DataFrame, precomputed: Dict[str, Dict],
                       origins: List[pd.Timestamp], future: pd.DatetimeIndex, opts: Dict) -> Dict:
    warnings.filterwarnings("ignore")
    if opts["use_prophet"]:
        logging.getLogger("cmdstanpy").disabled = True  # worker processes start with default logging
    y = y.dropna()

    def extras(key):
        return {name: frames[key][variable] if key in frames and variable in frames[key] else None
                for name, frames in precomputed.items()}

    # 1. Rolling-origin backtest
    frames = []
    for origin in origins:
        idx = _months_after(origin)
        f = pd.DataFrame(_member_predictions(y[:origin], idx, indices, extras(origin), opts), index=idx)
        f["actual"] = y.reindex(idx).values
        f["h"] = np.arange(1, MAX_HORIZON_MONTHS + 1)
        f["origin"] = origin
        frames.append(f)
    bt = pd.concat(frames)
    all_members = [c for c in bt.columns if c not in ("actual", "h", "origin")]
    bt = bt.dropna(subset=["actual"]).reset_index()
    for m in all_members:
        bt[m] = _clip(bt[m].values, variable, pd.DatetimeIndex(bt["month"]))
    bt["bucket"] = bt["h"].map(_bucket)

    # 2. Weights per lead-time bucket, out-of-sample ensemble (leave one origin out), 80 % range.
    #    Each bucket only uses members available for all of its months (SEAS5 only covers 1–6).
    weights, multipliers, bucket_members = {}, {}, {}
    trend = TrendClimatology().fit(y)
    bt["spread"] = trend.resid_std.reindex(pd.DatetimeIndex(bt["month"]).month).values
    recent_origins = sorted(origins)[len(origins) // 2:]
    for label, part in bt.groupby("bucket"):
        members = [m for m in all_members if part[m].notna().all()]
        bucket_members[label] = members
        weights[label] = _bagged_weights(part[members].values, part["actual"].values, _origin_groups(part),
                                         opts["n_boot"])
        for origin in origins:
            train_p, test_p = part[part["origin"] != origin], part[part["origin"] == origin]
            if test_p.empty or train_p.empty:
                continue
            w = _bagged_weights(train_p[members].values, train_p["actual"].values, _origin_groups(train_p),
                                min(opts["n_boot"], N_BOOT_NESTED))
            bt.loc[test_p.index, "ensemble"] = test_p[members].values @ w
        part = bt.loc[part.index]
        ratio = ((part["ensemble"] - part["actual"]).abs() / part["spread"].replace(0, np.nan)).values
        recent = part["origin"].isin(recent_origins).values
        q = [_conformal_quantile(ratio, INTERVAL_COVERAGE), _conformal_quantile(ratio[recent], INTERVAL_COVERAGE)]
        multipliers[label] = float(np.nanmax(q)) if np.isfinite(q).any() else 1.28

    def mae(frame, col):
        return float((frame[col] - frame["actual"]).abs().mean())

    def skill(frame):
        base = mae(frame, "climatology")
        return round(1 - mae(frame, "ensemble") / base, 3) if base > 0 else None

    backtest = {
        "method": f"rolling origin: {len(origins)} origins × {MAX_HORIZON_MONTHS} months, "
                  "ensemble scored out-of-sample (leave-one-origin-out)",
        "origins": [o.strftime("%Y-%m") for o in origins],
        "climatology_mae": round(mae(bt, "climatology"), 3),
        "member_mae": {m: round(mae(bt.dropna(subset=[m]), m), 3) for m in all_members},
        "ensemble_mae": round(mae(bt, "ensemble"), 3),
        "skill_vs_climatology": skill(bt),
        "skill_by_lead_months": {label: skill(part) for label, part in bt.groupby("bucket")},
        "weights_by_lead_months": {label: {m: round(float(w), 3) for m, w in zip(bucket_members[label], ws)}
                                   for label, ws in weights.items()},
    }

    # 3. Final forecast from the latest data
    final = _member_predictions(y, future, indices, extras("final"), opts)
    final = {m: _clip(final[m], variable, future) for m in all_members if m in final}
    point = np.zeros(len(future))
    half_width = np.zeros(len(future))
    spread = trend.resid_std.reindex(future.month).values
    for i in range(len(future)):
        label = _bucket(i + 1)
        w = {m: wt for m, wt in zip(bucket_members[label], weights[label])
             if m in final and np.isfinite(final[m][i])}
        total = sum(w.values()) or 1.0
        point[i] = sum(wt / total * final[m][i] for m, wt in w.items())
        half_width[i] = multipliers[label] * spread[i]
    point, lower, upper = (_clip(v, variable, future) for v in (point, point - half_width, point + half_width))

    rows = [{
        "month": month.strftime("%Y-%m"),
        "lead_months": i + 1,
        "forecast": round(float(point[i]), 2),
        "lower_80": round(float(lower[i]), 2),
        "upper_80": round(float(upper[i]), 2),
        "models": {m: round(float(v[i]), 2) for m, v in final.items() if np.isfinite(v[i])},
    } for i, month in enumerate(future)]
    return {"backtest": backtest, "forecast": rows}


def derive_water_balance(results: Dict[str, Dict]) -> None:
    """Make the water-balance forecast equal forecast rain − forecast ET0 (in place).

    The three variables are forecast separately, so their forecasts drift apart by ~20 mm a year and
    tables like /agri-summary would not add up. The 80 % range keeps its width and moves with the value.
    The backtest still describes the separately trained water-balance model.
    """
    if not all(v in results for v in ("precip", "et0", "water_balance")):
        return
    for wb, rain, et0 in zip(results["water_balance"]["forecast"], results["precip"]["forecast"],
                             results["et0"]["forecast"]):
        value = round(rain["forecast"] - et0["forecast"], 2)
        shift = value - wb["forecast"]
        wb.update(forecast=value, lower_80=round(wb["lower_80"] + shift, 2), upper_80=round(wb["upper_80"] + shift, 2))
    results["water_balance"]["note"] = "forecast = precipitation − ET0; the backtest is for the separately trained model"


def forecast_location(daily: pd.DataFrame, projections_monthly: Optional[pd.DataFrame],
                      indices: pd.DataFrame, variables: Optional[List[str]] = None, n_jobs: int = -1,
                      use_prophet: bool = False, seasonal: Optional[pd.DataFrame] = None,
                      recent_trend: bool = True, recent_climatology: bool = True,
                      anchored_projection: bool = True, n_origins: int = N_ORIGINS, n_boot: int = N_BOOT) -> Dict:
    """Forecast every variable for one location, MAX_HORIZON_MONTHS ahead.

    The keyword switches exist so hindcasts can measure what each component contributes.
    """
    monthly = to_monthly(daily)
    variables = variables or list(MONTHLY_VARIABLES)
    last = monthly.index[-1]
    origins = [last - pd.DateOffset(months=MAX_HORIZON_MONTHS + ORIGIN_STEP_MONTHS * k) for k in range(n_origins)]
    future = _months_after(last)
    keys = [*((o, o) for o in origins), ("final", last)]

    precomputed: Dict[str, Dict] = {}
    if projections_monthly is not None:
        trends = cmip_trends(projections_monthly)
        projection = {key: projection_forecast(daily, trends, origin, _months_after(origin)) for key, origin in keys}
        precomputed["climate_projection"] = projection
        if anchored_projection:
            precomputed["projection_anchored"] = {
                key: anchor_projection(monthly, daily, trends, origin, projection[key]) for key, origin in keys
            }

    # SEAS5 only enters if it exists for every backtest origin, so its weight is learned honestly
    if seasonal is not None:
        members = {key: seasonal_forecast_member(daily, seasonal, origin) for key, origin in keys}
        members = {k: v for k, v in members.items() if v is not None}
        if all(o in members for o in origins):
            precomputed["seasonal_forecast"] = members

    opts = {"use_prophet": use_prophet, "recent_trend": recent_trend,
            "recent_climatology": recent_climatology, "n_boot": n_boot}
    results = Parallel(n_jobs=n_jobs)(
        delayed(_forecast_variable)(monthly[v], v, indices, precomputed, origins, future, opts) for v in variables
    )
    by_variable = dict(zip(variables, results))
    derive_water_balance(by_variable)
    return {"trained_until": last.strftime("%Y-%m"), "variables": by_variable}
