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


def test_period_averages(client):
    p = {"lat": 1.0, "lon": 2.0, "variables": "tmean"}
    months = client.get("/history", params={**p, "start_year": 2024}).json()["months"]
    years = client.get("/history", params={**p, "start_year": 2024, "period": "year"}).json()["periods"]
    assert [y["period"] for y in years] == ["2024", "2025"] and years[0]["months"] == 12
    mean_2024 = sum(m["tmean"] for m in months if m["month"].startswith("2024")) / 12
    assert abs(years[0]["tmean"] - mean_2024) < 0.01

    seasons = client.get("/history", params={**p, "start_year": 2024, "period": "season"}).json()["periods"]
    assert seasons[0] == {**seasons[0], "period": "Dec–Feb 2024", "start": "2024-01", "months": 2}
    assert seasons[-1]["period"] == "Dec–Feb 2026" and seasons[-1]["start"] == "2025-12"

    fc = client.get("/forecast", params={**p, "years": 1, "period": "season"}).json()["variables"]["tmean"]
    assert len(fc["forecast"]) == 12 and sum(s["months"] for s in fc["periods"]) == 12
    assert all(s["lower_80"] <= s["forecast"] <= s["upper_80"] and s["models"] for s in fc["periods"])

    assert client.get("/history", params={**p, "period": "week"}).status_code == 422
