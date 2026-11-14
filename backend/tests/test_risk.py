import pandas as pd

from app.features import to_monthly
from app.risk import seasonal_risk


def _forecast_rows(monthly, months, shift=0.0):
    normals = monthly["1991":"2020"].groupby(monthly["1991":"2020"].index.month).mean()
    return {var: [{"month": f"{m:%Y-%m}", "forecast": float(normals.at[m.month, var]) + (shift if var.startswith("t") else 0)}
                  for m in months] for var in ["tmax", "tmin", "tmean", "precip", "et0", "radiation"]}


def test_normal_forecast_gives_normal_odds(daily):
    monthly = to_monthly(daily)
    months = pd.date_range("2026-01-01", periods=24, freq="MS")
    seasons = seasonal_risk(daily, _forecast_rows(monthly, months))
    assert len(seasons) >= 6
    for s in seasons:
        for name, e in s["events"].items():
            assert abs(e["probability"] - e["normal_probability"]) < 0.11, (s["season"], name)


def test_warmer_forecast_raises_heat_and_lowers_frost(daily):
    monthly = to_monthly(daily)
    months = pd.date_range("2026-01-01", periods=24, freq="MS")
    warm = {s["season"]: s for s in seasonal_risk(daily, _forecast_rows(monthly, months, shift=3.0))}
    summer = warm["Jun–Aug 2026"]["events"]["hot"]
    winter = warm["Dec–Feb 2027"]["events"]["frost"]
    assert summer["probability"] > summer["normal_probability"]
    assert winter["probability"] < winter["normal_probability"]
