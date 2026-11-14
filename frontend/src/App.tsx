import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeaderBar } from './components/HeaderBar';
import {
  GlobalTimelineBar,
  type TimelineStepIncrement,
} from './components/GlobalTimelineBar';
import { LocationOnboarding } from './components/LocationOnboarding';
import { GeospatialMap } from './components/GeospatialMap';
import { RightDataPanel, type RightPanelTab } from './components/RightDataPanel';
import { LegalPage, type LegalRoute } from './components/LegalPage';
import { CookieBanner } from './components/CookieBanner';
import { computeMonthlyClimatology, PRESET_REGIONS } from './data/presets';
import { useI18n } from './i18n/I18nContext';
import {
  BASELINE_CROP_TEXT,
  MONTH_SHORT_BY_LANG,
  localizeRegionName,
} from './i18n/translations';
import {
  fetchEarthSystemData,
  fetchFieldAverageEarthSystemData,
} from './services/earthDataService';
import { fetchClimateForecast } from './services/climateForecastService';
import {
  analyzeClimateSeries,
  buildForecastSeries,
  evaluateAgronomicThreshold,
  extendAndSliceMonthlyRecords,
  DISPLAY_START_YEAR,
} from './utils/statistics';
import { buildEnsembleMonthlyRecords, ensembleHorizon } from './utils/ensembleForecast';
import { generateRotationScenarios } from './utils/rotationEngine';
import {
  exportSiteGeoJson,
  exportSitePdfReport,
  exportTimeSeriesCsv,
} from './utils/exportUtils';
import type {
  AgroBriefingRequest,
  AgroBriefingResponse,
  BaselineCropId,
  ClimateForecastDataset,
  ClimateVariable,
  DrawnFieldPolygon,
  EarthSystemDataset,
  FarmerPriorities,
  ForecastLoadStatus,
  ForecastMode,
  PresetRegion,
  SeasonalWindow,
  TrendStatistics,
} from './types/terrashift';

const DEFAULT_PRESET = PRESET_REGIONS[0];
// Timeline step 0 = Jan of DISPLAY_START_YEAR (2000)
const BASE_TIMELINE_YEAR = DISPLAY_START_YEAR;
const MAX_HIST_STEP = (2025 - BASE_TIMELINE_YEAR) * 12 + 11; // Dec 2025
const MAX_PROJ_STEP = (2035 - BASE_TIMELINE_YEAR) * 12 + 11; // Dec 2035

function parseLegalRoute(pathname: string): LegalRoute | null {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (normalized === '/impressum' || normalized === '/imprint') {
    return '/impressum';
  }
  if (normalized === '/datenschutz' || normalized === '/privacy') {
    return '/datenschutz';
  }
  if (normalized === '/cookies') {
    return '/cookies';
  }
  return null;
}

export default function App() {
  const { lang, t } = useI18n();
  const [hasSelectedLocation, setHasSelectedLocation] = useState<boolean>(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number; label?: string }>({
    lat: DEFAULT_PRESET.lat,
    lon: DEFAULT_PRESET.lon,
    label: DEFAULT_PRESET.name,
  });
  const [drawnField, setDrawnField] = useState<DrawnFieldPolygon | null>(null);
  const [dataset, setDataset] = useState<EarthSystemDataset | null>(null);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);

  // Terra Tuta forecast backend (ensemble forecast 1–3 years, agri summary, seasonal risk)
  const [forecastDataset, setForecastDataset] = useState<ClimateForecastDataset | null>(null);
  const [forecastStatus, setForecastStatus] = useState<ForecastLoadStatus>('idle');
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [forecastRetryToken, setForecastRetryToken] = useState<number>(0);

  const [activeTab, setActiveTab] = useState<RightPanelTab>('trends');
  const [selectedVariable, setSelectedVariable] = useState<ClimateVariable>('T2M');
  const [seasonalWindow, setSeasonalWindow] = useState<SeasonalWindow>('summer_jja');
  // The backend ensemble is the default outlook; the statistical extrapolations stay selectable.
  const [forecastMode, setForecastMode] = useState<ForecastMode>('ensemble');

  // Backend forecast months expressed in NASA POWER units (delta method), or null until loaded
  const ensembleRecords = useMemo(
    () =>
      forecastDataset && dataset
        ? buildEnsembleMonthlyRecords(forecastDataset, dataset.recordsByVariable)
        : null,
    [forecastDataset, dataset]
  );
  const ensembleEnd = useMemo(() => ensembleHorizon(ensembleRecords), [ensembleRecords]);

  // What the chart/timeline actually show: while the ensemble is loading, fall back to the
  // measured record; if the backend is unavailable, fall back to the trend extension.
  const effectiveForecastMode: ForecastMode =
    forecastMode === 'ensemble' && !ensembleRecords
      ? forecastStatus === 'error'
        ? 'sens_slope'
        : 'historical'
      : forecastMode;

  const maxTimelineStep =
    effectiveForecastMode === 'historical'
      ? MAX_HIST_STEP
      : effectiveForecastMode === 'ensemble' && ensembleEnd
      ? Math.max(MAX_HIST_STEP, (ensembleEnd.year - BASE_TIMELINE_YEAR) * 12 + (ensembleEnd.month - 1))
      : MAX_PROJ_STEP;
  const [timelineStep, setTimelineStep] = useState<number>(MAX_PROJ_STEP);
  const [isTimelinePlaying, setIsTimelinePlaying] = useState<boolean>(false);
  const [timelineStepIncrement, setTimelineStepIncrement] = useState<TimelineStepIncrement>(1);
  const prevMaxStepRef = useRef<number>(maxTimelineStep);

  const [baselineCrop, setBaselineCrop] = useState<BaselineCropId>(
    DEFAULT_PRESET.defaultBaselineCrop
  );
  const [priorities, setPriorities] = useState<FarmerPriorities>({
    water: 80,
    nitrogen: 70,
    erosion: 75,
    profit: 65,
  });

  const handlePriorityChange = (key: keyof FarmerPriorities, value: number) => {
    setPriorities((prev) => ({ ...prev, [key]: value }));
  };

  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiBriefing, setAiBriefing] = useState<AgroBriefingResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [legalRoute, setLegalRoute] = useState<LegalRoute | null>(() =>
    typeof window !== 'undefined' ? parseLegalRoute(window.location.pathname) : null
  );

  useEffect(() => {
    const handlePopState = () => {
      setLegalRoute(parseLegalRoute(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const navigateTo = useCallback((path: '/' | LegalRoute) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setLegalRoute(path === '/' ? null : path);
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (legalRoute === '/impressum') {
      document.title = `${t.legal.tabs.imprint} · Terra Tuta`;
    } else if (legalRoute === '/datenschutz') {
      document.title = `${t.legal.tabs.privacy} · Terra Tuta`;
    } else if (legalRoute === '/cookies') {
      document.title = `${t.legal.tabs.cookies} · Terra Tuta`;
    } else {
      document.title = 'Terra Tuta';
    }
  }, [legalRoute, t.legal.tabs.cookies, t.legal.tabs.imprint, t.legal.tabs.privacy]);

  const abortRef = useRef<AbortController | null>(null);

  const loadSiteData = useCallback(
    async (
      lat: number,
      lon: number,
      customLabel?: string,
      fieldPolygon?: DrawnFieldPolygon | null
    ) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoadingData(true);
      try {
        const result = fieldPolygon
          ? await fetchFieldAverageEarthSystemData(fieldPolygon, controller.signal)
          : await fetchEarthSystemData(lat, lon, controller.signal, customLabel);
        if (!controller.signal.aborted) {
          setDataset(result);
          setAiBriefing(null);
          setAiError(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingData(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!hasSelectedLocation) return;
    loadSiteData(coords.lat, coords.lon, coords.label, drawnField);
    return () => {
      abortRef.current?.abort();
    };
  }, [hasSelectedLocation, coords.lat, coords.lon, coords.label, drawnField, loadSiteData]);

  // Backend forecast for the site (field centroid for drawn fields). Runs independently of the
  // NASA/ISRIC load so the slow first-time training never blocks the rest of the UI.
  const forecastAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!hasSelectedLocation) return;
    forecastAbortRef.current?.abort();
    const controller = new AbortController();
    forecastAbortRef.current = controller;

    setForecastStatus('loading');
    setForecastError(null);
    setForecastDataset(null);

    fetchClimateForecast(coords.lat, coords.lon, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setForecastDataset(result);
        setForecastStatus('ready');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setForecastError(err instanceof Error ? err.message : String(err));
        setForecastStatus('error');
      });

    return () => controller.abort();
  }, [hasSelectedLocation, coords.lat, coords.lon, forecastRetryToken]);

  const retryForecast = useCallback(() => setForecastRetryToken((n) => n + 1), []);

  useEffect(() => {
    setAiBriefing(null);
    setAiError(null);
  }, [lang]);

  useEffect(() => {
    const prevMax = prevMaxStepRef.current;
    if (prevMax !== maxTimelineStep) {
      setTimelineStep((curr) => (curr >= prevMax ? maxTimelineStep : Math.min(curr, maxTimelineStep)));
      prevMaxStepRef.current = maxTimelineStep;
    }
  }, [maxTimelineStep]);

  useEffect(() => {
    if (!isTimelinePlaying || isLoadingData || !dataset) return;
    const delayMs = timelineStepIncrement === 1 ? 85 : timelineStepIncrement === 3 ? 110 : 180;
    const timer = setInterval(() => {
      setTimelineStep((prev) => {
        const next = prev + timelineStepIncrement;
        if (next >= maxTimelineStep) {
          setIsTimelinePlaying(false);
          return maxTimelineStep;
        }
        return next;
      });
    }, delayMs);
    return () => clearInterval(timer);
  }, [isTimelinePlaying, isLoadingData, dataset, timelineStepIncrement, maxTimelineStep]);

  const handleConfirmOnboardingLocation = (selection: {
    lat: number;
    lon: number;
    label?: string;
    preset?: PresetRegion;
  }) => {
    if (selection.preset) {
      setBaselineCrop(selection.preset.defaultBaselineCrop);
    }
    setDrawnField(null);
    setCoords({
      lat: Number(selection.lat.toFixed(4)),
      lon: Number(selection.lon.toFixed(4)),
      label: selection.label,
    });
    setHasSelectedLocation(true);
  };

  const handleSelectMapCoordinates = useCallback((lat: number, lon: number) => {
    setDrawnField(null);
    setCoords({
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
    });
  }, []);

  const handleConfirmDrawnField = useCallback((field: DrawnFieldPolygon) => {
    setDrawnField(field);
    setCoords({
      lat: Number(field.centroidLat.toFixed(4)),
      lon: Number(field.centroidLon.toFixed(4)),
      label: `Drawn Field (${field.areaHectares.toFixed(1)} ha)`,
    });
  }, []);

  const handleClearDrawnField = useCallback(() => {
    setDrawnField(null);
    setCoords((prev) => ({
      lat: prev.lat,
      lon: prev.lon,
    }));
  }, []);

  const clampedTimelineStep = Math.min(Math.max(timelineStep, 0), maxTimelineStep);
  const activeTimelineYear = BASE_TIMELINE_YEAR + Math.floor(clampedTimelineStep / 12);
  const activeTimelineMonth = (clampedTimelineStep % 12) + 1;

  const timelineSnapshot = useMemo(() => {
    if (!dataset) return null;
    return extendAndSliceMonthlyRecords(
      dataset.recordsByVariable,
      dataset.climatology,
      effectiveForecastMode,
      activeTimelineYear,
      activeTimelineMonth,
      ensembleRecords
    );
  }, [dataset, effectiveForecastMode, activeTimelineYear, activeTimelineMonth, ensembleRecords]);

  const timeSlicedDataset = useMemo<EarthSystemDataset | null>(() => {
    if (!dataset || !timelineSnapshot) return dataset;
    const { climatology, peakHeatMonths, moistureDeficitMonths } = computeMonthlyClimatology(
      timelineSnapshot.slicedRecordsByVariable
    );
    return {
      ...dataset,
      recordsByVariable: timelineSnapshot.slicedRecordsByVariable,
      climatology,
      peakHeatMonths,
      moistureDeficitMonths,
    };
  }, [dataset, timelineSnapshot]);

  const analyzedByVariable = useMemo(() => {
    if (!timeSlicedDataset) return null;

    const t2m = analyzeClimateSeries(
      timeSlicedDataset.recordsByVariable.T2M,
      'T2M',
      seasonalWindow
    );
    const precip = analyzeClimateSeries(
      timeSlicedDataset.recordsByVariable.PRECTOTCORR,
      'PRECTOTCORR',
      seasonalWindow
    );
    const gwet = analyzeClimateSeries(
      timeSlicedDataset.recordsByVariable.GWETROOT,
      'GWETROOT',
      seasonalWindow
    );
    const evland = analyzeClimateSeries(
      timeSlicedDataset.recordsByVariable.EVLAND,
      'EVLAND',
      seasonalWindow
    );

    return {
      seriesByVariable: {
        T2M: t2m.series,
        PRECTOTCORR: precip.series,
        GWETROOT: gwet.series,
        EVLAND: evland.series,
      },
      statsByVariable: {
        T2M: t2m.stats,
        PRECTOTCORR: precip.stats,
        GWETROOT: gwet.stats,
        EVLAND: evland.stats,
      } as Record<ClimateVariable, TrendStatistics>,
    };
  }, [timeSlicedDataset, seasonalWindow]);

  const activeBaseSeries = analyzedByVariable
    ? analyzedByVariable.seriesByVariable[selectedVariable]
    : [];
  const activeStats = analyzedByVariable
    ? analyzedByVariable.statsByVariable[selectedVariable]
    : null;

  const fullHorizonAnalysis = useMemo(() => {
    if (!dataset) return null;
    return analyzeClimateSeries(
      dataset.recordsByVariable[selectedVariable],
      selectedVariable,
      seasonalWindow
    );
  }, [dataset, selectedVariable, seasonalWindow]);

  const fullForecastSeries = useMemo(() => {
    if (!fullHorizonAnalysis) return [];
    return buildForecastSeries(
      fullHorizonAnalysis.series,
      fullHorizonAnalysis.stats,
      effectiveForecastMode,
      ensembleRecords?.[selectedVariable] ?? null
    );
  }, [fullHorizonAnalysis, effectiveForecastMode, ensembleRecords, selectedVariable]);

  const slicedForecastSeries = useMemo(() => {
    if (!activeStats) return activeBaseSeries;
    if (activeTimelineYear > 2025) {
      return fullForecastSeries;
    }
    return buildForecastSeries(
      activeBaseSeries,
      activeStats,
      effectiveForecastMode,
      ensembleRecords?.[selectedVariable] ?? null
    );
  }, [
    activeBaseSeries,
    activeStats,
    effectiveForecastMode,
    activeTimelineYear,
    fullForecastSeries,
    ensembleRecords,
    selectedVariable,
  ]);

  const thresholdFinding = useMemo(() => {
    if (activeTimelineYear > 2025 && fullHorizonAnalysis) {
      return evaluateAgronomicThreshold(
        fullForecastSeries,
        fullHorizonAnalysis.stats,
        effectiveForecastMode
      );
    }
    if (!activeStats) return null;
    return evaluateAgronomicThreshold(slicedForecastSeries, activeStats, effectiveForecastMode);
  }, [
    activeTimelineYear,
    fullHorizonAnalysis,
    fullForecastSeries,
    activeStats,
    slicedForecastSeries,
    effectiveForecastMode,
  ]);

  const rotationModel = useMemo(() => {
    if (!timeSlicedDataset || !analyzedByVariable) {
      return { scenarios: [], radarData: [] };
    }
    return generateRotationScenarios(
      timeSlicedDataset,
      analyzedByVariable.statsByVariable,
      baselineCrop,
      priorities,
      lang
    );
  }, [timeSlicedDataset, analyzedByVariable, baselineCrop, priorities, lang]);

  const handleExportCsv = () => {
    if (!timeSlicedDataset || !activeStats) return;
    exportTimeSeriesCsv(
      timeSlicedDataset,
      selectedVariable,
      seasonalWindow,
      effectiveForecastMode,
      slicedForecastSeries,
      activeStats
    );
  };

  const handleExportGeoJson = () => {
    if (!timeSlicedDataset || !activeStats) return;
    exportSiteGeoJson(
      timeSlicedDataset,
      selectedVariable,
      seasonalWindow,
      effectiveForecastMode,
      activeStats,
      rotationModel.scenarios
    );
  };

  const handleExportPdf = () => {
    if (!timeSlicedDataset || !analyzedByVariable) return;
    exportSitePdfReport({
      lang,
      dataset: timeSlicedDataset,
      selectedVariable,
      seasonalWindow,
      forecastMode: effectiveForecastMode,
      statsByVariable: analyzedByVariable.statsByVariable,
      thresholdFinding,
      scenarios: rotationModel.scenarios,
      briefing: aiBriefing,
    });
  };

  const requestAiBriefing = useCallback(async () => {
    if (!timeSlicedDataset || !analyzedByVariable || rotationModel.scenarios.length === 0) return;

    setIsAiLoading(true);
    setAiError(null);

    const bestAdaptation =
      [...rotationModel.scenarios]
        .filter((s) => s.id !== 'baseline')
        .sort((a, b) => b.fitScore - a.fitScore)[0] ?? rotationModel.scenarios[1];

    const baselineLabel = BASELINE_CROP_TEXT[lang][baselineCrop].label;

    const localizedSiteName = localizeRegionName(
      timeSlicedDataset.regionName,
      timeSlicedDataset.lat,
      timeSlicedDataset.lon,
      lang
    );

    const payload: AgroBriefingRequest = {
      lang,
      regionName: localizedSiteName,
      lat: timeSlicedDataset.lat,
      lon: timeSlicedDataset.lon,
      seasonalWindow,
      soil: timeSlicedDataset.soil,
      statsByVariable: analyzedByVariable.statsByVariable,
      priorities,
      baselineCropLabel: baselineLabel,
      recommendedScenario: {
        title: bestAdaptation.title,
        cropsSummary: bestAdaptation.cropsSummary,
        whySuggested: bestAdaptation.whySuggested,
      },
    };

    try {
      const response = await fetch('/api/agro-detective', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Briefing request failed (${response.status})`);
      }
      const data = (await response.json()) as AgroBriefingResponse;
      setAiBriefing(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : t.drawer.errorFallback);
    } finally {
      setIsAiLoading(false);
    }
  }, [
    timeSlicedDataset,
    analyzedByVariable,
    rotationModel.scenarios,
    lang,
    baselineCrop,
    seasonalWindow,
    priorities,
    t.drawer.errorFallback,
  ]);

  useEffect(() => {
    if (
      activeTab === 'summary' &&
      !isLoadingData &&
      !isTimelinePlaying &&
      timeSlicedDataset &&
      analyzedByVariable &&
      !aiBriefing &&
      !isAiLoading &&
      !aiError
    ) {
      requestAiBriefing();
    }
  }, [
    activeTab,
    isLoadingData,
    isTimelinePlaying,
    timeSlicedDataset,
    analyzedByVariable,
    aiBriefing,
    isAiLoading,
    aiError,
    requestAiBriefing,
  ]);

  const handleToggleTimelinePlay = useCallback(() => {
    if (isTimelinePlaying) {
      setIsTimelinePlaying(false);
      return;
    }
    if (clampedTimelineStep >= maxTimelineStep) {
      setTimelineStep(0);
    }
    setIsTimelinePlaying(true);
  }, [isTimelinePlaying, clampedTimelineStep, maxTimelineStep]);

  const handleChangeTimelineStep = useCallback((nextStep: number) => {
    setIsTimelinePlaying(false);
    setTimelineStep(nextStep);
  }, []);

  const handleResetTimeline = useCallback(() => {
    setIsTimelinePlaying(false);
    setTimelineStep(maxTimelineStep);
  }, [maxTimelineStep]);

  const displayRegionName = localizeRegionName(
    dataset?.regionName ?? coords.label,
    coords.lat,
    coords.lon,
    lang
  );

  const mapTimelineTelemetry = useMemo(() => {
    if (!timelineSnapshot) return null;
    const monthNames = MONTH_SHORT_BY_LANG[lang];
    return {
      year: activeTimelineYear,
      month: activeTimelineMonth,
      monthLabel: monthNames[Math.max(0, Math.min(11, activeTimelineMonth - 1))],
      tempC: timelineSnapshot.activeMonthValues.T2M?.value,
      precip: timelineSnapshot.activeMonthValues.PRECTOTCORR?.value,
      moisture: timelineSnapshot.activeMonthValues.GWETROOT?.value,
    };
  }, [timelineSnapshot, lang, activeTimelineYear, activeTimelineMonth]);

  return (
    <>
      {legalRoute ? (
        <LegalPage route={legalRoute} onNavigate={navigateTo} />
      ) : !hasSelectedLocation ? (
        <LocationOnboarding
          onConfirmLocation={handleConfirmOnboardingLocation}
          onNavigateLegal={navigateTo}
        />
      ) : (
        <div id="top" className="min-h-screen bg-[#111316] text-[#ECEEF0] flex flex-col">
          <HeaderBar
            regionName={displayRegionName}
            lat={coords.lat}
            lon={coords.lon}
            isLoading={isLoadingData}
            onResetLocationStep={() => {
              setDrawnField(null);
              setHasSelectedLocation(false);
            }}
            onExportCsv={handleExportCsv}
            onExportGeoJson={handleExportGeoJson}
            onExportPdf={handleExportPdf}
          />

          <main className="mx-auto w-full max-w-[1600px] flex-1 border-x border-[#262B33] bg-[#262B33] flex flex-col gap-px">
            <GlobalTimelineBar
              stepIndex={clampedTimelineStep}
              maxStep={maxTimelineStep}
              activeYear={activeTimelineYear}
              activeMonth={activeTimelineMonth}
              isPlaying={isTimelinePlaying}
              stepIncrement={timelineStepIncrement}
              forecastMode={effectiveForecastMode}
              forecastLoading={forecastMode === 'ensemble' && forecastStatus === 'loading'}
              selectedVariable={selectedVariable}
              activeMonthValues={timelineSnapshot?.activeMonthValues ?? null}
              isLoading={isLoadingData}
              onChangeStep={handleChangeTimelineStep}
              onTogglePlay={handleToggleTimelinePlay}
              onResetToFull={handleResetTimeline}
              onChangeStepIncrement={setTimelineStepIncrement}
              onSelectVariable={setSelectedVariable}
            />

            <section
              id="geospatial-map"
              className="grid grid-cols-1 gap-px bg-[#262B33] lg:grid-cols-12 items-stretch flex-1"
            >
              <div className="lg:col-span-6 bg-[#171A1F] flex flex-col min-w-0 overflow-hidden">
                <GeospatialMap
                  lat={coords.lat}
                  lon={coords.lon}
                  regionName={displayRegionName}
                  drawnField={drawnField}
                  activeTimeline={mapTimelineTelemetry}
                  onSelectCoordinates={handleSelectMapCoordinates}
                  onConfirmDrawnField={handleConfirmDrawnField}
                  onClearDrawnField={handleClearDrawnField}
                />
              </div>
              <div className="lg:col-span-6 bg-[#171A1F] flex flex-col min-w-0">
                <RightDataPanel
                  activeTab={activeTab}
                  onSelectTab={setActiveTab}
                  dataset={timeSlicedDataset}
                  selectedVariable={selectedVariable}
                  seasonalWindow={seasonalWindow}
                  forecastMode={effectiveForecastMode}
                  selectedForecastMode={forecastMode}
                  forecastDataset={forecastDataset}
                  forecastStatus={forecastStatus}
                  forecastError={forecastError}
                  onRetryForecast={retryForecast}
                  activeYear={activeTimelineYear}
                  activeMonth={activeTimelineMonth}
                  series={fullForecastSeries}
                  stats={activeStats}
                  thresholdFinding={thresholdFinding}
                  isLoading={isLoadingData}
                  onSelectVariable={setSelectedVariable}
                  onSelectWindow={setSeasonalWindow}
                  onSelectForecastMode={setForecastMode}
                  baselineCrop={baselineCrop}
                  onChangeBaselineCrop={setBaselineCrop}
                  priorities={priorities}
                  onChangePriority={handlePriorityChange}
                  scenarios={rotationModel.scenarios}
                  briefing={aiBriefing}
                  isBriefingLoading={isAiLoading}
                  briefingError={aiError}
                  onRegenerateBriefing={requestAiBriefing}
                />
              </div>
            </section>
          </main>

          <footer className="border-t border-[#262B33] bg-[#111316] py-4">
            <div className="mx-auto max-w-[1600px] px-4 sm:px-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-[#7C8490]">
              <span>{t.footer.left}</span>
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="/impressum"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo('/impressum');
                  }}
                  className="hover:text-[#ECEEF0] transition-colors duration-200 ease-out"
                >
                  {t.footer.imprint}
                </a>
                <a
                  href="/datenschutz"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo('/datenschutz');
                  }}
                  className="hover:text-[#ECEEF0] transition-colors duration-200 ease-out"
                >
                  {t.footer.privacy}
                </a>
                <a
                  href="/cookies"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo('/cookies');
                  }}
                  className="hover:text-[#ECEEF0] transition-colors duration-200 ease-out"
                >
                  {t.footer.cookies}
                </a>
                <span className="hidden md:inline text-[#262B33]" aria-hidden="true">
                  |
                </span>
                <span className="hidden md:inline">{t.footer.right}</span>
              </div>
            </div>
          </footer>
        </div>
      )}

      <CookieBanner onNavigateLegal={navigateTo} />
    </>
  );
}
