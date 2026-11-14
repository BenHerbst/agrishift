from app import cache, main

P = {"lat": 1.0, "lon": 2.0, "years": 1, "variables": "tmean"}


def test_forecast_is_reused_from_memory_and_disk(client, calls):
    first = client.get("/forecast", params=P).json()
    assert first["cache"]["status"] == "computed" and len(calls) == 1

    assert client.get("/forecast", params=P).json()["cache"]["status"] == "memory"
    main._memory.clear()  # simulate a server restart
    again = client.get("/forecast", params=P).json()
    assert again["cache"]["status"] == "disk" and len(calls) == 1
    assert again["variables"] == first["variables"]

    # The other endpoints share the same cached forecast
    assert client.get("/risk", params={**P, "years": 2}).json()["cache"]["status"] == "memory"
    assert len(calls) == 1


def test_refresh_retrains(client, calls):
    client.get("/forecast", params=P)
    assert client.get("/forecast", params={**P, "refresh": True}).json()["cache"]["status"] == "computed"
    assert len(calls) == 2


def test_changed_inputs_or_code_invalidate(client, calls, monkeypatch):
    client.get("/forecast", params=P)
    monkeypatch.setattr(main, "fetch_projections", lambda lat, lon: (None, ["NEW_MODEL"], []))
    assert client.get("/forecast", params=P).json()["cache"]["status"] == "computed"
    monkeypatch.setattr(cache, "CODE_VERSION", "edited-code")
    assert client.get("/forecast", params=P).json()["cache"]["status"] == "computed"
    assert len(calls) == 3
    # Only the newest entries per location stay on disk
    assert len(list(cache.FORECAST_DIR.glob("*.json"))) == cache.KEEP_PER_LOCATION


def test_corrupt_file_is_recomputed(client, calls):
    client.get("/forecast", params=P)
    main._memory.clear()
    for path in cache.FORECAST_DIR.glob("*.json"):
        path.write_text("{ not json")
    assert client.get("/forecast", params=P).json()["cache"]["status"] == "computed"


def test_list_and_clear(client, calls):
    client.get("/forecast", params=P)
    listing = client.get("/cache").json()
    assert listing["entries"][0]["trained_until"] == "2025-12" and listing["entries"][0]["current_code"]
    assert client.delete("/cache", params={"lat": 1.0}).status_code == 400
    assert client.delete("/cache", params={"lat": 1.0, "lon": 2.0}).json()["removed"] == 1
    assert client.get("/cache").json()["entries"] == []


def test_degraded_result_is_kept_in_memory_only_for_a_while(client, calls, monkeypatch):
    monkeypatch.setattr(main, "fetch_projections", lambda lat, lon: (None, ["A"], ["B: rate limited"]))
    first = client.get("/forecast", params=P).json()["cache"]
    assert first["status"].startswith("memory only") and len(calls) == 1
    assert client.get("/forecast", params=P).json()["cache"] == first and len(calls) == 1  # reused, not retrained
    assert not list(cache.FORECAST_DIR.glob("*.json")) if cache.FORECAST_DIR.exists() else True
    monkeypatch.setattr(main, "DEGRADED_TTL_S", -1)  # expired → retrained
    main._degraded.clear()
    client.get("/forecast", params=P)
    assert len(calls) == 2


def test_parallel_requests_train_once(client, calls):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(3) as pool:
        statuses = list(pool.map(lambda path: client.get(path, params=P).json()["cache"]["status"],
                                 ["/forecast", "/agri-summary", "/risk"]))
    assert len(calls) == 1 and statuses.count("computed") == 1
