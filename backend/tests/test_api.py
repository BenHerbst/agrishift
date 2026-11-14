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
