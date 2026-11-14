from app.calibration import apply_corrections, compute_corrections


def test_station_offsets_are_recovered(daily):
    reanalysis = daily.loc["2015":"2024", ["tmax", "tmin", "precip"]]
    station = reanalysis.assign(tmax=reanalysis.tmax + 1.5, tmin=reanalysis.tmin + 1.5, precip=reanalysis.precip * 1.2)
    corr = compute_corrections(daily, station)
    assert all(abs(corr["tmax"]["by_month"][m] - 1.5) < 1e-6 for m in range(1, 13))
    assert all(abs(corr["precip"]["by_month"][m] - 1.2) < 1e-6 for m in range(1, 13))
    assert corr["tmean"]["derived_from"] == "tmax/tmin"
    fixed = apply_corrections(daily, corr)
    assert abs((fixed.tmax - daily.tmax).mean() - 1.5) < 1e-6
