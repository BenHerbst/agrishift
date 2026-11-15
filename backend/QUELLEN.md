# Quellen

Alle Datenquellen, wissenschaftlichen Methoden und Software, auf denen das Backend beruht.
Die Genauigkeitszahlen in der README (Hindcast 2020–2026 für Aachen und Lubbock) sind **eigene Auswertungen**
mit `scripts/hindcast.py`. Die Rohdaten dazu liegen in `outputs/`.

---

## 1. Daten

### Wetter-Historie (Trainingsdaten)

| Quelle | Wofür | Lizenz |
|---|---|---|
| **ERA5**: Hersbach, H. et al. (2020). The ERA5 global reanalysis. *Quarterly Journal of the Royal Meteorological Society*, 146(730), 1999–2049. https://doi.org/10.1002/qj.3803 | Reanalyse, aus der ERA5-Land hervorgeht (Temperatur, Niederschlag, Strahlung, Wind, Feuchte) | Copernicus-Lizenz |
| **ERA5-Land**: Muñoz-Sabater, J. et al. (2021). ERA5-Land: a state-of-the-art global reanalysis dataset for land applications. *Earth System Science Data*, 13, 4349–4383. https://doi.org/10.5194/essd-13-4349-2021 | Bodenfeuchte in drei Tiefen, feinere Auflösung (~9 km) | Copernicus-Lizenz |
| **ERA5-Land hourly time-series** (Copernicus Climate Data Store): https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land-timeseries | **Hauptquelle:** stündliche Punktzeitreihen direkt von Copernicus, daraus Tageswerte und ET0 | Copernicus-Lizenz |
| **NASA POWER**: https://power.larc.nasa.gov. *These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program.* | Ersatzquelle 1: tägliche Agrar-Wetterdaten ab 1984 | frei, Quellenangabe |
| Gelaro, R. et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2). *Journal of Climate*, 30, 5419–5454. https://doi.org/10.1175/JCLI-D-16-0758.1 | Reanalyse hinter NASA POWER | |

Reihenfolge: ERA5-Land von Copernicus → NASA POWER (siehe `app/sources.py`).

### Klimaprojektionen

**Hauptquelle: CMIP6 vom Copernicus Climate Data Store**

| Quelle | Wofür |
|---|---|
| Copernicus Climate Data Store, „CMIP6 climate projections“: https://cds.climate.copernicus.eu/datasets/projections-cmip6 | Monatliche Modelldaten, historischer Lauf + SSP2-4.5. Lizenz: *CMIP6 – Data Access – Terms of Use* |
| Eyring, V. et al. (2016). Overview of the Coupled Model Intercomparison Project Phase 6 (CMIP6) experimental design and organization. *Geoscientific Model Development*, 9, 1937–1958. https://doi.org/10.5194/gmd-9-1937-2016 | CMIP6 |
| O'Neill, B. C. et al. (2016). The Scenario Model Intercomparison Project (ScenarioMIP) for CMIP6. *Geoscientific Model Development*, 9, 3461–3482. https://doi.org/10.5194/gmd-9-3461-2016 | Szenario SSP2-4.5 |
| **MRI-ESM2.0**: Yukimoto, S. et al. (2019). The Meteorological Research Institute Earth System Model version 2.0, MRI-ESM2.0. *Journal of the Meteorological Society of Japan*, 97(5), 931–965. https://doi.org/10.2151/jmsj.2019-051 | Klimamodell 1 |
| **CNRM-CM6-1-HR**: Voldoire, A. et al. (2019). Evaluation of CMIP6 DECK experiments with CNRM-CM6-1. *Journal of Advances in Modeling Earth Systems*, 11, 2177–2213. https://doi.org/10.1029/2019MS001683 | Klimamodell 2 |
| **IPSL-CM6A-LR**: Boucher, O. et al. (2020). Presentation and evaluation of the IPSL-CM6A-LR climate model. *Journal of Advances in Modeling Earth Systems*, 12, e2019MS002010. https://doi.org/10.1029/2019MS002010 | Klimamodell 3 |

Sind die CMIP6-Daten für einen Ort noch nicht heruntergeladen, läuft die Prognose ohne das Klimamodell-Mitglied.

### Luftqualität und Verschmutzungsquellen (`/pollution`)

| Quelle | Wofür | Lizenz |
|---|---|---|
| **CAMS global reanalysis (EAC4)**, Copernicus Atmosphere Data Store: https://ads.atmosphere.copernicus.eu/datasets/cams-global-reanalysis-eac4 | Ozon (AOT40), NO₂, SO₂, PM2.5 am Boden, 3-stündlich | Copernicus-Lizenz |
| Inness, A. et al. (2019). The CAMS reanalysis of atmospheric composition. *Atmospheric Chemistry and Physics*, 19, 3515–3556. https://doi.org/10.5194/acp-19-3515-2019 | Zitierweise für EAC4 | |
| Richtlinie 2008/50/EG über Luftqualität und saubere Luft für Europa | AOT40-Zielwert und langfristiges Ziel, kritische Werte für die Vegetation (SO₂, NOx) | |
| **OpenStreetMap** über die Overpass API: https://overpass-api.de | Straßen, Bahnlinien, Industrie, Kraftwerke, Flughäfen, Deponien, Steinbrüche in der Umgebung | ODbL, © OpenStreetMap-Mitwirkende |

### Klimaindizes (Modell `climate_drivers`)

| Quelle | Wofür |
|---|---|
| NOAA Climate Prediction Center, monatliche Niño-Indizes: https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices | ENSO (El Niño / La Niña), Niño 3.4 |
| NOAA CPC, monatlicher NAO-Index: https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/norm.nao.monthly.b5001.current.ascii | Nordatlantische Oszillation |
| Barnston, A. G. & Livezey, R. E. (1987). Classification, seasonality and persistence of low-frequency atmospheric circulation patterns. *Monthly Weather Review*, 115, 1083–1126. https://doi.org/10.1175/1520-0493(1987)115<1083:CSAPOL>2.0.CO;2 | Methode hinter dem CPC-NAO-Index |
| NOAA NCEI, PDO-Index (ERSST v5): https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat | Pazifische Dekaden-Oszillation |
| Mantua, N. J. et al. (1997). A Pacific interdecadal climate oscillation with impacts on salmon production. *Bulletin of the American Meteorological Society*, 78, 1069–1079. https://doi.org/10.1175/1520-0477(1997)078<1069:APICOW>2.0.CO;2 | Definition der PDO |
| Huang, B. et al. (2017). Extended Reconstructed Sea Surface Temperature, Version 5 (ERSSTv5). *Journal of Climate*, 30, 8179–8205. https://doi.org/10.1175/JCLI-D-16-0836.1 | Meerestemperaturen hinter dem PDO-Index |

NOAA-Daten sind gemeinfrei (public domain).

### Saisonvorhersagen (optional, Modell `seasonal_forecast`)

| Quelle | Wofür | Lizenz |
|---|---|---|
| **Copernicus Climate Data Store**, „Seasonal forecast monthly statistics on single levels“: https://cds.climate.copernicus.eu/datasets/seasonal-monthly-single-levels, https://doi.org/10.24381/cds.68dd14c3 | Monatliche ECMWF-Saisonvorhersagen ab 1993 | CC BY 4.0 + „Additional licence to use non-European contributions“ |
| **SEAS5**: Johnson, S. J. et al. (2019). SEAS5: the new ECMWF seasonal forecast system. *Geoscientific Model Development*, 12, 1087–1117. https://doi.org/10.5194/gmd-12-1087-2019 | Beschreibung des Vorhersagemodells | |

Pflichthinweis: *Generated using Copernicus Climate Change Service information.* Weder die Europäische Kommission
noch das ECMWF sind für die Nutzung dieser Informationen verantwortlich.

### Boden

| Quelle | Wofür | Lizenz |
|---|---|---|
| **ISRIC SoilGrids 2.0**: https://soilgrids.org, Kartendienst (WCS): https://maps.isric.org | Ton, Sand, Schluff, organischer Kohlenstoff, pH, Lagerungsdichte, KAK, Skelettanteil, 0–100 cm | CC BY 4.0 |
| Poggio, L. et al. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. *SOIL*, 7, 217–240. https://doi.org/10.5194/soil-7-217-2021 | Methode und Zitierweise von SoilGrids | |
| Turek, M. E. et al. (2023). Global mapping of volumetric water retention at 100, 330 and 15 000 cm suction using the WoSIS database. *International Soil and Water Conservation Research*, 11(2), 225–239. https://doi.org/10.1016/j.iswcr.2022.08.001 | Wassergehalt bei Feldkapazität und Welkepunkt (SoilGrids-Schichten `wv0033`, `wv1500`) | |

---

## 2. Methoden

### Agrarmeteorologie und Boden

| Quelle | Wofür |
|---|---|
| Allen, R. G., Pereira, L. S., Raes, D. & Smith, M. (1998). *Crop evapotranspiration – Guidelines for computing crop water requirements*. FAO Irrigation and Drainage Paper 56. FAO, Rom. https://www.fao.org/3/x0490e/x0490e00.htm | Referenzverdunstung ET0, Kc-Werte, Bodenwasserbilanz (Bucket-Modell, TAW, RAW, p = 0,5) |
| McMaster, G. S. & Wilhelm, W. W. (1997). Growing degree-days: one equation, two interpretations. *Agricultural and Forest Meteorology*, 87, 291–300. https://doi.org/10.1016/S0168-1923(97)00027-0 | Wärmesummen (GDD, Basis 10 °C) |
| Saxton, K. E. & Rawls, W. J. (2006). Soil water characteristic estimates by texture and organic matter for hydrologic solutions. *Soil Science Society of America Journal*, 70(5), 1569–1578. https://doi.org/10.2136/sssaj2005.0117 | Feldkapazität und Welkepunkt, wenn SoilGrids keine Werte hat |
| Soil Science Division Staff (2017). *Soil Survey Manual*. USDA Handbook 18. https://www.nrcs.usda.gov/resources/guides-and-instructions/soil-survey-manual | Bodenartendreieck (USDA-Texturklassen) |

Die Umrechnung organischer Kohlenstoff → organische Substanz mit dem Faktor 1,724 (van-Bemmelen-Faktor) ist Standard in der Bodenkunde.
Die Schwellen für Frosttage (Tmin < 0 °C), Hitzetage (Tmax ≥ 30 °C) und Regentage (≥ 1 mm) sind gängige agrarmeteorologische Konventionen.

### Klima und Projektionen

| Quelle | Wofür |
|---|---|
| Hay, L. E., Wilby, R. L. & Leavesley, G. H. (2000). A comparison of delta change and downscaled GCM scenarios for three mountainous basins in the United States. *Journal of the American Water Resources Association*, 36(2), 387–397. https://doi.org/10.1111/j.1752-1688.2000.tb04276.x | Delta-Methode: beobachtetes Wetter um das Klimasignal verschieben (`climate_projection`, `seasonal_forecast`, `/risk`) |
| Vautard, R. et al. (2023). Heat extremes in Western Europe increasing faster than simulated due to atmospheric circulation trends. *Nature Communications*, 14, 6803. https://doi.org/10.1038/s41467-023-42143-3 | Beleg dafür, dass Westeuropa schneller wärmer wird als die Klimamodelle zeigen. Begründung für `projection_anchored` |

### Statistik und maschinelles Lernen

| Quelle | Wofür |
|---|---|
| Hyndman, R. J. & Athanasopoulos, G. (2021). *Forecasting: Principles and Practice* (3. Aufl.). OTexts. https://otexts.com/fpp3/ | Holt-Winters (exponentielle Glättung), Klimatologie- und Trendmodelle |
| Taylor, S. J. & Letham, B. (2018). Forecasting at scale. *The American Statistician*, 72(1), 37–45. https://doi.org/10.1080/00031305.2017.1380080 | Meta Prophet |
| Friedman, J. H. (2001). Greedy function approximation: a gradient boosting machine. *Annals of Statistics*, 29(5), 1189–1232. https://doi.org/10.1214/aos/1013203451 | Gradient Boosting (`boosted_anomaly`) |
| Hoerl, A. E. & Kennard, R. W. (1970). Ridge regression: biased estimation for nonorthogonal problems. *Technometrics*, 12(1), 55–67. https://doi.org/10.1080/00401706.1970.10488634 | Ridge-Regression (`climate_drivers`) |
| Wolpert, D. H. (1992). Stacked generalization. *Neural Networks*, 5(2), 241–259. https://doi.org/10.1016/S0893-6080(05)80023-1 | Stacking: Gewichtung der Modelle |
| Breiman, L. (1996). Stacked regressions. *Machine Learning*, 24, 49–64. https://doi.org/10.1007/BF00117832 | Gewichte ≥ 0 beim Stacking |
| Breiman, L. (1996). Bagging predictors. *Machine Learning*, 24, 123–140. https://doi.org/10.1007/BF00058655 | Bootstrap-Mittelung der Gewichte |
| Tashman, L. J. (2000). Out-of-sample tests of forecasting accuracy: an analysis and review. *International Journal of Forecasting*, 16(4), 437–450. https://doi.org/10.1016/S0169-2070(00)00065-0 | Rolling-Origin-Backtest |
| Vovk, V., Gammerman, A. & Shafer, G. (2005). *Algorithmic Learning in a Random World*. Springer. https://doi.org/10.1007/b106715 | Konforme Korrektur der 80-%-Spannen |
| Brier, G. W. (1950). Verification of forecasts expressed in terms of probability. *Monthly Weather Review*, 78(1), 1–3. https://doi.org/10.1175/1520-0493(1950)078<0001:VOFEIT>2.0.CO;2 | Brier-Score zur Bewertung der `/risk`-Wahrscheinlichkeiten |

---

## 3. Software

| Paket | Wofür | Link |
|---|---|---|
| FastAPI, Uvicorn | API-Server | https://fastapi.tiangolo.com |
| pandas, NumPy, SciPy | Datenverarbeitung, Optimierung der Gewichte | https://pandas.pydata.org, https://numpy.org, https://scipy.org |
| scikit-learn | Gradient Boosting, Ridge-Regression | https://scikit-learn.org |
| statsmodels | Holt-Winters | https://www.statsmodels.org |
| Prophet | Meta-Prophet-Modell | https://facebook.github.io/prophet/ |
| joblib | Parallelisierung auf alle Kerne | https://joblib.readthedocs.io |
| cdsapi, xarray, netCDF4 | Download und Lesen der SEAS5-Daten | https://github.com/ecmwf/cdsapi, https://xarray.dev |
| tifffile | Lesen der SoilGrids-Rasterdaten | https://github.com/cgohlke/tifffile |
| requests | HTTP-Abrufe | https://requests.readthedocs.io |
| pytest | Tests | https://pytest.org |
