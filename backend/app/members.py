"""Ensemble members that learn from one monthly series (one variable at one location).

Every member has `fit(y)` on the monthly history and `predict(idx)` for the months after it.
The members built from precomputed data (CMIP6 projections, SEAS5) live in `projections.py`.
"""
import logging

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from statsmodels.tsa.holtwinters import ExponentialSmoothing

try:
    logging.getLogger("prophet.plot").disabled = True  # "Importing plotly failed" – plots aren't used
    from prophet import Prophet

    logging.getLogger("cmdstanpy").disabled = True
    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False

MAX_HORIZON_MONTHS = 36
NORMAL_YEARS = 30
RECENT_CLIMATOLOGY_YEARS = 12
RECENT_TREND_YEARS = 25


class Climatology:
    """Mean of the last 30 years per calendar month – the reference every forecast must beat."""
    name = "climatology"
    years = NORMAL_YEARS

    def fit(self, y: pd.Series) -> "Climatology":
        recent = y.iloc[-self.years * 12:]
        self.normals = recent.groupby(recent.index.month).mean()
        return self

    def predict(self, idx: pd.DatetimeIndex) -> np.ndarray:
        return self.normals.reindex(idx.month).values


class RecentClimatology(Climatology):
    """Mean of the last 12 years – tracks the recent, warmer regime (matters for heat days)."""
    name = "recent_climatology"
    years = RECENT_CLIMATOLOGY_YEARS


class TrendClimatology:
    """Seasonal cycle + linear trend over the whole history (OLS)."""
    name = "trend_climatology"

    def fit(self, y: pd.Series) -> "TrendClimatology":
        self.start = y.index[0]
        X = self._design(y.index)
        self.coef, *_ = np.linalg.lstsq(X, y.values, rcond=None)
        resid = pd.Series(y.values - X @ self.coef, index=y.index)
        # Year-to-year spread per calendar month – also used for the uncertainty ranges
        self.resid_std = resid.groupby(resid.index.month).std()
        return self

    def _design(self, idx: pd.DatetimeIndex) -> np.ndarray:
        decades = ((idx.year - self.start.year) * 12 + idx.month - self.start.month) / 120.0
        month_dummies = np.eye(12)[idx.month - 1]
        return np.column_stack([decades, month_dummies])

    def predict(self, idx: pd.DatetimeIndex) -> np.ndarray:
        return self._design(idx) @ self.coef


class RecentTrend(TrendClimatology):
    """Same, fitted on the last 25 years only – follows the faster recent warming."""
    name = "recent_trend"

    def fit(self, y: pd.Series) -> "RecentTrend":
        return super().fit(y.iloc[-RECENT_TREND_YEARS * 12:])


class HoltWinters:
    """Damped additive exponential smoothing – adapts to recent level shifts."""
    name = "holt_winters"

    def fit(self, y: pd.Series) -> "HoltWinters":
        self.model = ExponentialSmoothing(
            y.values, trend="add", damped_trend=True, seasonal="add", seasonal_periods=12
        ).fit()
        return self

    def predict(self, idx: pd.DatetimeIndex) -> np.ndarray:
        # idx must directly follow the training period
        return self.model.forecast(len(idx))


class BoostedAnomaly:
    """Gradient boosting on de-trended anomalies with 36/48/60-month lags.

    The shortest lag equals the horizon, so every month up to 3 years ahead is forecast directly.
    """
    name = "boosted_anomaly"
    LAGS = (36, 48, 60)

    def fit(self, y: pd.Series) -> "BoostedAnomaly":
        self.trend = TrendClimatology().fit(y)
        self.resid = y - self.trend.predict(y.index)
        self.gbm = HistGradientBoostingRegressor(
            max_iter=150, learning_rate=0.03, max_depth=3, min_samples_leaf=30,
            l2_regularization=1.0, random_state=0,
        ).fit(self._features(y.index), self.resid.values)
        return self

    def _features(self, idx: pd.DatetimeIndex) -> pd.DataFrame:
        full_idx = pd.date_range(self.resid.index[0], max(idx[-1], self.resid.index[-1]), freq="MS")
        r = self.resid.reindex(full_idx)
        X = pd.DataFrame({"month": full_idx.month}, index=full_idx)
        for lag in self.LAGS:
            X[f"lag{lag}"] = r.shift(lag)
        # Mean anomaly of the year ending 3 years earlier – captures slow multi-year regimes
        X["year_mean_lag36"] = r.shift(36).rolling(12).mean()
        return X.loc[idx]

    def predict(self, idx: pd.DatetimeIndex) -> np.ndarray:
        return self.trend.predict(idx) + self.gbm.predict(self._features(idx))


class ProphetForecaster:
    """Meta Prophet: piecewise-linear trend with changepoints + Fourier yearly seasonality."""
    name = "prophet"

    def fit(self, y: pd.Series) -> "ProphetForecaster":
        self.model = Prophet(
            yearly_seasonality=True, weekly_seasonality=False, daily_seasonality=False,
            changepoint_prior_scale=0.05, uncertainty_samples=0,
        ).fit(pd.DataFrame({"ds": y.index, "y": y.values}))
        return self

    def predict(self, idx: pd.DatetimeIndex) -> np.ndarray:
        return self.model.predict(pd.DataFrame({"ds": idx}))["yhat"].values


class ClimateDrivers:
    """One ridge regression per lead month on the state at forecast time.

    Features: ENSO (Niño 3.4, 3-month mean), NAO, PDO and the local recent anomaly (persistence,
    e.g. dry soil stays dry), each modulated by the target season. Ridge shrinks lead months
    without signal towards zero, i.e. towards the trend.
    """
    name = "climate_drivers"
    ALPHAS = np.logspace(-1, 4, 16)
    MIN_TRAIN_ROWS = 60

    def __init__(self, indices: pd.DataFrame):
        self.indices = indices

    def _origin_features(self, resid: pd.Series) -> pd.DataFrame:
        feats = pd.DataFrame(index=resid.index)
        feats["recent_anomaly"] = resid.rolling(3, min_periods=1).mean()
        if not self.indices.empty:
            ind = self.indices.reindex(resid.index).ffill(limit=3)
            if "nino34" in ind:
                feats["nino34_3m"] = ind["nino34"].rolling(3, min_periods=1).mean()
            for col in ("nao", "pdo"):
                if col in ind:
                    feats[col] = ind[col]
        return feats.dropna(axis=1, how="all")

    @staticmethod
    def _seasonal(feats: pd.DataFrame, target_months: np.ndarray) -> np.ndarray:
        angle = 2 * np.pi * (target_months - 1) / 12
        sin, cos = np.sin(angle)[:, None], np.cos(angle)[:, None]
        F = feats.values
        return np.hstack([F, F * sin, F * cos])

    def fit(self, y: pd.Series) -> "ClimateDrivers":
        self.trend = TrendClimatology().fit(y)
        resid = y - self.trend.predict(y.index)
        feats = self._origin_features(resid)
        self.origin = y.index[-1]
        self.origin_feats = feats.iloc[[-1]]
        self.models = {}
        for h in range(1, MAX_HORIZON_MONTHS + 1):
            target = resid.shift(-h)
            ok = feats.notna().all(axis=1) & target.notna()
            if ok.sum() < self.MIN_TRAIN_ROWS:
                continue
            target_months = (feats.index.month[ok].values - 1 + h) % 12 + 1
            X = self._seasonal(feats[ok], target_months)
            self.models[h] = make_pipeline(StandardScaler(), RidgeCV(alphas=self.ALPHAS)).fit(X, target[ok].values)
        return self

    def predict(self, idx: pd.DatetimeIndex) -> np.ndarray:
        anomaly = np.zeros(len(idx))
        if self.origin_feats.notna().all(axis=1).iloc[0]:
            for i, month in enumerate(idx):
                h = (month.year - self.origin.year) * 12 + month.month - self.origin.month
                if h in self.models:
                    X = self._seasonal(self.origin_feats, np.array([month.month]))
                    anomaly[i] = self.models[h].predict(X)[0]
        return self.trend.predict(idx) + anomaly
