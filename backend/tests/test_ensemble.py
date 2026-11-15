import json

import numpy as np

from app.ensemble import _bagged_weights, _conformal_quantile, _simplex_weights, forecast_location


def test_simplex_weights_pick_the_right_member():
    rng = np.random.default_rng(0)
    y = rng.normal(size=200)
    P = np.column_stack([y + rng.normal(0, 0.1, 200), rng.normal(size=200), np.zeros(200)])
    w = _simplex_weights(P, y)
    assert abs(w.sum() - 1) < 1e-9 and (w >= 0).all() and w[0] > 0.8
    wb = _bagged_weights(P, y, np.repeat(np.arange(10), 20), n_boot=5)
    assert abs(wb.sum() - 1) < 1e-9 and wb[0] > 0.8


def test_conformal_quantile_is_conservative():
    values = np.arange(1, 11, dtype=float)
    assert _conformal_quantile(values, 0.8) >= np.quantile(values, 0.8)


def test_forecast_location_end_to_end(daily):
    result = forecast_location(daily, None, __import__("pandas").DataFrame(), variables=["tmean", "precip"],
                               n_jobs=1, n_origins=4, n_boot=3)
    assert result["trained_until"] == "2025-12"
    tmean = result["variables"]["tmean"]
    rows = tmean["forecast"]
    assert len(rows) == 36 and rows[0]["month"] == "2026-01"
    assert all(r["lower_80"] <= r["forecast"] <= r["upper_80"] for r in rows)
    # Synthetic data warms 0.4 °C/decade, so the ensemble must forecast above the 30-year mean
    assert np.mean([r["forecast"] - r["models"]["climatology"] for r in rows]) > 0.2
    assert all(r["forecast"] >= 0 for r in result["variables"]["precip"]["forecast"])
    for ws in tmean["backtest"]["weights_by_lead_months"].values():
        assert abs(sum(ws.values()) - 1) < 0.01
    json.dumps(result)  # no NaN / numpy types leak into the API


def test_water_balance_is_rain_minus_et0():
    from app.ensemble import derive_water_balance
    row = lambda v, lo=None, hi=None: {"month": "2027-01", "forecast": v, "lower_80": lo, "upper_80": hi}
    results = {"precip": {"forecast": [row(70.0)]}, "et0": {"forecast": [row(20.0)]},
               "water_balance": {"forecast": [row(40.0, 30.0, 55.0)]}}
    derive_water_balance(results)
    wb = results["water_balance"]["forecast"][0]
    assert wb["forecast"] == 50.0 and (wb["lower_80"], wb["upper_80"]) == (40.0, 65.0)  # range keeps its width
    derive_water_balance({"precip": {"forecast": []}})  # missing variables: nothing to do
