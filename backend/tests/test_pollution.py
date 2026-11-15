import pytest

import numpy as np
import pandas as pd

from app import pollution
from app.pollution import air_summary, crop_safety, distance_m, nearest_sources

LAT, LON = 50.0, 8.0
M_LAT = 1 / 110540  # one metre in degrees latitude


def _road(offset_m, highway="motorway", name="A5"):
    """A north–south road `offset_m` metres east of the field."""
    dlon = offset_m / (111320 * np.cos(np.radians(LAT)))
    return {"type": "way", "id": 1, "tags": {"highway": highway, "name": name},
            "geometry": [{"lat": LAT - 0.01, "lon": LON + dlon}, {"lat": LAT + 0.01, "lon": LON + dlon}]}


def test_distance_to_segment_not_vertex():
    line = np.array([[LAT - 0.01, LON], [LAT + 0.01, LON]])  # vertices ~1.1 km away, the road passes at 0 m
    assert distance_m(LAT, LON, line) == pytest.approx(0, abs=1)
    assert distance_m(LAT, LON, np.array([[LAT + 100 * M_LAT, LON]])) == pytest.approx(100, abs=1)


def test_nearest_per_category_and_solar_parks_ignored():
    elements = [_road(300), _road(40, name="A5 near"), _road(20, highway="residential"),
                {"type": "node", "id": 2, "lat": LAT, "lon": LON, "tags": {"power": "plant", "plant:source": "solar"}}]
    nearest = nearest_sources(elements, LAT, LON)
    assert list(nearest) == ["motorway"]
    assert nearest["motorway"]["distance_m"] == pytest.approx(40, abs=1) and nearest["motorway"]["name"] == "A5 near"


def test_field_inside_an_area_is_zero_metres_away():
    box = [{"lat": LAT + dy, "lon": LON + dx} for dy, dx in [(-0.01, -0.01), (-0.01, 0.01), (0.01, 0.01), (0.01, -0.01), (-0.01, -0.01)]]
    airport = {"type": "way", "id": 3, "tags": {"aeroway": "aerodrome"}, "geometry": box}
    assert nearest_sources([airport], LAT, LON)["airport"]["distance_m"] == 0
    assert nearest_sources([airport], LAT + 0.02, LON)["airport"]["distance_m"] == pytest.approx(1105, abs=5)


def test_verdict_depends_on_distance_and_crop_group():
    near = crop_safety({"motorway": {"distance_m": 30, "name": "A5"}}, None)["crop_groups"]
    assert near["leafy_vegetables"]["verdict"] == "avoid" and near["grain_crops"]["verdict"] == "caution"
    mid = crop_safety({"motorway": {"distance_m": 100, "name": None}}, None)["crop_groups"]
    assert mid["leafy_vegetables"]["verdict"] == "caution" and mid["grain_crops"]["verdict"] == "safe"
    far = crop_safety({"motorway": {"distance_m": 900, "name": None}}, None)
    assert all(g["verdict"] == "safe" for g in far["crop_groups"].values()) and not far["recommendations"]


def test_ozone_only_hits_sensitive_groups():
    air = {"ozone_aot40_may_jul_ug_m3_h": 25000, "no2_mean_ug_m3": 10, "so2_mean_ug_m3": 2}
    groups = crop_safety({}, air)["crop_groups"]
    assert groups["grain_crops"]["verdict"] == "caution" and groups["root_vegetables"]["verdict"] == "safe"


def test_aot40_from_3_hourly_values():
    times = pd.date_range("2025-01-01", "2025-12-31 21:00", freq="3h")
    local_hour = (times + pd.Timedelta(hours=8)).hour  # lon 120° E = UTC + 8 h
    ozone = np.where(times.month.isin([5, 6, 7]) & (local_hour >= 8) & (local_hour < 20), 100.0, 60.0)
    hourly = pd.DataFrame({"ozone": ozone, "nitrogen_dioxide": np.where(times.month.isin([5, 6, 7]), 10.0, 30.0),
                           "sulphur_dioxide": 1.0, "pm25": 8.0}, index=times)
    summary = air_summary(hourly, lon=120, year=2025)
    assert summary["ozone_aot40_may_jul_ug_m3_h"] == 92 * 12 * 20  # days × 08–20 h × (100 − 80)
    assert summary["no2_mean_ug_m3"] == 25.0  # 3 summer months at 10, 9 others at 30 – months weigh equally


def test_cams_netcdf_nearest_point_and_units(tmp_path):
    import xarray as xr
    times = pd.date_range("2025-06-01", periods=4, freq="3h")
    grid = {"valid_time": times, "latitude": [50.25, 49.5], "longitude": [7.5, 8.25]}
    mmr = np.zeros((4, 2, 2)); mmr[:, 1, 1] = 1e-7  # kg/kg at the point nearest to 49.6 N, 8.2 E
    ds = xr.Dataset({"go3": (("valid_time", "latitude", "longitude"), mmr),
                     "pm2p5": (("valid_time", "latitude", "longitude"), mmr / 10)}, coords=grid)
    ds.to_netcdf(tmp_path / "t.nc")
    frame = pollution._cams_frame(tmp_path / "t.nc", 49.6, 8.2)
    assert list(frame.columns) == ["ozone", "pm25"]
    assert frame["ozone"].iloc[0] == pytest.approx(1e-7 * 1.204 * 1e9)  # ≈ 120 µg/m³
    assert frame["pm25"].iloc[0] == pytest.approx(10.0)


def test_air_quality_cache_returns_newest_year(tmp_path, monkeypatch):
    monkeypatch.setattr(pollution, "CAMS_DIR", tmp_path)
    assert pollution.read_air_quality(50, 8) is None
    for year in (2024, 2025):
        (tmp_path / f"50_8_{year}.json").write_text(f'{{"year": {year}}}')
    assert pollution.read_air_quality(50, 8) == {"year": 2025}


def test_pollution_endpoint(client, offline_pollution):
    d = client.get("/pollution", params={"lat": 50.123456, "lon": 8.5}).json()
    assert d["infrastructure"]["main_road"]["emits"].startswith("traffic")
    assert d["crop_groups"]["leafy_vegetables"]["verdict"] == "avoid"
    assert d["recommendations"]
