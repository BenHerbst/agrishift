import pytest

from app import main
from app.rotation import CROPS, rotation_block
from app.rotation_compare import (
    DIMENSIONS, MIN_SUITABILITY, TRAITS, compare, composite, evaluate, parse_weights, site_erosion_factor,
)
from test_soil import _fake_soil

SITE = 1.0


def _results(n=3, score=80, shortfall=50):
    """Every crop equally suitable in every year, so only the crop traits decide."""
    one = {c: {"score": score, "water_demand_mm": 400, "water_shortfall_mm": shortfall} for c in CROPS}
    return [one] * n


def test_every_crop_has_traits_and_rotation_rules_are_consistent():
    assert set(TRAITS) == set(CROPS)
    assert rotation_block("winter_wheat", ["winter_wheat"])  # the rules the generator relies on


def test_legume_rotation_beats_cereals_on_soil_dimensions():
    soil = evaluate(["field_pea", "winter_wheat", "clover_grass"], _results(), [], SITE)["scores"]
    cereals = evaluate(["winter_wheat", "winter_barley", "maize"], _results(), [], SITE)["scores"]
    for dimension in ("nutrient_cycling", "organic_matter", "erosion", "pest_cycle"):
        assert soil[dimension] > cereals[dimension], dimension


def test_nitrogen_credit_reaches_only_the_next_crop():
    with_pea = evaluate(["field_pea", "winter_wheat"], _results(2), [], SITE)["metrics"]
    # wheat needs 200 kg N, the pea leaves 30 → (0 + 170) / 2; without the pea it would be 100
    assert with_pea["mineral_n_to_buy_kg_per_ha_year"] == 85 and with_pea["n_credit_reused_kg_per_ha"] == 30
    after_history = evaluate(["winter_wheat"], _results(1), ["faba_bean"], SITE)["metrics"]
    assert after_history["mineral_n_to_buy_kg_per_ha_year"] == 160  # the history crop counts too


def test_humus_balance_and_erosion_follow_the_crop_traits():
    assert evaluate(["potato", "sugar_beet"], _results(2), [], SITE)["metrics"]["humus_balance_kg_c_per_ha_year"] == -760
    ley = evaluate(["clover_grass"], _results(1), [], SITE)
    assert ley["metrics"]["humus_balance_kg_c_per_ha_year"] == 800 and ley["scores"]["organic_matter"] == 100
    assert ley["scores"]["erosion"] > 90
    # the same crops on an erodible, rainy site score worse
    risky = evaluate(["maize"], _results(1), [], site_erosion_factor("silt loam", 1100))["scores"]["erosion"]
    assert risky < evaluate(["maize"], _results(1), [], site_erosion_factor("sand", 500))["scores"]["erosion"]


def test_pest_cycle_flags_broken_rotation_rules():
    ok = evaluate(["field_pea", "winter_wheat", "winter_rapeseed"], _results(), [], SITE)
    broken = evaluate(["winter_wheat", "winter_barley", "oats"], _results(), ["winter_wheat", "winter_barley"], SITE)
    assert ok["rule_violations"] == [] and ok["scores"]["pest_cycle"] == 100
    assert len(broken["rule_violations"]) == 3 and broken["scores"]["pest_cycle"] == 0
    assert "third cereal year" in broken["rule_violations"][0]


def test_crop_excluded_for_pollution_is_flagged_not_a_crash():
    results = _results()
    results[0]["maize"] = {"score": 0, "excluded": "Pollution: motorway 30 m away"}  # no water figures, like crop_score
    out = evaluate(["maize", "field_pea", "winter_barley"], results, [], SITE)
    assert out["excluded_for_pollution"] == ["maize in year 1: Pollution: motorway 30 m away"]
    assert out["rule_violations"] == [] and out["scores"]["pest_cycle"] == 100  # not a pest problem
    assert out["scores"]["climate_fit"] < evaluate(["winter_wheat", "field_pea", "winter_barley"], _results(), [], SITE)["scores"]["climate_fit"]
    assert out["metrics"]["water_demand_mm_per_year"] == 400  # the two usable years


def test_water_use_uses_the_crop_year_shortfall():
    dry = evaluate(["maize"], _results(1, shortfall=200), [], SITE)
    wet = evaluate(["maize"], _results(1, shortfall=0), [], SITE)
    assert dry["metrics"]["water_shortfall_mm_per_year"] == 200 and dry["scores"]["water_use"] == 20
    assert wet["scores"]["water_use"] == 100


def test_weights():
    assert parse_weights(None) == {d: 1.0 for d in DIMENSIONS}
    assert parse_weights("erosion=2, market=0")["erosion"] == 2.0
    for bad in ("banana=1", "erosion=lots", "erosion=-1"):
        with pytest.raises(ValueError):
            parse_weights(bad)
    with pytest.raises(ValueError):
        parse_weights(",".join(f"{d}=0" for d in DIMENSIONS))
    scores = {d: 50.0 for d in DIMENSIONS} | {"erosion": 100.0}
    assert composite(scores, parse_weights("erosion=8")) > composite(scores, parse_weights(None))


def test_compare_generates_valid_scenarios_per_goal():
    year_scores = [(2027 + i, r) for i, r in enumerate(_results())]
    plan = [{"crop": c} for c in ("winter_wheat", "field_pea", "winter_barley")]
    out = compare(year_scores, plan, [], "loam", 750, parse_weights(None), [["oats", "faba_bean", "winter_wheat"]])
    labels = {label: s for s in out["scenarios"] for label in s["labels"]}
    assert {"recommended_plan", "best_climate_fit", "soil_building", "water_saving", "erosion_control", "forage",
            "market", "balanced", "custom_1"} <= set(labels)
    assert [s["composite"] for s in out["scenarios"]] == sorted((s["composite"] for s in out["scenarios"]), reverse=True)
    for s in out["scenarios"]:
        crops = [r["crop"] for r in s["rotation"]]
        assert [r["year"] for r in s["rotation"]] == [2027, 2028, 2029]
        assert s["rule_violations"] == [] and all(not rotation_block(c, crops[:i]) for i, c in enumerate(crops))
    # each goal's scenario leads (or ties) on its own dimension among the generated ones
    assert labels["soil_building"]["scores"]["organic_matter"] >= labels["market"]["scores"]["organic_matter"]
    assert labels["forage"]["scores"]["forage"] >= labels["soil_building"]["scores"]["forage"] - 20
    assert labels["market"]["scores"]["market"] == max(s["scores"]["market"] for s in out["scenarios"])
    assert "vs_recommended_plan" in labels["soil_building"] and "vs_recommended_plan" not in labels["recommended_plan"]


def test_compare_only_offers_crops_that_suit_the_climate():
    results = _results()
    for r in results:
        r["potato"]["score"] = MIN_SUITABILITY - 1  # too poor to be offered
        r["maize"]["excluded"] = "Pollution: test"  # unsafe here
    year_scores = [(2027 + i, r) for i, r in enumerate(results)]
    out = compare(year_scores, [], [], None, 750, parse_weights(None))
    assert not any(r["crop"] in ("potato", "maize") for s in out["scenarios"] for r in s["rotation"])
    assert compare([], [], [], None, 750, parse_weights(None))["scenarios"] == []


def test_compare_endpoint(client, offline_pollution, monkeypatch):
    monkeypatch.setattr(main, "fetch_soil", lambda lat, lon: _fake_soil())
    main._soil.cache_clear()
    p = {"lat": 1, "lon": 2}
    d = client.get("/rotation/compare", params={**p, "history": "maize", "weights": "erosion=3",
                                                "rotations": "maize,field_pea,winter_barley;oats,faba_bean,winter_wheat"}).json()
    assert d["years"] == [2026, 2027, 2028] and d["weights"]["erosion"] == 3.0
    assert d["soil"]["texture_class"] == "loam" and d["pollution"]["leafy_vegetables"] == "avoid"
    labels = {label: s for s in d["scenarios"] for label in s["labels"]}
    assert {"custom_1", "custom_2"} <= set(labels)  # two ';'-separated rotations
    assert labels["custom_1"]["excluded_for_pollution"]  # the test road makes fodder (maize) unsafe: flagged, status 200
    assert all(set(s["scores"]) == set(DIMENSIONS) for s in d["scenarios"])
    assert client.get("/rotation/compare", params={**p, "weights": "banana=1"}).status_code == 400
    assert client.get("/rotation/compare", params={**p, "rotations": "oats,banana,oats"}).status_code == 400
    assert client.get("/rotation/compare", params={**p, "rotations": "oats,faba_bean"}).status_code == 400  # 2 of 3 years
    main._soil.cache_clear()
