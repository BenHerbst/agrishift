import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture()
def client(daily, monkeypatch):
    """API with all outside data sources replaced by synthetic data (no network)."""
    monkeypatch.setattr(main, "fetch_daily", lambda lat, lon: daily)
    monkeypatch.setattr(main, "fetch_projections", lambda lat, lon: (None, [], []))
    monkeypatch.setattr(main, "fetch_climate_indices", lambda: pd.DataFrame())
    monkeypatch.setattr(main, "fetch_seasonal", lambda lat, lon, download=False: (None, "not downloaded"))
    monkeypatch.setattr(main, "USE_PROPHET", False)
    real = main.forecast_location
    monkeypatch.setattr(main, "forecast_location", lambda *a, **kw: real(*a, **{**kw, "n_origins": 4, "n_boot": 3}))
    monkeypatch.setattr(main, "load_station_data", lambda lat, lon: None)
    main._clear_caches()
    yield TestClient(main.app)
    main._clear_caches()


def test_endpoints(client):
    p = {"lat": 1.0, "lon": 2.0}
    assert client.get("/").status_code == 200
    assert len(client.get("/variables").json()) == 15
    assert client.get("/history", params={**p, "start_year": 2024, "variables": "tmean"}).json()["months"]
    fc = client.get("/forecast", params={**p, "years": 1, "variables": "tmean,precip"}).json()
    assert fc["horizon_months"] == 12 and len(fc["variables"]["tmean"]["forecast"]) == 12
    summary = client.get("/agri-summary", params={**p, "years": 2}).json()["summary"]
    assert summary[0]["year"] == 2026 and "gdd" in summary[0]["indicators"]
    risk = client.get("/risk", params={**p, "years": 2}).json()["seasons"]
    assert risk and "dry" in risk[0]["events"]


def test_unknown_variable_is_rejected(client):
    r = client.get("/forecast", params={"lat": 1, "lon": 2, "variables": "banana"})
    assert r.status_code == 400
