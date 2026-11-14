# Terra Tuta – Backend: Agricultural Climate Forecasts

A FastAPI service that forecasts **monthly farming-relevant weather 1–3 years ahead** for any location on Earth.
It covers temperature, growing degree days, frost and heat days, rain, crop water demand, water balance and soil moisture.
It also gives **seasonal risk probabilities** (dry, wet, drought, hot and frost seasons) and the expected irrigation need.

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
8. [Optional: your own weather station](#optional-your-own-weather-station)
9. [Testing and hindcasts](#testing-and-hindcasts)
10. [Project structure](#project-structure)
11. [Configuration](#configuration)
12. [Limits and next steps](#limits-and-next-steps)
13. [Data licences and attribution](#data-licences-and-attribution)

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
After that, training takes about 25 s from the disk cache (Apple M4, all cores), and repeat requests return instantly from memory.

---

## API

| Endpoint | Description |
|---|---|
| `GET /variables` | All variables, units and why they matter for agriculture |
| `GET /history?lat=&lon=&start_year=2010&variables=precip,gdd` | Observed monthly values (station-calibrated if a station was uploaded) |
| `GET /forecast?lat=&lon=&years=3&variables=tmean,precip` | Monthly forecast with 80 % range, each model's value, backtest skill and model weights |
| `GET /agri-summary?lat=&lon=&years=3` | Per year: GDD, rain, ET0, water balance, frost/heat/wet days and root-zone moisture vs. the 1991–2020 normal, deficit months, frost-free months |
| `GET /risk?lat=&lon=&years=3` | Per season: probability of a dry / wet / drought / hot / frost season vs. normal odds and the last 15 years, plus irrigation need (typical, 1-in-5 and 1-in-10 year) |
| `POST /calibration?lat=&lon=` | Upload daily station data (CSV) to calibrate a location |
| `GET /calibration?lat=&lon=` | Show the corrections applied |
| `DELETE /calibration?lat=&lon=` | Remove station data |

Every forecast response has a `sources` block listing what was actually used: climate models, index dates, SEAS5, station calibration and Prophet.

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

All sources are free and cached on disk in `data_cache/`.

| Source | What | Used for |
|---|---|---|
| [Open-Meteo Historical API](https://open-meteo.com/en/docs/historical-weather-api) | ERA5 / ERA5-Land reanalysis, daily, 1980 → last full month, ~10–25 km | Training history for every variable |
| [Open-Meteo Climate API](https://open-meteo.com/en/docs/climate-api) | CMIP6 HighResMIP projections (EC-Earth3P-HR, MPI-ESM1.2-XR, MRI-AGCM3.2-S), 2000–2040 | Projected warming and drying per calendar month |
| NOAA CPC / NCEI | Monthly ENSO (Niño 3.4), NAO, PDO indices | `climate_drivers` model |
| [Copernicus CDS](https://cds.climate.copernicus.eu/datasets/seasonal-monthly-single-levels) *(optional)* | ECMWF SEAS5 seasonal forecasts, lead months 1–6, archive from 1993 | `seasonal_forecast` model |
| Your weather station *(optional)* | Daily CSV upload | Corrects the reanalysis toward local conditions |

**Open-Meteo rate limits:** on the free tier, a new location costs about 4,500 API calls (history plus 3 climate models).
The limits are 5,000 calls per hour and 10,000 per day, so expect about 2 new locations per day. Cached locations cost nothing.
For production, set `OPEN_METEO_API_KEY`.

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

1. Create a free account at https://cds.climate.copernicus.eu
2. Accept the dataset licences: on the [dataset page](https://cds.climate.copernicus.eu/datasets/seasonal-monthly-single-levels?tab=download), scroll to **Terms of use**
   (*CC-BY 4.0* and *Additional licence to use non-European contributions*)
3. Put your API token (profile page) in `~/.cdsapirc`:
   ```
   url: https://cds.climate.copernicus.eu/api
   key: <your-token>
   ```
4. Download the archive for a location. This runs outside the API because the CDS queue can take hours:
   ```bash
   python scripts/download_seas5.py --lat 50.78 --lon 6.08
   ```

The API only uses SEAS5 data that is already downloaded, so it never waits on the queue. The model joins the ensemble only once
forecasts exist for every backtest origin, so its weight is always learned from a fair test.

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

## Testing and hindcasts

```bash
python -m pytest                        # 12 offline tests on synthetic data, ~10 s, no internet needed

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
│   ├── main.py          FastAPI endpoints and caching
│   ├── data.py          Open-Meteo history and CMIP6, NOAA climate indices
│   ├── seasonal.py      Copernicus SEAS5 download, parsing and bias correction
│   ├── calibration.py   weather-station corrections
│   ├── features.py      agricultural indicators and monthly aggregation
│   ├── members.py       statistical / ML models (climatology … Prophet)
│   ├── projections.py   CMIP6 projection, anchored projection, SEAS5 model
│   ├── ensemble.py      rolling backtest, stacking weights, 80 % ranges
│   └── risk.py          seasonal risk probabilities and irrigation need
├── scripts/
│   ├── hindcast.py      accuracy test against real data
│   └── download_seas5.py
├── tests/               offline tests on synthetic weather
└── outputs/             hindcast results for Aachen and Lubbock
```

---

## Configuration

| Environment variable | Default | Effect |
|---|---|---|
| `OPEN_METEO_API_KEY` | unset | Use the commercial Open-Meteo endpoints (no free-tier limits) |
| `CMIP_MODELS` | `EC_Earth3P_HR,MPI_ESM1_2_XR,MRI_AGCM3_2_S` | Climate models for the projections (each new one costs about 1,100 API calls per location) |
| `USE_PROPHET` | `1` | `0` leaves Meta Prophet out of the ensemble |
| `CDSAPI_URL` / `CDSAPI_KEY` | from `~/.cdsapirc` | Copernicus credentials for SEAS5 |

---

## Limits and next steps

- **Rain is not predictable years ahead** in most climates. That's a limit of the atmosphere, not of the code. Use `/risk` and the 80 % ranges.
- **Cold bias:** see [Accuracy](#accuracy-tested-on-20202026). SEAS5 is the most promising fix for the first 6 months.
- **Uncertainty ranges** are slightly too narrow for wind (59 % in Texas) and topsoil moisture (about 66 %).
- **Crop-specific outputs** (sowing windows, frost after budburst, irrigation need with crop coefficients) are the natural next step.

---

## Data licences and attribution

- Weather and climate data by **[Open-Meteo.com](https://open-meteo.com/)** ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), based on ERA5 / ERA5-Land (Copernicus Climate Change Service) and CMIP6 HighResMIP.
- SEAS5: *Generated using Copernicus Climate Change Service information*. Neither the European Commission nor ECMWF is responsible for any use of this information.
- Climate indices: NOAA Climate Prediction Center and NCEI (public domain).
