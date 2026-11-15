# AgriShift – Backend: Agricultural Climate Forecasts

A FastAPI service that forecasts **monthly farming-relevant weather 1–3 years ahead** for any location on Earth.
It covers temperature, growing degree days, frost and heat days, rain, crop water demand, water balance and soil moisture.
It also gives **seasonal risk probabilities** (dry, wet, drought, hot and frost seasons), and it takes the **soil of the field** into account:
water storage, water stress for rain-fed crops and the irrigation need.

> **What this can and can't do:** day-to-day weather is chaotic, and nobody can forecast whether it rains on 14 June 2028.
> What *can* be estimated years ahead is the **expected monthly climate** (seasonal cycle, warming trend, slow climate drivers such as El Niño)
> and the **range of likely outcomes**. Every forecast comes with an out-of-sample backtest showing where it beats the plain 30-year average,
> and the results below are tested against what really happened in 2020–2026.

---

## Contents

1. [Quick start](#quick-start)
2. [API](#api)
3. [What is forecast](#what-is-forecast)
4. [Data sources](#data-sources)
5. [How it works](#how-it-works)
6. [Accuracy](#accuracy-tested-on-20202026)
7. [Optional: seasonal forecasts (ECMWF SEAS5)](#optional-seasonal-forecasts-ecmwf-seas5)
8. [Soil](#soil)
9. [Optional: your own weather station](#optional-your-own-weather-station)
10. [Caching](#caching)
11. [Testing and hindcasts](#testing-and-hindcasts)
12. [Project structure](#project-structure)
13. [Configuration](#configuration)
14. [Limits and next steps](#limits-and-next-steps)
15. [Data licences and attribution](#data-licences-and-attribution)

---

## Quick start

Requires Python 3.9+.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

uvicorn app.main:app --reload
```

Open the interactive API docs at **http://127.0.0.1:8000/docs**.

```bash
curl "http://127.0.0.1:8000/forecast?lat=50.78&lon=6.08&years=1&variables=tmean,precip"
```

**Timing:** the first request for a new location downloads about 45 years of data and trains all models, which takes about 1–2 minutes.
After that, the finished forecast is [cached](#caching) on disk and in memory, so later requests take about 0.05 s, even after a server restart.
It stays cached until a new month of data arrives.

---

## API

| Endpoint | Description |
|---|---|
| `GET /variables` | All variables, units and why they matter for agriculture |
| `GET /history?lat=&lon=&start_year=2010&variables=precip,gdd` | Observed monthly values (station-calibrated if a station was uploaded) |
| `GET /forecast?lat=&lon=&years=3&variables=tmean,precip` | Monthly forecast with 80 % range, each model's value, backtest skill and model weights |
| `GET /agri-summary?lat=&lon=&years=3` | Per year: GDD, rain, ET0, water balance, frost/heat/wet days and root-zone moisture vs. the 1991–2020 normal, deficit months, frost-free months |
| `GET /risk?lat=&lon=&years=3&root_depth_cm=100&kc=1.15` | Per season: probability of a dry / wet / drought / hot / frost / **water-stress** season vs. normal odds and the last 15 years, plus the **soil-aware irrigation need** (typical, 1-in-5 and 1-in-10 year) |
| `GET /soil?lat=&lon=&root_depth_cm=100&kc=1.0` | The soil at the field: texture, organic matter, pH, CEC, layers, **plant-available water**, plain-language notes, and stress days / irrigation need per year (1991–2020 vs. last 10 years) |
| `GET /rotation?lat=&lon=&years=3&history=winter_wheat,maize` | **Crop rotation:** one crop per forecast year from 13 field crops, scored on forecast warmth, water and heat, soil pH and storage, and nearby pollution, following rotation rules (family breaks, max. two cereal years, legumes before nitrogen-hungry crops, no wheat after maize) – with alternatives and why other crops are not possible |
| `GET /rotation/compare?lat=&lon=&history=&weights=erosion=2&rotations=a,b,c;d,e,f` | **Rotation scenarios side by side:** the `/rotation` plan, the best rotation per goal (climate fit, soil building, water saving, erosion control, forage, market, balanced) and your own rotations, each scored 0–100 on climate fit, nutrient cycling, organic matter, erosion risk, pest-cycle disruption, water use, forage potential and market, with the figures behind each score, rule violations, and what each gains or gives up against the `/rotation` plan |
| `GET /pollution?lat=&lon=` | **Crop safety from surrounding infrastructure:** nearest motorway, main road, railway, industry, power plant, airport, landfill and quarry (OpenStreetMap), air quality (CAMS reanalysis: ozone AOT40, NO₂, SO₂, PM2.5), a safe / caution / avoid verdict per crop group and what to do |
| `POST /calibration?lat=&lon=` | Upload daily station data (CSV) to calibrate a location |
| `GET /calibration?lat=&lon=` | Show the corrections applied |
| `DELETE /calibration?lat=&lon=` | Remove station data |
| `GET /cache` | Forecasts stored on disk, with their data month and whether they match the current model code |
| `DELETE /cache?lat=&lon=` | Delete cached forecasts for one location (or all, without parameters) |

`/forecast`, `/agri-summary`, `/risk` and `/rotation` take `refresh=true` to retrain even when a valid cached forecast exists.

Every forecast response has a `sources` block listing what was actually used (climate models, index dates, SEAS5, station calibration, Prophet)
and a `cache` block (`computed`, `disk` or `memory`, plus when the forecast was created).

**Example `/forecast` month:**

```json
{"month": "2027-07", "lead_months": 9, "forecast": 19.55, "lower_80": 18.1, "upper_80": 21.0,
 "models": {"climatology": 18.22, "projection_anchored": 19.4, "prophet": 19.3, "...": "..."}}
```

**Example `/risk` season:**

```json
{"season": "Jun–Aug 2027",
 "events": {"hot":     {"probability": 0.40, "normal_probability": 0.17, "observed_last_15_years": 0.44},
            "drought": {"probability": 0.30, "normal_probability": 0.20, "observed_last_15_years": 0.44}},
 "water_deficit_mm": {"typical": 129, "dry_year_1_in_5": 191, "extreme_1_in_10": 212, "normal_typical": 100}}
```

---

## What is forecast

| Variable | Unit | Why it matters |
|---|---|---|
| `tmean`, `tmax`, `tmin` | °C | Crop development speed, heat stress, frost risk, chill hours |
| `gdd` | °C·day | Growing degree days (base 10 °C): when crops reach flowering and maturity |
| `frost_days` | days | Tmin < 0 °C: damage to blossoms and seedlings, length of the growing season |
| `heat_days` | days | Tmax ≥ 30 °C: pollen sterility in maize and wheat at flowering, livestock stress |
| `precip` | mm | Water supply for rain-fed crops |
| `et0` | mm | FAO-56 reference evapotranspiration, i.e. crop water demand (ETc = Kc × ET0) |
| `water_balance` | mm | Rain − ET0: drought stress and irrigation need |
| `wet_days` | days | ≥ 1 mm rain: field workability, sowing and harvest windows, fungal disease |
| `radiation` | MJ/m² | Upper limit for photosynthesis and biomass |
| `humidity` | % | Disease pressure (blight, mildew, rust) |
| `wind_max` | km/h | Lodging, spraying windows, erosion |
| `soil_moisture` | m³/m³ | Topsoil 0–7 cm: germination, field access |
| `soil_moisture_root` | m³/m³ | Root zone 0–100 cm (depth-weighted): water for established crops |

---

## Data sources

All sources are free and cached on disk in `data_cache/`. Every response's `sources` block says which one was used.

**Weather history**, tried in this order (`WEATHER_SOURCES`):

| # | Source | Resolution / period | How it is loaded |
|---|---|---|---|
| 1 | [ERA5-Land](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land-timeseries) from the **Copernicus Climate Data Store** (hourly → local days, ET0 computed with FAO-56) | ~9 km, 1980 → ~6 days ago | `scripts/download_copernicus.py` (needs a Copernicus account). The API only reads the cache |
| 2 | [NASA POWER](https://power.larc.nasa.gov) (MERRA-2 / CERES, ET0 computed with FAO-56) | ~50 km, 1984 → ~7 days ago | On demand, in a few seconds, no key |

**Climate projections** (`PROJECTION_SOURCES`):

| # | Source | Models | How it is loaded |
|---|---|---|---|
| 1 | [CMIP6](https://cds.climate.copernicus.eu/datasets/projections-cmip6) from the **Copernicus Climate Data Store**, historical + SSP2-4.5, monthly | MRI-ESM2.0, CNRM-CM6-1-HR, IPSL-CM6A-LR | `scripts/download_copernicus.py`, per 5° region (shared by all locations in it) |

Not downloaded yet → the forecast runs without the climate-model member and is retrained once the projections arrive.

**Other sources:**

| Source | What | Used for |
|---|---|---|
| NOAA CPC / NCEI | Monthly ENSO (Niño 3.4), NAO, PDO indices | `climate_drivers` model |
| [ECMWF SEAS5](https://cds.climate.copernicus.eu/datasets/seasonal-monthly-single-levels) from Copernicus *(optional)* | Seasonal forecasts, lead months 1–6, archive from 1993 | `seasonal_forecast` model |
| [ISRIC SoilGrids 2.0](https://soilgrids.org) | Soil properties, 250 m, 0–100 cm | `/soil`, and soil water in `/risk` |
| Your weather station *(optional)* | Daily CSV upload | Corrects the weather history toward local conditions |

When ERA5-Land or CMIP6 arrive for a location, its forecasts are **retrained automatically**: the source is part of the cache fingerprint.
Run the download script monthly (e.g. from cron) to keep ERA5-Land and SEAS5 up to date.

### Copernicus account

1. Create a free account at https://cds.climate.copernicus.eu
2. Accept the licences of the datasets you use, on each dataset page under **Download → Terms of use**:
   ERA5-Land and CMIP6 (*CMIP6 – Data Access – Terms of Use*); for SEAS5, *CC-BY 4.0* and *Additional licence to use non-European contributions*.
   For air quality (`/pollution`), log in once at https://ads.atmosphere.copernicus.eu with the same account and
   accept its terms of use: the Atmosphere Data Store takes the same token.
3. Put your API token (profile page) in `~/.cdsapirc`:
   ```
   url: https://cds.climate.copernicus.eu/api
   key: <your-token>
   ```
4. Download a location:
   ```bash
   python scripts/download_copernicus.py --lat 50.84 --lon 6.13                  # era5land, cmip6, seas5 and cams
   python scripts/download_copernicus.py --lat 50.84 --lon 6.13 --only era5land   # just one of them
   ```

---

## How it works

```
daily reanalysis ──(optional station calibration)──► daily indicators (GDD, frost/heat/wet days, P − ET0, root zone)
                                                         │
                                                         ▼  monthly aggregation (~560 months × 15 variables)
   statistical / ML models            outside forecasts (delta method)
   ───────────────────────            ────────────────────────────────
   climatology   recent_climatology   climate_projection   (CMIP6 trend)
   trend_climatology   recent_trend   projection_anchored  (CMIP6 + observed level of the last 5 years)
   holt_winters   boosted_anomaly     seasonal_forecast    (ECMWF SEAS5, months 1–6, optional)
   climate_drivers (ENSO/NAO/PDO)
   prophet (Meta Prophet)
                                                         │
                                                         ▼
         rolling backtest (24 origins) → weights per lead time (1–6, 7–12, 13–36 months)
                                                         │
                                                         ▼
          forecast + 80 % range + each model's value + out-of-sample skill  →  /risk probabilities
```

### Models

| Model | Idea |
|---|---|
| `climatology` | Mean of the last 30 years per calendar month. This is the reference every forecast must beat |
| `recent_climatology` | Mean of the last 12 years. Follows the recent, warmer regime (heat days) |
| `trend_climatology` | Seasonal cycle plus linear trend over the whole history |
| `recent_trend` | The same, fitted on the last 25 years only (faster recent warming) |
| `holt_winters` | Damped additive exponential smoothing. Adapts to level shifts |
| `boosted_anomaly` | Gradient boosting on de-trended anomalies with 36/48/60-month lags |
| `climate_drivers` | One ridge regression per lead month on ENSO, NAO, PDO and the recent local anomaly (persistence, e.g. dry soil stays dry) |
| `prophet` | Meta Prophet: changepoint trend plus Fourier seasonality |
| `climate_projection` | The last 30 observed years shifted by the CMIP6 trend for each month, with every indicator recomputed from the shifted daily data |
| `projection_anchored` | The same projection moved to the level actually observed in the last 5 years. CMIP6 warms Western Europe about 3× too slowly (+0.24 vs. +0.76 °C/decade measured in Aachen since 2005) |
| `seasonal_forecast` | ECMWF SEAS5 (optional): its anomaly against its own 1993–2016 climate, applied to observed 1993–2016 weather, so SEAS5's biases cancel out |

### Ensemble

- **Rolling-origin backtest:** 24 forecast origins, 5 months apart, covering about 10 years and every season. Each one forecasts 36 months using only data before it.
- **Weights:** constrained least squares (weights ≥ 0, sum to 1), fitted separately for lead months 1–6, 7–12 and 13–36,
  and averaged over 30 bootstrap resamples of the origins. That's why ENSO can carry weight at 3 months and not at 30, and why the weights don't jump between similar models.
- **Out-of-sample skill:** the reported skill uses weights fitted on the *other* origins.
- **80 % range:** each calendar month's year-to-year spread, scaled so that 80 % of out-of-sample errors fall inside it
  (with a conformal finite-sample correction). If the recent half of the origins had larger errors, for example from faster warming, the range is set from them instead.
- **Risk (`/risk`):** the 30 observed seasons of 1991–2020 are shifted by the forecast and every indicator is recomputed.
  That gives 30 plausible outcomes per season, and the probability is the share beyond a threshold set from 1991–2020 (e.g. the driest 20 %).

---

## Accuracy (tested on 2020–2026)

`scripts/hindcast.py` forecasts consecutive 3-year windows (2020–22, 2023–25, 2026) using only data from before each window,
then compares the forecasts with what actually happened. Skill = how much smaller the error is than the 30-year average (> 0 is better).
Configuration: the defaults used by the API (with Prophet, without SEAS5). The full results are in `outputs/`.

### Monthly forecasts

| Variable | Aachen, Germany | Lubbock, Texas (cotton belt) |
|---|---|---|
| Max temperature | **+17.3 %** | **+13.0 %** |
| Mean temperature | **+16.7 %** | **+10.9 %** |
| Min temperature | **+17.0 %** | +5.4 % |
| Growing degree days | **+11.5 %** | **+9.9 %** |
| ET0 (crop water demand) | **+11.8 %** | +4.7 % |
| Radiation | **+12.8 %** | +5.1 % |
| Frost days | +9.2 % | +0.6 % |
| Topsoil moisture | +7.4 % | **+12.6 %** |
| Root-zone moisture | +6.4 % | −10.7 % |
| Precipitation | −0.8 % | +8.6 % |
| Water balance | +0.1 % | +9.0 % |
| Heat days | −10.3 % | +3.8 % |
| Humidity, wind, wet days | about 0 % | −3 to +9 % |
| **Share of real months inside the 80 % range** | **78 %** | **77 %** |

### Risk probabilities (Brier skill vs. the normal 1991–2020 odds)

| | Aachen | Lubbock |
|---|---|---|
| All events | +3.8 % | **+12.9 %** |
| Hot seasons: forecast probability vs. how often they happened | 15 % vs. 35 % | 28 % vs. 62 % |

### What that means

- **Useful:** temperature, growing season (GDD), frost, crop water demand (ET0) and the uncertainty ranges.
- **Useful as probabilities only:** rain, drought and wet seasons. Treat the forecast as "an average year, with this range".
  In semi-arid Texas there is some real rain and drought skill. In Western Europe there is none.
- **Known bias:** forecasts are still about **0.5 °C too cold** and **underestimate hot seasons**, because the 2020s have been warmer than any past trend predicted.
  The anchored projection reduced the heat-day bias in Aachen from −4.5 to −1.9 days per year, but made monthly heat-day errors larger.
- **Small sample:** 82 months and about 24 seasons per location. Expect the scores to move by a few percentage points with more test data.

---

## Optional: seasonal forecasts (ECMWF SEAS5)

SEAS5 is a physical ocean–atmosphere model started from the observed state every month. It is expected to help mostly in months 1–6.
Set up the [Copernicus account](#copernicus-account), then run `python scripts/download_copernicus.py --lat … --lon … --only seas5`.

The API only uses SEAS5 data that is already downloaded, so it never waits on the queue. The model joins the ensemble only once
forecasts exist for every backtest origin, so its weight is always learned from a fair test.

---

## Soil

The soil decides how long crops can bridge a dry spell, so the same weather means very different water stress on sand and on loess.

**Where the data comes from:** ISRIC SoilGrids 2.0, at 250 m resolution worldwide. It is read through the SoilGrids map service (WCS), because the
SoilGrids point API currently returns no data. For each property and layer, the median of the soil pixels within about 1 km is used.
Towns, roads and water have no soil data, so the search widens to about 3 and then 6 km. The radius used is in the response.
**Give the coordinates of the actual field:** a point in a town picks up soil from parks or forest at its edge.

**What is derived:**
- **Texture class** (USDA soil triangle), organic matter (= organic carbon × 1.724), pH, CEC and bulk density of the topsoil (0–30 cm)
- **Total available water (TAW)** in the root zone: Σ (field capacity − wilting point) × (1 − gravel) × layer thickness.
  It uses SoilGrids' own water-retention layers, or the Saxton & Rawls (2006) pedotransfer functions where those are missing.
- **Notes:** water storage, drainage and workability (clay), leaching (sand), liming need (pH), low organic matter, low CEC

**Soil water balance (FAO-56, daily):** the root zone is a bucket of size TAW. Rain fills it and crop evapotranspiration (Kc × ET0) empties it.
Once the depletion passes RAW = 0.5 × TAW the crop is under water stress, and actual ET drops. The irrigated run refills the bucket at that point,
and the sum of those refills is the irrigation need.

**What this changes:**

| | Aachen (silt loam) | Lubbock, Texas (sandy clay loam) |
|---|---|---|
| Plant-available water, 0–100 cm | 156 mm (high) | 120 mm (medium) |
| Irrigation need per year with soil storage, 1991–2020 (Kc 1.0, all year) | **178 mm** (last 10 years: 265 mm) | 1,414 mm |
| The same, ignoring the soil (Σ ET0 − rain) | 476 mm | 1,613 mm |

**In `/risk`:**
- Every one of the 30 outcomes per season runs through the water balance and starts from the soil moisture that year actually had on that date.
- **The first forecast season starts from today's soil moisture**, carried through the months in between with each year's weather, so a dry soil now raises the risk.
- Set `root_depth_cm` and `kc` for your crop, for example lettuce 30 cm / 1.0, potato 50 cm / 1.15, wheat or maize 100 cm / 1.15 mid-season.
  Kc is applied to every season, so only read the seasons your crop is actually in the field.

---

## Optional: your own weather station

Reanalysis smooths out valleys, slopes, frost hollows and local rain. If you upload daily station data, a correction is learned
for each calendar month and applied to the whole history before training. It is additive for temperature, humidity, wind and soil, and multiplicative for rain, ET0 and radiation.

```csv
date,tmax,tmin,precip
2015-01-01,4.2,-1.3,0.0
2015-01-02,5.0,0.4,3.2
```

```bash
curl -X POST "http://127.0.0.1:8000/calibration?lat=50.78&lon=6.08" -F "file=@station.csv"
```

Possible columns are `tmax, tmin, tmean, precip, et0, radiation, humidity, wind_max, soil_moisture, soil_moisture_7_28, soil_moisture_28_100`.
Each column needs at least 365 days that overlap 1980 → today.

---

## Caching

Downloaded data and finished forecasts are both cached, so nothing is downloaded or trained twice.

| What | Where | Valid until |
|---|---|---|
| Weather history (ERA5-Land, NASA POWER), CMIP6, SEAS5 | `data_cache/era5land/`, `nasa_power/`, `cmip6/`, `seas5/` | Forever. Only new days or missing columns are downloaded |
| Climate indices (ENSO/NAO/PDO) | `data_cache/climate_indices.csv` | Re-downloaded after 3 days |
| Soil (SoilGrids) | `data_cache/soil/*.json` | Forever (soil doesn't change) |
| Pollution sources (OpenStreetMap) | `data_cache/pollution/*.json` | Forever (delete to refresh) |
| Air quality (CAMS reanalysis summary per year) | `data_cache/cams/*.json` | Forever; `download_copernicus.py --only cams` adds a newer year |
| **Finished forecasts** | `data_cache/forecasts/*.json` + memory (32 most recent) | **As long as nothing they depend on changes** |

A forecast is only reused if all of these are unchanged:
- the location
- the **last data month** (a new month means a new forecast)
- the **model code** (a hash of the model files, so editing them invalidates old entries automatically)
- the inputs: climate models used, SEAS5 coverage, station calibration, latest climate-index month, Prophet on/off

Files are written atomically, unreadable files are recomputed, and only the newest 2 entries per location are kept (about 220 KB each).
Forecasts built with incomplete climate data (some projection files unreadable) are never cached.

Pre-compute forecasts, for example after the start of a month or before a demo:

```bash
python scripts/warm_cache.py --location 50.78,6.08 --location 33.58,-101.85
```

---

## Testing and hindcasts

```bash
python -m pytest                        # 36 offline tests on synthetic data, ~35 s, no internet needed

python scripts/hindcast.py --lat 50.78 --lon 6.08 --start 2020-01 --name aachen
```

The hindcast prints and saves (in `outputs/`):
- monthly skill for the ensemble and **each model on its own**
- bias and the share of months inside the 80 % range
- annual forecast vs. normal vs. actual
- Brier skill of the `/risk` probabilities

---

## Project structure

```
backend/
├── README.md
├── requirements.txt
├── pytest.ini
├── app/
│   ├── main.py          FastAPI endpoints
│   ├── cache.py         disk cache for finished forecasts
│   ├── sources.py       which source is used: primary sources with automatic fallback
│   ├── era5land.py      ERA5-Land history from Copernicus
│   ├── nasa_power.py    NASA POWER history
│   ├── cmip6.py         CMIP6 projections from Copernicus
│   ├── et0.py           FAO-56 Penman-Monteith ET0
│   ├── data.py          shared daily columns, NOAA climate indices
│   ├── seasonal.py      Copernicus SEAS5 download, parsing and bias correction
│   ├── calibration.py   weather-station corrections
│   ├── features.py      agricultural indicators and monthly aggregation
│   ├── soil.py          SoilGrids soil profile, available water, FAO-56 soil water balance
│   ├── members.py       statistical / ML models (climatology … Prophet)
│   ├── projections.py   CMIP6 projection, anchored projection, SEAS5 model
│   ├── ensemble.py      rolling backtest, stacking weights, 80 % ranges
│   └── risk.py          seasonal risk probabilities and irrigation need
├── scripts/
│   ├── hindcast.py      accuracy test against real data
│   ├── download_copernicus.py   ERA5-Land, CMIP6 and SEAS5 download / monthly update
│   └── warm_cache.py    pre-compute forecasts
├── tests/               offline tests on synthetic weather
└── outputs/             hindcast results for Aachen and Lubbock
```

---

## Configuration

| Environment variable | Default | Effect |
|---|---|---|
| `WEATHER_SOURCES` | `era5land,nasa_power` | Weather sources in fallback order |
| `PROJECTION_SOURCES` | `cds_cmip6` | Projection sources in fallback order |
| `CDS_CMIP6_MODELS` | `mri_esm2_0,cnrm_cm6_1_hr,ipsl_cm6a_lr` | CMIP6 models from Copernicus |
| `CDS_CMIP6_SCENARIO` | `ssp2_4_5` | CMIP6 scenario (e.g. `ssp5_8_5`) |
| `USE_PROPHET` | `1` | `0` leaves Meta Prophet out of the ensemble |
| `CDSAPI_URL` / `CDSAPI_KEY` | from `~/.cdsapirc` | Copernicus credentials (ERA5-Land, CMIP6, SEAS5; the key also for CAMS) |

---

## Limits and next steps

- **Rain is not predictable years ahead** in most climates. That's a limit of the atmosphere, not of the code. Use `/risk` and the 80 % ranges.
- **Cold bias:** see [Accuracy](#accuracy-tested-on-20202026). SEAS5 is the most promising fix for the first 6 months.
- **Uncertainty ranges** are slightly too narrow for wind (59 % in Texas) and topsoil moisture (about 66 %).
- **Soil water balance** ignores runoff, capillary rise and groundwater, and uses one Kc for the whole year. SoilGrids is a 250 m model map, so a soil sample from the field is better.
- **Crop-specific outputs** (crop calendar with Kc per growth stage, sowing windows, frost after budburst) are the natural next step.

---

## Data licences and attribution

All sources (data, scientific methods, software) with full citations: **[QUELLEN.md](QUELLEN.md)**.


- ERA5-Land and CMIP6: *Generated using Copernicus Climate Change Service information*.
- NASA POWER: *These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program.*
- Air quality: *Generated using Copernicus Atmosphere Monitoring Service information* (CAMS reanalysis EAC4).
- Pollution sources: © OpenStreetMap contributors ([ODbL](https://opendatacommons.org/licenses/odbl/)).
- SEAS5: *Generated using Copernicus Climate Change Service information*. Neither the European Commission nor ECMWF is responsible for any use of this information.
- Climate indices: NOAA Climate Prediction Center and NCEI (public domain).
- Soil: ISRIC SoilGrids 2.0 ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), Poggio et al. (2021), *SOIL* 7, 217–240.
