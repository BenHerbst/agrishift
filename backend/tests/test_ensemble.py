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
