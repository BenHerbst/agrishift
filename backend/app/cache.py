"""Disk cache for finished forecasts.

Training every model for one location takes ~25 s. With this cache, a server restart or a second
server process reuses forecasts that were already computed instead of retraining.

An entry is only reused while everything it was built from is unchanged. Its key is a hash of
the *fingerprint*:
  * location and last observed month – a new month of data means a new forecast
  * the model code – a hash of the files that produce the numbers, so editing them invalidates
    every entry automatically
  * the inputs – climate models used, SEAS5 coverage, station corrections, latest climate-index
    month, Prophet on/off

Entries are JSON files in data_cache/forecasts/, written atomically. Only the newest
KEEP_PER_LOCATION entries per location are kept.
"""
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Optional

from .data import CACHE_DIR

FORECAST_DIR = CACHE_DIR / "forecasts"
KEEP_PER_LOCATION = 2
# Modules that only present or post-process a finished forecast – editing them keeps cached entries
_NOT_IN_FORECAST = {"__init__.py", "main.py", "cache.py", "risk.py", "soil.py", "pollution.py", "rotation.py",
                    "rotation_compare.py"}


def _code_version() -> str:
    """Hash of every module that produces forecast numbers, plus the model libraries' versions."""
    from importlib.metadata import PackageNotFoundError, version

    h = hashlib.sha256()
    for path in sorted(Path(__file__).resolve().parent.glob("*.py")):
        if path.name not in _NOT_IN_FORECAST:
            h.update(path.read_bytes())
    for package in ("numpy", "pandas", "scikit-learn", "statsmodels", "prophet", "scipy"):
        try:
            h.update(f"{package}={version(package)}".encode())
        except PackageNotFoundError:
            pass
    return h.hexdigest()[:12]


CODE_VERSION = _code_version()


def key(fingerprint: Dict) -> str:
    return hashlib.sha256(json.dumps(fingerprint, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _prefix(lat: float, lon: float) -> str:
    return f"{lat:.2f}_{lon:.2f}_"


def _path(lat: float, lon: float, fingerprint: Dict) -> Path:
    return FORECAST_DIR / f"{_prefix(lat, lon)}{key(fingerprint)}.json"


def load(lat: float, lon: float, fingerprint: Dict) -> Optional[Dict]:
    """The cached entry {"created", "fingerprint", "result"}, or None. Unreadable files are dropped."""
    path = _path(lat, lon, fingerprint)
    if not path.exists():
        return None
    try:
        entry = json.loads(path.read_text())
        entry["result"]  # noqa: B018 – validates the structure
        return entry
    except (ValueError, KeyError, OSError):
        path.unlink(missing_ok=True)
        return None


def save(lat: float, lon: float, fingerprint: Dict, result: Dict) -> Dict:
    FORECAST_DIR.mkdir(parents=True, exist_ok=True)
    entry = {"created": time.strftime("%Y-%m-%dT%H:%M:%S"), "fingerprint": fingerprint, "result": result}
    fd, tmp = tempfile.mkstemp(dir=FORECAST_DIR, suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(entry, f)
    os.replace(tmp, _path(lat, lon, fingerprint))  # atomic: readers never see half a file
    _prune(lat, lon)
    return entry


def _prune(lat: float, lon: float):
    files = sorted(FORECAST_DIR.glob(f"{_prefix(lat, lon)}*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[KEEP_PER_LOCATION:]:
        old.unlink(missing_ok=True)


def entries() -> List[Dict]:
    out = []
    for path in sorted(FORECAST_DIR.glob("*.json")) if FORECAST_DIR.exists() else []:
        try:
            entry = json.loads(path.read_text())
        except (ValueError, OSError):
            continue
        fp = entry.get("fingerprint", {})
        out.append({
            "latitude": fp.get("lat"),
            "longitude": fp.get("lon"),
            "trained_until": fp.get("trained_until"),
            "created": entry.get("created"),
            "current_code": fp.get("code") == CODE_VERSION,
            "size_kb": round(path.stat().st_size / 1024, 1),
            "file": path.name,
        })
    return out


def clear(lat: Optional[float] = None, lon: Optional[float] = None) -> int:
    if not FORECAST_DIR.exists():
        return 0
    pattern = f"{_prefix(lat, lon)}*.json" if lat is not None and lon is not None else "*.json"
    files = list(FORECAST_DIR.glob(pattern))
    for path in files:
        path.unlink(missing_ok=True)
    return len(files)
