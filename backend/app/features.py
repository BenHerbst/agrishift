"""Agricultural indicators derived from daily weather, aggregated to monthly series."""
import pandas as pd

GDD_BASE_C = 10.0       # base temperature for maize/soy/most warm-season crops
HEAT_STRESS_C = 30.0    # daily max above which many crops (wheat, maize at flowering) suffer
WET_DAY_MM = 1.0        # WMO convention for a "wet day"

# name -> (how to aggregate daily -> monthly, unit, agricultural meaning)
MONTHLY_VARIABLES = {
    "tmean": ("mean", "°C", "Mean temperature – drives crop development speed."),
    "tmax": ("mean", "°C", "Mean daily maximum – heat stress, evaporation demand."),
    "tmin": ("mean", "°C", "Mean daily minimum – frost risk, night respiration, chill accumulation."),
    "precip": ("sum", "mm", "Total precipitation – main water supply for rain-fed crops."),
    "et0": ("sum", "mm", "FAO-56 reference evapotranspiration – crop water demand (ETc = Kc × ET0)."),
    "water_balance": ("sum", "mm", "Precipitation minus ET0 – negative means irrigation need / drought."),
    "radiation": ("sum", "MJ/m²", "Solar radiation – photosynthesis and biomass potential."),
    "humidity": ("mean", "%", "Relative humidity – fungal disease pressure (blight, mildew, rust)."),
    "wind_max": ("mean", "km/h", "Mean daily max wind – lodging, spray windows, evaporation."),
    "soil_moisture": ("mean", "m³/m³", "Topsoil moisture 0–7 cm – germination, field access."),
    "soil_moisture_root": ("mean", "m³/m³", "Root-zone moisture 0–100 cm (depth-weighted) – water available to established crops."),
    "gdd": ("sum", "°C·day", f"Growing degree days (base {GDD_BASE_C:g} °C) – crop phenology / maturity timing."),
    "frost_days": ("sum", "days", "Days with Tmin < 0 °C – frost damage risk for blossoms and seedlings."),
    "heat_days": ("sum", "days", f"Days with Tmax ≥ {HEAT_STRESS_C:g} °C – heat stress, yield loss at flowering."),
    "wet_days": ("sum", "days", f"Days with ≥ {WET_DAY_MM:g} mm rain – field workability, disease, harvest windows."),
}

# Variables that are counts of days and must be clipped to [0, days in month] when forecasting
DAY_COUNT_VARIABLES = {"frost_days", "heat_days", "wet_days"}
NON_NEGATIVE_VARIABLES = DAY_COUNT_VARIABLES | {
    "precip", "et0", "radiation", "gdd", "humidity", "wind_max", "soil_moisture", "soil_moisture_root",
}


def add_daily_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    tavg = (df["tmax"] + df["tmin"]) / 2
    df["gdd"] = (tavg - GDD_BASE_C).clip(lower=0)
    df["frost_days"] = (df["tmin"] < 0).astype(int)
    df["heat_days"] = (df["tmax"] >= HEAT_STRESS_C).astype(int)
    df["wet_days"] = (df["precip"] >= WET_DAY_MM).astype(int)
    df["water_balance"] = df["precip"] - df["et0"]
    # Layer thicknesses 7 + 21 + 72 cm = 0–100 cm root zone
    df["soil_moisture_root"] = (
        7 * df["soil_moisture"] + 21 * df["soil_moisture_7_28"] + 72 * df["soil_moisture_28_100"]
    ) / 100
    return df


def to_monthly(daily: pd.DataFrame) -> pd.DataFrame:
    daily = add_daily_indicators(daily)
    agg = {name: how for name, (how, _, _) in MONTHLY_VARIABLES.items()}
    monthly = daily[list(agg)].resample("MS").agg(agg)
    # Drop a trailing partial month, if any
    days_present = daily["tmax"].resample("MS").count()
    complete = days_present == days_present.index.days_in_month
    return monthly[complete]
