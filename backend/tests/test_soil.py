import numpy as np
import pandas as pd
import pytest

from app import main, soil
from app.risk import seasonal_risk
from app.soil import historical_water_stats, saxton_rawls, soil_profile, usda_texture, water_balance


@pytest.mark.parametrize("sand,silt,clay,expected", [
    (90, 5, 5, "sand"), (40, 40, 20, "loam"), (20, 65, 15, "silt loam"), (10, 30, 60, "clay"),
    (60, 25, 15, "sandy loam"), (30, 35, 35, "clay loam"), (5, 50, 45, "silty clay"),
])
def test_usda_texture(sand, silt, clay, expected):
    assert usda_texture(sand, silt, clay) == expected


def test_saxton_rawls_loam():
    fc, wp = saxton_rawls(40, 20, 2.5)  # published loam ≈ 0.28 / 0.14
    assert 0.26 < fc < 0.30 and 0.12 < wp < 0.15


def test_water_balance_stress_and_irrigation():
    dry = water_balance(np.zeros(60), np.full(60, 4.0), taw=100, p=0.5)
    assert dry["depletion"][10] == pytest.approx(44.0)
    assert not dry["stressed"][11] and dry["stressed"][13]          # RAW = 50 mm reached on day 13
    assert dry["depletion"].max() < 100                             # ET slows down, bucket never fully empty
    irrigated = water_balance(np.zeros(60), np.full(60, 4.0), taw=100, p=0.5, irrigate=True)
    assert not irrigated["stressed"].any()
    assert irrigated["irrigation"].sum() == pytest.approx(52 * 4, abs=4)  # ≈ all ET except the last partial refill
    wet = water_balance(np.full(30, 10.0), np.full(30, 4.0), taw=100, initial_depletion=80)
    assert wet["depletion"][-1] == 0                                # rain refills, excess drains


def _fake_soil(fc=30.0, wp=15.0):
    layers = {d: {"top_cm": t, "bottom_cm": b, "clay": 20.0, "sand": 40.0, "silt": 40.0, "soc": 12.0, "phh2o": 6.5,
                  "bdod": 1.4, "cec": 15.0, "cfvo": 0.0, "nitrogen": 1.0, "wv0033": fc, "wv1500": wp}
              for d, t, b in soil.DEPTHS}
    return {"source": "test", "search_radius_km": 1.1, "pixels": 50, "units": {}, "layers": layers}


def test_profile_available_water():
    profile = soil_profile(_fake_soil(), root_depth_cm=100)
    assert profile["total_available_water_mm"] == pytest.approx(150)  # (0.30 − 0.15) × 1000 mm
    assert profile["texture_class"] == "loam"
    assert soil_profile(_fake_soil(), root_depth_cm=30)["total_available_water_mm"] == pytest.approx(45)
    missing = _fake_soil(); [l.update(wv0033=None, wv1500=None) for l in missing["layers"].values()]
    assert soil_profile(missing)["layers"][0]["retention_from"] == "Saxton & Rawls"


def test_risk_with_soil(daily):
    monthly = daily.resample("MS").mean()
    months = pd.date_range("2026-01-01", periods=12, freq="MS")
    forecasts = {"precip": [{"month": f"{m:%Y-%m}", "forecast": 30.0} for m in months]}
    seasons = seasonal_risk(daily, forecasts, {"taw_mm": 120, "kc": 1.0})
    assert seasons[0]["soil_water"]["start_condition"].startswith("today's soil moisture")
    assert all(s["soil_water"]["irrigation_need_mm"]["typical"] >= 0 for s in seasons)
    assert "water_stress" in seasons[2]["events"]
    stats = historical_water_stats(daily, 120)
    assert 0 <= stats["current_plant_available_water_%"] <= 100


def test_soil_endpoint(client, monkeypatch):
    monkeypatch.setattr(main, "fetch_soil", lambda lat, lon: _fake_soil())
    main._soil.cache_clear()
    d = client.get("/soil", params={"lat": 1, "lon": 2, "root_depth_cm": 50}).json()
    assert d["profile"]["total_available_water_mm"] == pytest.approx(75)
    risk = client.get("/risk", params={"lat": 1, "lon": 2, "years": 1, "kc": 1.15}).json()
    assert risk["soil"]["kc"] == 1.15 and risk["seasons"][0]["soil_water"] is not None
    main._soil.cache_clear()
