import numpy as np
import pandas as pd

from app.features import GDD_BASE_C, MONTHLY_VARIABLES, add_daily_indicators, to_monthly


def test_daily_indicators():
    df = pd.DataFrame({"tmax": [35.0, 20.0, 2.0], "tmin": [15.0, 6.0, -3.0], "precip": [0.0, 5.0, 1.0],
                       "et0": [6.0, 3.0, 0.5], "soil_moisture": [0.1] * 3, "soil_moisture_7_28": [0.2] * 3,
                       "soil_moisture_28_100": [0.3] * 3}, index=pd.date_range("2024-07-01", periods=3))
    out = add_daily_indicators(df)
    assert list(out["gdd"]) == [25.0 - GDD_BASE_C, 13.0 - GDD_BASE_C, 0.0]
    assert list(out["heat_days"]) == [1, 0, 0]
    assert list(out["frost_days"]) == [0, 0, 1]
    assert list(out["wet_days"]) == [0, 1, 1]
    assert list(out["water_balance"]) == [-6.0, 2.0, 0.5]
    assert np.allclose(out["soil_moisture_root"], (7 * 0.1 + 21 * 0.2 + 72 * 0.3) / 100)


def test_monthly_drops_partial_month(daily):
    monthly = to_monthly(daily[:"2025-06-15"])
    assert monthly.index[-1] == pd.Timestamp("2025-05-01")
    assert set(MONTHLY_VARIABLES) <= set(monthly.columns)
    assert monthly["frost_days"].max() <= 31
