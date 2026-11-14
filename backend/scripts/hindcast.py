"""Hindcast: forecast from a past date using only data before it, then compare with what happened.

Consecutive 3-year windows are chained (e.g. 2020–22, 2023–25, 2026–), each trained only on data
before its own start – the way the system would have been used in real time. The ensemble runs
with the same configuration as the API, and every member is also scored on its own.

    python scripts/hindcast.py --lat 50.78 --lon 6.08 --start 2020-01 --name aachen

Writes outputs/hindcast_<name>_{monthly,scores,annual,risk}.csv and prints the tables.
"""
import argparse
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.data import fetch_climate_indices, fetch_daily, fetch_projections  # noqa: E402
from app.ensemble import forecast_location  # noqa: E402
from app.features import MONTHLY_VARIABLES, to_monthly  # noqa: E402
from app.members import MAX_HORIZON_MONTHS, PROPHET_AVAILABLE  # noqa: E402
from app.risk import SEASONS, _season_totals, event_occurred, seasonal_risk  # noqa: E402
from app.seasonal import fetch_seasonal  # noqa: E402

OUTPUT_DIR = ROOT / "outputs"
ANNUAL_KEYS = ["tmean", "precip", "gdd", "frost_days", "heat_days", "water_balance", "soil_moisture_root"]


def run_hindcast(lat: float, lon: float, start: str, use_prophet: bool):
    daily = fetch_daily(lat, lon)
    projections, cmip_models, cmip_errors = fetch_projections(lat, lon)
    indices = fetch_climate_indices()
    seasonal, _ = fetch_seasonal(lat, lon, download=False)
    print(f"Climate projections: {cmip_models or 'none'}" + (f" (errors: {cmip_errors})" if cmip_errors else ""))
    print(f"SEAS5: {'cached, used' if seasonal is not None else 'not downloaded, skipped'} | Prophet: {use_prophet}")
    actual = to_monthly(daily)
    season_actuals = {name: _season_totals(actual, months) for name, months in SEASONS.items()}

    rows, risk_rows = [], []
    window_start = pd.Timestamp(start)
    while window_start <= actual.index[-1]:
        train = daily[daily.index < window_start]
        print(f"Window from {window_start:%Y-%m}: trained on {train.index[0]:%Y-%m} – {train.index[-1]:%Y-%m}")
        result = forecast_location(train, projections, indices, use_prophet=use_prophet, seasonal=seasonal)

        for var, res in result["variables"].items():
            for r in res["forecast"]:
                month = pd.Timestamp(r["month"])
                if month in actual.index:
                    rows.append({
                        "window_start": f"{window_start:%Y-%m}", "month": month, "lead_months": r["lead_months"],
                        "variable": var, "ensemble": r["forecast"], "lower_80": r["lower_80"],
                        "upper_80": r["upper_80"], "actual": round(float(actual.at[month, var]), 3),
                        **{f"member:{m}": v for m, v in r["models"].items()},
                    })

        risk = seasonal_risk(train, {v: r["forecast"] for v, r in result["variables"].items()})
        for season in risk:
            totals = season_actuals[season["season_name"]]
            if season["season_year"] not in totals.index:
                continue  # season not observed yet
            for event, e in season["events"].items():
                value = totals.at[season["season_year"], e["variable"]]
                risk_rows.append({
                    "window_start": f"{window_start:%Y-%m}", "season": season["season"], "event": event,
                    "probability": e["probability"], "normal_probability": e["normal_probability"],
                    "occurred": bool(event_occurred([value], e["threshold"], e["rule"].split()[1])[0]),
                })
        window_start += pd.DateOffset(months=MAX_HORIZON_MONTHS)
    return pd.DataFrame(rows), pd.DataFrame(risk_rows)


def monthly_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Skill vs. climatology (> 0 = better than the 30-year average) for the ensemble and each member."""
    members = [c for c in df.columns if c.startswith("member:") and c != "member:climatology"]

    def score(g):
        clim = (g["member:climatology"] - g["actual"]).abs().mean()
        mae = (g["ensemble"] - g["actual"]).abs().mean()
        out = {
            "unit": MONTHLY_VARIABLES[g.name][1],
            "mae_climatology": clim,
            "mae_ensemble": mae,
            "skill_ensemble": 1 - mae / clim if clim > 0 else np.nan,
            "bias_ensemble": (g["ensemble"] - g["actual"]).mean(),
            "in_80%_range": ((g["actual"] >= g["lower_80"]) & (g["actual"] <= g["upper_80"])).mean(),
        }
        for m in members:
            scored = g.dropna(subset=[m])
            if len(scored):
                m_clim = (scored["member:climatology"] - scored["actual"]).abs().mean()
                out[f"skill_{m[7:]}"] = 1 - (scored[m] - scored["actual"]).abs().mean() / m_clim if m_clim > 0 else np.nan
        return pd.Series(out)

    return df.groupby("variable").apply(score).reindex(list(MONTHLY_VARIABLES))


def annual_comparison(df: pd.DataFrame) -> pd.DataFrame:
    df = df[df["variable"].isin(ANNUAL_KEYS)].assign(year=lambda d: d["month"].dt.year)
    full_years = df.groupby("year")["month"].nunique() == 12
    df = df[df["year"].isin(full_years[full_years].index)]
    out = []
    for (year, var), g in df.groupby(["year", "variable"]):
        agg = (lambda s: s.sum()) if MONTHLY_VARIABLES[var][0] == "sum" else (lambda s: s.mean())
        out.append({"year": year, "variable": var, "forecast": agg(g["ensemble"]),
                    "climatology": agg(g["member:climatology"]), "actual": agg(g["actual"])})
    return pd.DataFrame(out).pivot(index="year", columns="variable") if out else pd.DataFrame()


def risk_scores(risk: pd.DataFrame) -> pd.DataFrame:
    """Brier skill vs. the normal (1991–2020) odds: > 0 means the risk forecast was more useful."""
    def score(g):
        o = g["occurred"].astype(float)
        bs, bs_normal = ((g["probability"] - o) ** 2).mean(), ((g["normal_probability"] - o) ** 2).mean()
        return pd.Series({"seasons": len(g), "occurred": o.mean(), "mean_forecast_prob": g["probability"].mean(),
                          "mean_normal_prob": g["normal_probability"].mean(),
                          "brier_skill_vs_normal": 1 - bs / bs_normal if bs_normal > 0 else np.nan})
    table = risk.groupby("event").apply(score)
    table.loc["ALL"] = score(risk)
    return table


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--start", default="2020-01", help="First forecast month (YYYY-MM)")
    parser.add_argument("--name", default="location", help="Used in output file names")
    parser.add_argument("--no-prophet", action="store_true", help="Leave Prophet out (it is on in the API)")
    args = parser.parse_args()
    warnings.filterwarnings("ignore")
    pd.set_option("display.width", 250, "display.max_columns", 30)

    df, risk = run_hindcast(args.lat, args.lon, args.start, PROPHET_AVAILABLE and not args.no_prophet)
    OUTPUT_DIR.mkdir(exist_ok=True)
    df.to_csv(OUTPUT_DIR / f"hindcast_{args.name}_monthly.csv", index=False)

    scores = monthly_scores(df)
    scores.to_csv(OUTPUT_DIR / f"hindcast_{args.name}_scores.csv")
    print(f"\nMonthly accuracy {df['month'].min():%Y-%m} – {df['month'].max():%Y-%m} "
          "(skill > 0 = better than the 30-year average; in_80%_range should be ≈ 0.8)")
    print(scores.round(3).to_string())

    annual = annual_comparison(df)
    if not annual.empty:
        annual.to_csv(OUTPUT_DIR / f"hindcast_{args.name}_annual.csv")
        print("\nAnnual totals / means: forecast vs. 30-year average vs. what actually happened")
    for var in ANNUAL_KEYS:
        if ("actual", var) in annual:
            table = annual.xs(var, axis=1, level="variable")[["forecast", "climatology", "actual"]]
            print(f"\n{var} [{MONTHLY_VARIABLES[var][1]}]\n{table.round(3 if var == 'soil_moisture_root' else 1).to_string()}")

    if not risk.empty:
        risk.to_csv(OUTPUT_DIR / f"hindcast_{args.name}_risk.csv", index=False)
        print("\nRisk forecasts (/risk) vs. what happened (occurred ≈ mean_forecast_prob is well calibrated; "
              "brier_skill > 0 = better than normal odds)")
        print(risk_scores(risk).round(3).to_string())
    print(f"\nSaved CSVs to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
