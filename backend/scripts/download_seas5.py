"""Download and cache the ECMWF SEAS5 archive (1993 → now) for one location.

Runs outside the API because the Copernicus queue can take minutes to hours. Needs ~/.cdsapirc
(see README → "Seasonal forecasts").

    python scripts/download_seas5.py --lat 50.78 --lon 6.08
"""
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.seasonal import fetch_seasonal  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    frame, error = fetch_seasonal(args.lat, args.lon)
    if frame is not None:
        starts = frame.index.get_level_values("start")
        print(f"SEAS5 cached: {len(frame)} rows, forecast starts {starts.min():%Y-%m} – {starts.max():%Y-%m}")
    if error:
        print(f"Problems: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
