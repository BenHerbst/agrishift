import io
import zipfile

import numpy as np
import pandas as pd
import pytest
import xarray as xr

from app import cmip6, era5land, nasa_power, sources
from app.data import DAILY_VARS
from app.et0 import penman_monteith


def test_et0_matches_fao56_examples():
    # FAO-56 Example 18 (Uccle, 6 July) → 3.9 mm/day; Example 17 (Bangkok, April) → 5.72 mm/day
    assert penman_monteith(21.5, 12.3, 22.07, 2.078, 1.409, 50.8, 187, elevation_m=100) == pytest.approx(3.9, abs=0.05)
    assert penman_monteith(34.8, 25.6, 22.65, 2.0, 2.85, 13.73, 105, elevation_m=2) == pytest.approx(5.72, abs=0.1)


def _hourly(days=3, lon=6.0):
    idx = pd.date_range("2024-07-01", periods=24 * days, freq="h")
    hour = np.arange(len(idx)) % 24
    return pd.DataFrame({
        "t2m": 288.15 + 5 * np.sin((hour - 9) / 24 * 2 * np.pi), "d2m": 283.15, "tp": 0.0001,
        "ssrd": np.where((hour > 5) & (hour < 20), 1e6, 0.0), "u10": 3.0, "v10": 4.0, "sp": 100000.0,
        "swvl1": 0.3, "swvl2": 0.31, "swvl3": 0.32,
    }, index=idx)


def test_era5land_hourly_to_daily():
    assert len(era5land.hourly_to_daily(_hourly(), lat=50.8, lon=6.0)) == 3   # 6° E: local day = UTC day
    daily = era5land.hourly_to_daily(_hourly(), lat=50.8, lon=30.0)          # 30° E: UTC+2
    assert list(daily.columns) == list(DAILY_VARS.values())
    assert len(daily) == 2  # the partial first and last local days (22 and 2 hours) are dropped
    day = daily.iloc[0]
    assert day["tmax"] == pytest.approx(20.0, abs=0.1) and day["tmin"] == pytest.approx(10.0, abs=0.1)
    assert day["precip"] == pytest.approx(2.4)          # 24 h × 0.1 mm
    assert day["radiation"] == pytest.approx(14.0)      # 14 sunny hours × 1 MJ
    assert day["wind_max"] == pytest.approx(18.0)       # √(3² + 4²) m/s = 5 m/s = 18 km/h
    assert 0 < day["et0"] < 8 and 0 < day["humidity"] < 100


def test_era5land_zip_is_merged():
    hourly = _hourly(1)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for cols in (["t2m", "d2m"], ["tp", "sp"], ["ssrd"], ["u10", "v10"], ["swvl1", "swvl2", "swvl3"]):
            frame = hourly[cols].assign(latitude=50.8, longitude=6.1)
            z.writestr(f"{cols[0]}.csv", frame.rename_axis("valid_time").to_csv())
    merged = era5land._read_zip(buf.getvalue())
    assert set(merged.columns) == set(hourly.columns) and len(merged) == 24


def test_nasa_power_parsing():
    dates = ["20240701", "20240702"]
    params = {"T2M": [15, 14], "T2M_MAX": [20, 19], "T2M_MIN": [10, -999], "PRECTOTCORR": [2.5, 0], "ALLSKY_SFC_SW_DWN": [20, 18],
              "RH2M": [70, 75], "WS2M": [2, 3], "WS10M_MAX": [5, 6], "PS": [100, 100], "GWETTOP": [0.8, 0.7], "GWETROOT": [0.6, 0.6]}
    payload = {"properties": {"parameter": {k: dict(zip(dates, v)) for k, v in params.items()}}}
    daily = nasa_power.to_daily(payload, lat=50.8)
    assert len(daily) == 1  # the day with a missing Tmin (−999) is dropped
    assert daily.iloc[0]["wind_max"] == pytest.approx(18.0)
    assert daily.iloc[0]["soil_moisture"] == pytest.approx(0.8 * nasa_power.POROSITY)
    assert 2 < daily.iloc[0]["et0"] < 6


def _write_cmip(tmp_path, model, lon_values):
    for experiment, (first, last) in cmip6.PERIODS.items():
        time = pd.date_range(f"{first}-01-16", f"{last}-12-16", freq="MS") + pd.Timedelta(days=15)
        for variable, (short, _) in cmip6.VARIABLES.items():
            base = {"tas": 283.15, "tasmax": 288.15, "tasmin": 278.15, "pr": 2e-5, "rsds": 120.0,
                    "hurs": 75.0, "sfcWind": 4.0, "mrsos": 30.0}[short]
            data = np.full((len(time), 2, 2), base)
            ds = xr.Dataset({short: (("time", "lat", "lon"), data)}, coords={"time": time, "lat": [50.0, 51.0], "lon": lon_values})
            ds.to_netcdf(cmip6._path(model, experiment, variable, cmip6._tile(50.84, 6.13)))


def test_cmip6_units_and_longitude_wrap(tmp_path, monkeypatch):
    monkeypatch.setattr(cmip6, "CMIP6_DIR", tmp_path)
    monkeypatch.setattr(cmip6, "MODELS", ["model_a", "model_b"])
    _write_cmip(tmp_path, "model_a", [6.0, 7.0])
    _write_cmip(tmp_path, "model_b", [6.0, 7.0])
    frame, models = cmip6.read_projections(50.84, 6.13)
    assert models == ["model_a", "model_b"]
    july = frame.loc["2030-07-01"]
    assert july["tmean"] == pytest.approx(10.0) and july["soil_moisture"] == pytest.approx(0.3)
    assert july["precip"] == pytest.approx(2e-5 * 31 * 86400)       # kg/m²/s → mm per month
    assert july["radiation"] == pytest.approx(120 * 31 * 86400 / 1e6)
    assert 50 < july["et0"] < 200
    # Western longitude on a 0–360° grid
    monkeypatch.setattr(cmip6, "MODELS", ["model_w"])
    for experiment in cmip6.PERIODS:
        for variable in cmip6.VARIABLES:
            src = cmip6._path("model_a", experiment, variable, cmip6._tile(50.84, 6.13))
            with xr.open_dataset(src) as ds:
                ds.assign_coords(lon=[258.0, 259.0]).to_netcdf(cmip6._path("model_w", experiment, variable, cmip6._tile(50.84, -101.5)))
    assert cmip6.read_projections(50.84, -101.5)[1] == ["model_w"]


def test_weather_fallback_order(daily, monkeypatch):
    calls = []

    def fake(name, lat, lon):
        calls.append(name)
        if name == "era5land":
            return None                                   # not downloaded
        if name == "nasa_power":
            raise RuntimeError("server down")
        return daily

    monkeypatch.setattr(sources, "_weather", fake)
    df = sources.fetch_daily(1, 2)
    assert calls == ["era5land", "nasa_power", "open_meteo"]
    assert df.attrs["source"] == "open_meteo" and len(df.attrs["skipped"]) == 2

    monkeypatch.setattr(sources, "_weather", lambda name, lat, lon: daily["2020":])  # too short everywhere
    with pytest.raises(RuntimeError, match="only 6 years"):
        sources.fetch_daily(1, 2)


def test_projection_fallback(monkeypatch):
    monkeypatch.setattr(sources.cmip6, "read_projections", lambda lat, lon: (None, []))
    monkeypatch.setattr(sources, "fetch_open_meteo_projections", lambda lat, lon: (pd.DataFrame({"tmean": [1.0]}), ["M"], []))
    frame, models, errors = sources.fetch_projections(1, 2)
    assert models == ["open_meteo:M"] and errors == []
