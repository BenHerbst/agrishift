import pandas as pd

from app.pollution import crop_safety
from app.rotation import CROPS, crop_score, plan_rotation, rotation_block

MONTHS = pd.date_range("2027-01-01", periods=36, freq="MS")
# Temperate climate: warm summers, enough rain, no heat or frost in the growing season
CLIMATE = {
    "gdd": [0, 0, 10, 60, 150, 230, 280, 270, 160, 50, 0, 0],
    "et0": [10, 15, 35, 60, 90, 110, 120, 100, 65, 35, 15, 10],
    "precip": [55, 45, 50, 50, 65, 70, 75, 70, 55, 55, 60, 60],
    "heat_days": [0, 0, 0, 0, 0, 1, 3, 2, 0, 0, 0, 0],
    "frost_days": [15, 12, 6, 1, 0, 0, 0, 0, 0, 2, 8, 14],
    "humidity": [85, 80, 72, 66, 64, 63, 62, 62, 68, 78, 85, 88],
    "wet_days": [12, 10, 11, 9, 8, 8, 7, 7, 8, 10, 12, 13],
}
HUMID = {**CLIMATE, "humidity": [v + 12 for v in CLIMATE["humidity"]], "wet_days": [v + 5 for v in CLIMATE["wet_days"]]}


def _frame(climate):
    return pd.DataFrame({v: {pd.Timestamp(r["month"]): r["forecast"] for r in rows} for v, rows in _forecasts(climate).items()})


def _forecasts(climate=CLIMATE):
    return {var: [{"month": f"{m:%Y-%m}", "forecast": float(values[m.month - 1])} for m in MONTHS]
            for var, values in climate.items()}


def test_rotation_rules():
    assert rotation_block("winter_wheat", ["winter_wheat"]) == "Same crop as last year"
    assert "third cereal" in rotation_block("oats", ["winter_wheat", "spring_barley"])
    assert "4 years" in rotation_block("soybean", ["field_pea", "winter_wheat", "maize"])
    assert rotation_block("field_pea", ["field_pea", "winter_wheat", "maize", "oats", "sugar_beet"]) is None


def test_plan_is_a_healthy_rotation():
    plan = plan_rotation(_forecasts(), lat=50, history=["winter_wheat", "winter_barley"])
    crops = [year["crop"] for year in plan]
    assert [year["year"] for year in plan] == [2027, 2028, 2029]
    assert CROPS[crops[0]]["family"] != "cereal"  # two cereal years already
    assert len(set(crops)) == 3
    for year in plan:
        assert 0 <= year["score"] <= 100 and len(year["alternatives"]) == 3


def test_too_cool_and_dry_climate_lowers_warm_crops():
    cool = {**CLIMATE, "gdd": [v * 0.4 for v in CLIMATE["gdd"]], "precip": [v * 0.3 for v in CLIMATE["precip"]]}
    fc = pd.DataFrame({v: {pd.Timestamp(r["month"]): r["forecast"] for r in rows} for v, rows in _forecasts(cool).items()})
    assert crop_score("sunflower", fc, 2027, 50)["score"] < 50
    assert crop_score("maize", fc, 2027, 50, taw=200)["score"] > crop_score("maize", fc, 2027, 50)["score"]


def test_humid_climate_hits_disease_prone_crops_only():
    dry, humid = _frame(CLIMATE), _frame(HUMID)
    assert crop_score("sunflower", humid, 2027, 50)["score"] < crop_score("sunflower", dry, 2027, 50)["score"] - 25
    assert crop_score("maize", humid, 2027, 50)["score"] == crop_score("maize", dry, 2027, 50)["score"]
    assert plan_rotation(_forecasts(HUMID), lat=50, history=["winter_wheat", "winter_barley"])[0]["crop"] != "sunflower"


def test_acid_soil_spreads_scores_by_crop_tolerance():
    fc = _frame(CLIMATE)
    oats, wheat, barley = (crop_score(c, fc, 2027, 50, ph=5.1)["score"] for c in ("oats", "winter_wheat", "winter_barley"))
    assert oats > wheat > barley  # oats tolerate acid soil, barley least


def test_southern_hemisphere_uses_shifted_season():
    fc = pd.DataFrame({v: {pd.Timestamp(r["month"]): r["forecast"] for r in rows} for v, rows in _forecasts().items()})
    # wheat's season becomes Sep–Jan: the 2027 season needs Sep 2026, which is not in the forecast
    assert crop_score("winter_wheat", fc, 2027, -30) is None and crop_score("winter_wheat", fc, 2028, -30)


def test_polluted_site_excludes_root_crops():
    safety = crop_safety({"motorway": {"distance_m": 30, "name": "A1"}}, None)
    plan = plan_rotation(_forecasts(), lat=50, safety=safety)
    assert all(CROPS[y["crop"]]["group"] != "root_vegetables" for y in plan)
    assert plan[0]["not_possible"]["potato"].startswith("Pollution")


def test_rotation_endpoint(client, offline_pollution):
    assert client.get("/rotation", params={"lat": 1, "lon": 2, "history": "banana"}).status_code == 400
    d = client.get("/rotation", params={"lat": 1, "lon": 2, "years": 3, "history": "maize"}).json()
    assert d["plan"] and d["plan"][0]["crop"] != "maize"
    assert d["pollution"]["leafy_vegetables"] == "avoid" and "error" in d["soil"]
