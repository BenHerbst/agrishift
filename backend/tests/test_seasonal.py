import numpy as np
import pandas as pd
import xarray as xr

from app import seasonal as S


def test_cds_netcdf_is_parsed_to_monthly_units(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "SEAS5_DIR", tmp_path)
    starts = pd.date_range("2021-07-01", periods=1, freq="MS")
    dims = ("number", "forecast_reference_time", "forecastMonth", "latitude", "longitude")
    coords = {"number": [0, 1], "forecast_reference_time": starts, "forecastMonth": [1],
              "latitude": [51.0], "longitude": [6.0]}
    ds = xr.Dataset({
        "t2m": (dims, np.full((2, 1, 1, 1, 1), 290.65), {"units": "K"}),
        "tprate": (dims, np.full((2, 1, 1, 1, 1), 5.4e-8), {"units": "m s**-1"}),
        "msdsrf": (dims, np.full((2, 1, 1, 1, 1), 204.9), {"units": "W m**-2"}),  # name as CDS delivers it
    }, coords=coords)
    path = tmp_path / "t.nc"
    ds.to_netcdf(path)
    row = S._parse(path, 50.78, 6.08).iloc[0]
    assert abs(row["tmean"] - 17.5) < 0.01
    assert abs(row["precip"] - 5.4e-8 * 31 * 86400 * 1000) < 0.1
    assert abs(row["radiation"] - 204.9 * 31 * 86400 / 1e6) < 0.1


def test_anomalies_remove_model_bias():
    starts = pd.date_range("1993-07-01", "2016-07-01", freq="12MS").append(pd.DatetimeIndex(["2021-07-01"]))
    idx = pd.MultiIndex.from_product([starts, [1]], names=["start", "lead"])
    frame = pd.DataFrame({"tmean": 20.0, "precip": 50.0}, index=idx)  # model is 2 °C too warm everywhere
    frame.loc[(pd.Timestamp("2021-07-01"), 1)] = [21.5, 75.0]
    a = S.seasonal_anomalies(frame, pd.Timestamp("2021-07-01"))
    assert abs(a.loc[1, "tmean"] - 1.5) < 1e-9 and abs(a.loc[1, "precip"] - 1.5) < 1e-9
