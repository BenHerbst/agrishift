# Terra Tuta

Farm-site climate analysis: pick a location or draw a field, see 1990–2025 NASA POWER climate trends,
ISRIC soil data, crop-rotation options, and a **1–3 year ensemble forecast with seasonal risk** from the
Terra Tuta forecast backend.

```
frontend/   React + Vite app, served by an Express server (server.ts) on :3000
backend/    FastAPI forecast service on :8000 (see backend/README.md)
```

## Run it

Two terminals.

**1. Backend**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://127.0.0.1:8000/docs
```

**2. Frontend**

```bash
cd frontend
bun install                            # or: npm install --legacy-peer-deps
bun run dev                            # http://localhost:3000
```

The frontend's Express server proxies `/api/climate/*` to the backend, so the browser only ever talks to
port 3000.

> **First request for a new location takes 1–2 minutes.** The backend downloads ~40 years of NASA POWER
> weather and trains every model. The app shows the measured record meanwhile and switches to the forecast
> once it arrives. Repeat visits to the same location are instant. For the best data (ERA5-Land, CMIP6
> projections, CAMS air quality) run `backend/scripts/download_copernicus.py` for the location once.

## Before a demo

With frontend and backend running, warm every cache the example regions use (NASA POWER point and
regional grids, SoilGrids, forecast training, soil, crop rotation, OpenStreetMap pollution check):

```bash
cd frontend
npm run warm                     # all example regions, ~4 min the first time, seconds afterwards
npm run warm -- 50.88,6.31       # add your own sites as lat,lon
```

Fields saved under **My fields** reopen with the same requests, so a saved and warmed field also loads
instantly. Drawing a brand-new field during a demo waits on SoilGrids (5–20 s) and trains a forecast for its
centre (~30 s); the app stays usable meanwhile.

## How the data fits together

| Where in the app | Data | Source |
|---|---|---|
| Trend chart, timeline, KPI chips (1990–2025) | Monthly T2M, precipitation, root-zone moisture, ET | NASA POWER |
| Map climate layers | Monthly T2M, precipitation, root-zone moisture on the MERRA-2 grid | NASA POWER regional |
| Map satellite layers (follow the timeline) | MODIS NDVI 250 m, MODIS land surface temperature, SMAP root-zone soil moisture | NASA GIBS |
| **Data sources** panel | Every request made for the site, with status and a link to the raw API call | — |
| Soil card, rotation scoring | pH, organic carbon, texture (0–30 cm) | ISRIC SoilGrids |
| Trend chart & timeline, **Ensemble Forecast** mode | Monthly forecast with 80 % range, 1–3 years | Backend `/forecast`, `/history` |
| **Forecast & Risk** tab | Yearly farming indicators vs. 1991–2020 normal | Backend `/agri-summary` |
| **Forecast & Risk** tab | Per-season odds of dry / wet / drought / hot / frost, irrigation need | Backend `/risk` |

The backend forecasts ERA5 variables in its own units (mm/month, volumetric soil moisture, FAO-56 ET0).
The frontend maps them onto the NASA POWER series with the **delta method**: the forecast anomaly against
the backend's 1991–2020 normal is applied to the NASA POWER 1991–2020 normal for the same calendar month,
so the forecast continues the NASA curve without a jump. The code is in
`frontend/src/utils/ensembleForecast.ts`.

| NASA POWER series | Backend variable | Mapping | Why (Aachen, summers 1991–2025) |
|---|---|---|---|
| T2M | `tmean` | additive anomaly | correlation 0.96, same variability |
| PRECTOTCORR | `precip` | ratio anomaly | correlation 0.95, same relative variability |
| GWETROOT | `soil_moisture_root` | standardized anomaly | correlation 0.43, ERA5 swings ~1.3× more |
| EVLAND | none | recent 15-year NASA climatology | ET0 is demand, EVLAND is actual ET; they are anti-correlated in dry summers |

If the backend is down, the app keeps working: the Ensemble Forecast mode falls back to the trend
extension and the Forecast & Risk tab shows a retry button.

## Configuration

| Variable | Where | Default | Effect |
|---|---|---|---|
| `BACKEND_URL` | frontend server | `http://127.0.0.1:8000` | Where `/api/climate/*` is proxied to |
| `BACKEND_TIMEOUT_MS` | frontend server | `240000` | Proxy timeout (first-time training is slow) |
| `VITE_CLIMATE_API_BASE` | frontend build | `/api/climate` | Call the backend directly instead of via the proxy |
| `CORS_ORIGINS` | backend | `*` | Comma-separated allowed origins for direct browser access |
| `GEMINI_API_KEY` | frontend server | unset | Optional AI-written site summary |

Backend options (Prophet, SEAS5, Copernicus downloads, station calibration) are in `backend/README.md`.
