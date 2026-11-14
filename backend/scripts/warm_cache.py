"""Pre-compute forecasts so the first API request for a location is instant.

Useful after the start of a month (new data → the cached forecasts expire) or before a demo.
Already valid forecasts are skipped unless --refresh is given.

    python scripts/warm_cache.py --location 50.78,6.08 --location 33.58,-101.85
"""
import argparse
import sys
import time
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import _key, _location  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--location", action="append", required=True, metavar="LAT,LON")
    parser.add_argument("--refresh", action="store_true", help="Retrain even if a valid cached forecast exists")
    args = parser.parse_args()
    warnings.filterwarnings("ignore")

    failed = 0
    for loc in args.location:
        lat, lon = _key(*map(float, loc.split(",")))
        start = time.time()
        try:
            result, info = _location(lat, lon, args.refresh)
            print(f"{lat:7.2f},{lon:8.2f}  trained until {result['trained_until']}  {info['status']:8s}  "
                  f"{time.time() - start:5.1f}s")
        except Exception as exc:
            failed += 1
            print(f"{lat:7.2f},{lon:8.2f}  FAILED: {exc}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
