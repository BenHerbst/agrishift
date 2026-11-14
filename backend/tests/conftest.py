"""Synthetic daily weather (no network): seasonal cycle + warming trend + noise, all ERA5 columns."""
import numpy as np
import pandas as pd
import pytest

from app.data import DAILY_VARS


def make_daily(start="1980-01-01", end="2025-12-31", warming_per_decade=0.4, seed=0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, end, freq="D", name="date")
    season = np.sin(2 * np.pi * (idx.dayofyear - 110) / 365.25)
    years = (idx.year - 1980) + idx.dayofyear / 365.25
    tmean = 10 + 9 * season + warming_per_decade * years / 10 + rng.normal(0, 3, len(idx))
    precip = rng.gamma(0.6, 4.0, len(idx)) * (rng.random(len(idx)) < 0.5)
    df = pd.DataFrame({
        "tmean": tmean,
        "tmax": tmean + 5 + rng.normal(0, 1, len(idx)),
        "tmin": tmean - 5 + rng.normal(0, 1, len(idx)),
        "precip": precip,
        "et0": np.clip(2 + 2 * season + rng.normal(0, 0.5, len(idx)), 0, None),
        "radiation": np.clip(12 + 10 * season + rng.normal(0, 3, len(idx)), 0, None),
        "wind_max": np.clip(20 + rng.normal(0, 5, len(idx)), 0, None),
        "humidity": np.clip(75 - 10 * season + rng.normal(0, 5, len(idx)), 0, 100),
        "soil_moisture": np.clip(0.3 - 0.05 * season + rng.normal(0, 0.02, len(idx)), 0, 0.5),
        "soil_moisture_7_28": np.clip(0.3 - 0.04 * season + rng.normal(0, 0.01, len(idx)), 0, 0.5),
        "soil_moisture_28_100": np.clip(0.3 - 0.02 * season + rng.normal(0, 0.01, len(idx)), 0, 0.5),
    }, index=idx)
    assert set(df.columns) == set(DAILY_VARS.values())
    return df


@pytest.fixture(scope="session")
def daily() -> pd.DataFrame:
    return make_daily()
