"""Download / update the Copernicus data for a location (runs outside the API – the CDS queue can be slow).

  era5land – ERA5-Land daily weather history 1980 → ~6 days ago (first run: 5 requests of 10 years;
             later runs only fetch the new days – run this monthly, e.g. from cron)
  cmip6    – CMIP6 projections, 3 models × 2 periods × 8 variables for the 5° region (cached forever)
  seas5    – ECMWF SEAS5 seasonal-forecast archive 1993 → now (new forecast every month)
  cams     – CAMS air-quality reanalysis, last full year, for /pollution (Atmosphere Data Store: same
             account, accept its terms once at https://ads.atmosphere.copernicus.eu)

Needs ~/.cdsapirc (README → "Copernicus account"). Afterwards the API uses the data automatically and
retrains the forecasts that depend on it.

    python scripts/download_copernicus.py --lat 50.84 --lon 6.13
    python scripts/download_copernicus.py --lat 50.84 --lon 6.13 --only era5land
"""
import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import cmip6, era5land  # noqa: E402
from app.pollution import download_air_quality  # noqa: E402
from app.seasonal import cds_configured, fetch_seasonal  # noqa: E402

DATASETS = ("era5land", "cmip6", "seas5", "cams")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--only", default=",".join(DATASETS), help=f"Comma-separated subset of {DATASETS}")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    if not cds_configured():
        sys.exit("No Copernicus credentials – see README → 'Copernicus account'.")

    failed = False
    for name in args.only.split(","):
        start = time.time()
        try:
            if name == "era5land":
                daily = era5land.update(args.lat, args.lon)
                print(f"era5land: {daily.index[0]:%Y-%m-%d} – {daily.index[-1]:%Y-%m-%d} ({len(daily)} days)", end="")
            elif name == "cmip6":
                errors = cmip6.download(args.lat, args.lon)
                frame, models = cmip6.read_projections(args.lat, args.lon)
                print(f"cmip6: models {models}, {len(frame) if frame is not None else 0} months", end="")
                if errors:
                    print(f"\n  not available: {errors}", end="")
            elif name == "seas5":
                frame, error = fetch_seasonal(args.lat, args.lon)
                print(f"seas5: {0 if frame is None else len(frame)} forecast months", end="")
                if error:
                    failed = True
                    print(f"\n  problems: {error}", end="")
            elif name == "cams":
                air = download_air_quality(args.lat, args.lon)
                print(f"cams: {air['year']}, ozone AOT40 {air['ozone_aot40_may_jul_ug_m3_h']} µg/m³·h", end="")
            else:
                raise ValueError(f"unknown dataset {name!r}")
            print(f"  [{time.time() - start:.0f}s]")
        except Exception as exc:
            failed = True
            print(f"{name}: FAILED – {exc}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
