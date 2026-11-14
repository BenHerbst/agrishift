import { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Droplets,
  Layers3,
  Minus,
  RefreshCw,
  Thermometer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  BASELINE_CROP_TEXT,
  MONTH_SHORT_BY_LANG,
  SEASONAL_TEXT,
  VARIABLE_TEXT,
  localizeRegionName,
  localizeSoilTexture,
} from '../i18n/translations';
import { BASELINE_CROP_OPTIONS } from '../utils/rotationEngine';
import { ForecastRiskPanel } from './ForecastRiskPanel';
import {
  DISPLAY_START_YEAR,
  VARIABLE_META,
  generateDetectiveExplainer,
  localizeTrendClassification,
} from '../utils/statistics';
import type {
  AgroBriefingResponse,
  AnnualPoint,
  BaselineCropId,
  ClimateForecastDataset,
  ClimateVariable,
  CropCalendarMonthCell,
  EarthSystemDataset,
  FarmerPriorities,
  ForecastLoadStatus,
  ForecastMode,
  RotationScenario,
  SeasonalWindow,
  ThresholdFinding,
  TrendStatistics,
} from '../types/terrashift';

export type RightPanelTab = 'trends' | 'forecast' | 'field_shift' | 'summary';

interface RightDataPanelProps {
  activeTab: RightPanelTab;
  onSelectTab: (tab: RightPanelTab) => void;
  dataset: EarthSystemDataset | null;
  selectedVariable: ClimateVariable;
  seasonalWindow: SeasonalWindow;
  /** Mode actually rendered (falls back while the ensemble loads or is unavailable). */
  forecastMode: ForecastMode;
  /** Mode the user picked. */
  selectedForecastMode: ForecastMode;
  forecastDataset: ClimateForecastDataset | null;
  forecastStatus: ForecastLoadStatus;
  forecastError: string | null;
  onRetryForecast: () => void;
  activeYear: number;
  /** Calendar months of the active timeline period (1, 3 or 12). */
  activeMonths: number[];
  /** End of the active period, e.g. "Aug 2027" or just "2027" in year mode. */
  periodEndLabel: string;
  series: AnnualPoint[];
  stats: TrendStatistics | null;
  thresholdFinding: ThresholdFinding | null;
  isLoading: boolean;
  onSelectVariable: (v: ClimateVariable) => void;
  onSelectWindow: (w: SeasonalWindow) => void;
  onSelectForecastMode: (m: ForecastMode) => void;
  baselineCrop: BaselineCropId;
  onChangeBaselineCrop: (crop: BaselineCropId) => void;
  priorities: FarmerPriorities;
  onChangePriority: (key: keyof FarmerPriorities, value: number) => void;
  scenarios: RotationScenario[];
  briefing: AgroBriefingResponse | null;
  isBriefingLoading: boolean;
  briefingError: string | null;
  onRegenerateBriefing: () => void;
}

const VARIABLES: ClimateVariable[] = ['T2M', 'PRECTOTCORR', 'GWETROOT', 'EVLAND'];
const WINDOWS: SeasonalWindow[] = ['annual', 'summer_jja', 'spring_mam'];

export function RightDataPanel({
  activeTab,
  onSelectTab,
  dataset,
  selectedVariable,
  seasonalWindow,
  forecastMode,
  selectedForecastMode,
  forecastDataset,
  forecastStatus,
  forecastError,
  onRetryForecast,
  activeYear,
  activeMonths,
  periodEndLabel,
  series,
  stats,
  thresholdFinding,
  isLoading,
  onSelectVariable,
  onSelectWindow,
  onSelectForecastMode,
  baselineCrop,
  onChangeBaselineCrop,
  priorities,
  onChangePriority,
  scenarios,
  briefing,
  isBriefingLoading,
  briefingError,
  onRegenerateBriefing,
}: RightDataPanelProps) {
  const { lang, t } = useI18n();
  const meta = VARIABLE_META[selectedVariable];
  const varText = VARIABLE_TEXT[lang][selectedVariable];
  const windowText = SEASONAL_TEXT[lang];
  const monthNames = MONTH_SHORT_BY_LANG[lang];
  const decimals = selectedVariable === 'GWETROOT' ? 3 : 2;

  const [selectedScenarioId, setSelectedScenarioId] = useState<RotationScenario['id']>('hydro_resilient');
  const [selectedMonthCell, setSelectedMonthCell] = useState<{
    yearLabel: string;
    cell: CropCalendarMonthCell;
  } | null>(null);

  useEffect(() => {
    if (scenarios.length === 0) return;
    const bestAlternative =
      [...scenarios]
        .filter((s) => s.id !== 'baseline')
        .sort((a, b) => b.fitScore - a.fitScore)[0] ?? scenarios[0];
    setSelectedScenarioId(bestAlternative.id);
    setSelectedMonthCell(null);
  }, [scenarios]);

  const activeScenario =
    scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0] ?? null;

  const isNegativeWarning = Boolean(
    stats?.isSignificant &&
      ((selectedVariable === 'T2M' && stats.direction === 'increasing') ||
        (selectedVariable === 'GWETROOT' && stats.direction === 'decreasing') ||
        (selectedVariable === 'PRECTOTCORR' && stats.direction === 'decreasing') ||
        (selectedVariable === 'EVLAND' && stats.direction === 'increasing'))
  );

  const lineAccent = isNegativeWarning ? '#d97706' : '#10b981';

  return (
    <div className="flex flex-col bg-[#171A1F] h-full min-w-0">
      {/* Three Clean Flat Tabs */}
      <div
        className="flex items-stretch overflow-x-auto border-b border-[#262B33] bg-[#111316]"
        role="tablist"
        aria-label={t.rightPanel.tabListLabel}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'trends'}
          onClick={() => onSelectTab('trends')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-[#262B33] border-b-2 ${
            activeTab === 'trends'
              ? 'border-b-emerald-400 bg-[#171A1F] text-[#ECEEF0]'
              : 'border-b-transparent bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
          }`}
        >
          {t.rightPanel.tabTrends}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'forecast'}
          onClick={() => onSelectTab('forecast')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-[#262B33] border-b-2 ${
            activeTab === 'forecast'
              ? 'border-b-emerald-400 bg-[#171A1F] text-[#ECEEF0]'
              : 'border-b-transparent bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
          }`}
        >
          {t.rightPanel.tabForecast}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'field_shift'}
          onClick={() => onSelectTab('field_shift')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-[#262B33] border-b-2 ${
            activeTab === 'field_shift'
              ? 'border-b-emerald-400 bg-[#171A1F] text-[#ECEEF0]'
              : 'border-b-transparent bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
          }`}
        >
          {t.rightPanel.tabFieldShift}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          onClick={() => onSelectTab('summary')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-[#262B33] border-b-2 ${
            activeTab === 'summary'
              ? 'border-b-emerald-400 bg-[#171A1F] text-[#ECEEF0]'
              : 'border-b-transparent bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
          }`}
        >
          {t.rightPanel.tabSummary}
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 p-4 sm:p-5 flex flex-col gap-5 min-w-0">
        {!isLoading && dataset?.fieldAreaStats && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-300 font-medium">
              <span>
                {lang === 'de'
                  ? `Ø Feld-Durchschnitt (${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha)`
                  : `Field Average (${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha)`}
              </span>
            </div>
            <div className="font-mono text-[11px] tabular-nums text-[#ECEEF0]">
              {lang === 'de'
                ? `${dataset.fieldAreaStats.samplePointsCount} Messpunkte gemittelt · Umfang ${dataset.fieldAreaStats.perimeterMeters} m`
                : `${dataset.fieldAreaStats.samplePointsCount} sample points averaged · perimeter ${dataset.fieldAreaStats.perimeterMeters} m`}
            </div>
          </div>
        )}
        {isLoading || !dataset || !stats ? (
          <div className="space-y-4">
            <div className="h-9 w-full bg-[#111316] border border-[#262B33]" />
            <div className="h-24 w-full bg-[#111316] border border-[#262B33]" />
            <div className="h-[290px] w-full bg-[#111316] border border-[#262B33]" />
          </div>
        ) : activeTab === 'trends' ? (
          <TrendsTabView
            dataset={dataset}
            selectedVariable={selectedVariable}
            seasonalWindow={seasonalWindow}
            forecastMode={forecastMode}
            activeYear={activeYear}
            periodEndLabel={periodEndLabel}
            series={series}
            stats={stats}
            thresholdFinding={thresholdFinding}
            decimals={decimals}
            unit={meta.unit}
            varLabel={varText.label}
            lineAccent={lineAccent}
            isNegativeWarning={isNegativeWarning}
            lang={lang}
            t={t}
            windowText={windowText}
            onSelectVariable={onSelectVariable}
            onSelectWindow={onSelectWindow}
            onSelectForecastMode={onSelectForecastMode}
            selectedForecastMode={selectedForecastMode}
            forecastDataset={forecastDataset}
            forecastStatus={forecastStatus}
            forecastError={forecastError}
            onRetryForecast={onRetryForecast}
          />
        ) : activeTab === 'forecast' ? (
          <ForecastRiskPanel
            forecast={forecastDataset}
            status={forecastStatus}
            error={forecastError}
            onRetry={onRetryForecast}
            lang={lang}
            t={t}
          />
        ) : activeTab === 'field_shift' ? (
          <FieldShiftTabView
            dataset={dataset}
            monthNames={monthNames}
            activeMonths={activeMonths}
            periodEndLabel={periodEndLabel}
            lang={lang}
            t={t}
            baselineCrop={baselineCrop}
            onChangeBaselineCrop={onChangeBaselineCrop}
            priorities={priorities}
            onChangePriority={onChangePriority}
            scenarios={scenarios}
            activeScenario={activeScenario}
            onSelectScenario={(id) => {
              setSelectedScenarioId(id);
              setSelectedMonthCell(null);
            }}
            selectedMonthCell={selectedMonthCell}
            onSelectMonthCell={setSelectedMonthCell}
          />
        ) : (
          <SummaryTabView
            briefing={briefing}
            isLoading={isBriefingLoading}
            error={briefingError}
            onRegenerate={onRegenerateBriefing}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

function SummaryTabView({
  briefing,
  isLoading,
  error,
  onRegenerate,
  t,
}: {
  briefing: AgroBriefingResponse | null;
  isLoading: boolean;
  error: string | null;
  onRegenerate: () => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!briefing) return;
    const text = [
      briefing.headline,
      '',
      briefing.executiveSummary,
      '',
      t.drawer.section1,
      ...briefing.climateSignalFindings.map((item) => `- ${item}`),
      '',
      t.drawer.section2,
      ...briefing.recommendedActionPlan.map((item) => `- ${item}`),
      '',
      t.drawer.section3,
      ...briefing.validationChecklist.map((item) => `- ${item}`),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div role="tabpanel" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B33] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-[#ECEEF0]">{t.drawer.title}</h3>
          <p className="text-xs text-[#A1A8B3] mt-0.5">
            {isLoading
              ? t.drawer.loadingSubtitle
              : briefing
              ? briefing.generatedBy === 'gemini-2.5-flash'
                ? t.drawer.sourceGemini
                : t.drawer.sourceDeterministic
              : t.drawer.loadingSubtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#262B33] bg-[#111316] px-3 py-1.5 text-xs text-[#ECEEF0] hover:border-[#3A414D] transition-colors duration-200 ease-out cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{t.drawer.regenerate}</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={!briefing || isLoading}
            className="inline-flex items-center gap-1.5 rounded-[2px] border border-emerald-500/45 bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-[#111316] hover:bg-emerald-400 transition-colors duration-200 ease-out cursor-pointer disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t.drawer.copied}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t.drawer.copy}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="h-24 bg-[#111316] border border-[#262B33]" />
          <div className="h-32 bg-[#111316] border border-[#262B33]" />
          <div className="h-32 bg-[#111316] border border-[#262B33]" />
        </div>
      ) : error ? (
        <div className="rounded-[2px] border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200">
          {error}
        </div>
      ) : briefing ? (
        <div className="space-y-5">
          <div className="border border-[#262B33] bg-[#111316] p-4 sm:p-5">
            <h4 className="text-base font-semibold text-[#ECEEF0] text-balance">
              {briefing.headline}
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-[#A1A8B3]">
              {briefing.executiveSummary}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-[#ECEEF0]">{t.drawer.section1}</h4>
            <ul className="divide-y divide-[#262B33] border border-[#262B33] bg-[#111316]">
              {briefing.climateSignalFindings.map((item, idx) => (
                <li
                  key={idx}
                  className="px-4 py-2.5 text-xs leading-relaxed text-[#ECEEF0] font-mono tabular-nums tracking-tight"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-emerald-400">{t.drawer.section2}</h4>
              <ul className="divide-y divide-[#262B33] border border-[#262B33] bg-[#111316]">
                {briefing.recommendedActionPlan.map((item, idx) => (
                  <li key={idx} className="px-4 py-2.5 text-xs leading-relaxed text-[#ECEEF0]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-amber-400">{t.drawer.section3}</h4>
              <ul className="divide-y divide-[#262B33] border border-[#262B33] bg-[#111316]">
                {briefing.validationChecklist.map((item, idx) => (
                  <li key={idx} className="px-4 py-2.5 text-xs leading-relaxed text-[#A1A8B3]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrendsTabView({
  dataset,
  selectedVariable,
  seasonalWindow,
  forecastMode,
  activeYear,
  periodEndLabel,
  series: fullSeries,
  stats,
  thresholdFinding,
  decimals,
  unit,
  varLabel,
  lineAccent,
  isNegativeWarning,
  lang,
  t,
  windowText,
  onSelectVariable,
  onSelectWindow,
  onSelectForecastMode,
  selectedForecastMode,
  forecastDataset,
  forecastStatus,
  forecastError,
  onRetryForecast,
}: {
  dataset: EarthSystemDataset;
  selectedVariable: ClimateVariable;
  seasonalWindow: SeasonalWindow;
  forecastMode: ForecastMode;
  activeYear: number;
  periodEndLabel: string;
  series: AnnualPoint[];
  stats: TrendStatistics;
  thresholdFinding: ThresholdFinding | null;
  decimals: number;
  unit: string;
  varLabel: string;
  lineAccent: string;
  isNegativeWarning: boolean;
  lang: 'de' | 'en';
  t: ReturnType<typeof useI18n>['t'];
  windowText: Record<SeasonalWindow, { label: string; shortLabel: string }>;
  onSelectVariable: (v: ClimateVariable) => void;
  onSelectWindow: (w: SeasonalWindow) => void;
  onSelectForecastMode: (m: ForecastMode) => void;
  selectedForecastMode: ForecastMode;
  forecastDataset: ClimateForecastDataset | null;
  forecastStatus: ForecastLoadStatus;
  forecastError: string | null;
  onRetryForecast: () => void;
}) {
  const isEnsemble = forecastMode === 'ensemble';
  // EVLAND has no backend equivalent (ET0 is demand, not actual ET): it continues with recent NASA climatology
  const ensembleCoversVariable = selectedVariable !== 'EVLAND';
  const backendKey =
    selectedVariable === 'T2M' ? 'tmean' : selectedVariable === 'PRECTOTCORR' ? 'precip' : 'soil_moisture_root';
  const ensembleSkill = ensembleCoversVariable
    ? forecastDataset?.variables[backendKey]?.skillVsClimatology ?? null
    : null;
  const localizedClass = localizeTrendClassification(stats, lang);
  const pFormatted = stats.pValue < 0.001 ? '< 0.001' : stats.pValue.toFixed(4);
  const slopeSign = stats.sensSlopePerDecade >= 0 ? '+' : '';
  const explainer = generateDetectiveExplainer(
    stats,
    localizeRegionName(dataset.regionName, dataset.lat, dataset.lon, lang),
    lang
  );

  const badgeStyles = !stats.isSignificant
    ? 'border-[#262B33] bg-[#111316] text-[#A1A8B3]'
    : isNegativeWarning
    ? 'border-amber-500/40 bg-amber-500/12 text-amber-300'
    : 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300';

  const TrendIcon = !stats.isSignificant
    ? Minus
    : stats.direction === 'increasing'
    ? TrendingUp
    : TrendingDown;

  const forecastButtons: Array<{ mode: ForecastMode; label: string }> = [
    { mode: 'historical', label: t.trends.modeHistorical },
    { mode: 'ensemble', label: t.trends.modeEnsemble },
    { mode: 'sens_slope', label: t.trends.modeSens },
    { mode: 'cmip6_ssp585', label: t.trends.modeCmip6 },
  ];

  // Display window: DISPLAY_START_YEAR (2000) up to the end of the forecast
  const series = fullSeries.filter((pt) => pt.year >= DISPLAY_START_YEAR);
  const minYear = series.length > 0 ? series[0].year : DISPLAY_START_YEAR;
  const maxYear = series.length > 0 ? series[series.length - 1].year : 2025;
  const effectiveYear = Math.min(Math.max(activeYear, minYear), maxYear);

  // Keep full X-axis & steady Y-axis domain while revealing data progressively up to activeYear
  const visibleSeries = series.map((pt) =>
    pt.year <= effectiveYear
      ? pt
      : {
          ...pt,
          value: null,
          movingAvg5Yr: null,
          trendLine: null,
          projectedValue: null,
          ciBand: null,
          ciLower: null,
          ciUpper: null,
        }
  );

  // Compute steady Y bounds from full series so scrubbing/animating does not rescale the Y-axis
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pt of series) {
    const candidates = [pt.value, pt.projectedValue, pt.ciLower, pt.ciUpper];
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c)) {
        if (c < yMin) yMin = c;
        if (c > yMax) yMax = c;
      }
    }
  }
  const yPad = Number.isFinite(yMin) && Number.isFinite(yMax) ? Math.max((yMax - yMin) * 0.08, 0.02) : 1;
  const yDomain: [number | 'auto', number | 'auto'] =
    Number.isFinite(yMin) && Number.isFinite(yMax)
      ? [Number((yMin - yPad).toFixed(3)), Number((yMax + yPad).toFixed(3))]
      : ['auto', 'auto'];

  return (
    <div role="tabpanel" className="space-y-5">
      {/* Variable & Seasonal Window Filters */}
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-px border border-[#262B33] bg-[#262B33]">
          {VARIABLES.map((v) => {
            const active = v === selectedVariable;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onSelectVariable(v)}
                className={`px-3 py-1.5 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#222730] text-emerald-300 font-medium'
                    : 'bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
                }`}
              >
                {VARIABLE_TEXT[lang][v].shortLabel}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-px border border-[#262B33] bg-[#262B33]">
          {WINDOWS.map((w) => {
            const active = w === seasonalWindow;
            return (
              <button
                key={w}
                type="button"
                onClick={() => onSelectWindow(w)}
                className={`px-2.5 py-1.5 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#222730] text-[#ECEEF0] font-medium'
                    : 'bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
                }`}
              >
                {windowText[w].shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Asymmetric Verdict + 3-Metric Strip */}
      <div className="border border-[#262B33] bg-[#111316]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B33] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-xs font-medium ${badgeStyles}`}
            >
              {stats.isSignificant ? (
                isNegativeWarning ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )
              ) : (
                <TrendIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{localizedClass}</span>
            </span>
          </div>
          <span className="font-mono text-xs tabular-nums text-[#A1A8B3]">
            {stats.startYear}–{periodEndLabel} · n = {stats.sampleCount} {t.trends.yearsSuffix} · {windowText[seasonalWindow].shortLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#262B33]">
          <div className="bg-[#111316] px-4 py-3.5">
            <div className="text-xs text-[#A1A8B3]">{t.trends.kpiSens}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-[#ECEEF0]">
                {slopeSign}
                {stats.sensSlopePerDecade.toFixed(decimals)}
              </span>
              <span className="font-mono text-xs tabular-nums text-[#A1A8B3]">
                {unit} {t.trends.perDecade}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-[#7C8490]">
              {t.trends.olsSlope}: {stats.olsSlopePerDecade >= 0 ? '+' : ''}
              {stats.olsSlopePerDecade.toFixed(decimals)}
            </div>
          </div>

          <div className="bg-[#111316] px-4 py-3.5">
            <div className="text-xs text-[#A1A8B3]">{t.trends.kpiMk}</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-[#ECEEF0]">
                Z = {stats.mannKendallZ >= 0 ? '+' : ''}
                {stats.mannKendallZ.toFixed(2)}
              </span>
              <span className="font-mono text-xs tabular-nums text-[#A1A8B3]">
                p {pFormatted.startsWith('<') ? pFormatted : `= ${pFormatted}`}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-[#7C8490]">
              S = {stats.mannKendallS} · Var = {Math.round(stats.mannKendallVarS)}
            </div>
          </div>

          <div className="bg-[#111316] px-4 py-3.5">
            <div className="text-xs text-[#A1A8B3]">{t.trends.kpiConf}</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-emerald-400">
                {stats.confidencePct.toFixed(1)}%
              </span>
              <span className="font-mono text-xs tabular-nums text-[#A1A8B3]">
                R² = {stats.rSquared.toFixed(3)}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-[#7C8490]">
              {stats.baselineMean.toFixed(decimals)} → {stats.recentMean.toFixed(decimals)} {unit}
            </div>
          </div>
        </div>
      </div>

      {/* Time-Series Chart + Projection Mode */}
      <div className="border border-[#262B33] bg-[#111316] p-4 space-y-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#ECEEF0]">
              {varLabel} · {t.trends.chartTitle}
            </h3>
            <p className="text-xs text-[#A1A8B3]">
              {selectedForecastMode === 'ensemble' ? t.trends.kickerEnsemble : t.trends.kicker}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-px border border-[#262B33] bg-[#262B33]">
            {forecastButtons.map((btn) => {
              const active = selectedForecastMode === btn.mode;
              return (
                <button
                  key={btn.mode}
                  type="button"
                  onClick={() => onSelectForecastMode(btn.mode)}
                  className={`px-2.5 py-1 text-[11px] transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? btn.mode === 'cmip6_ssp585'
                        ? 'bg-[#222730] text-amber-300 font-medium'
                        : 'bg-[#222730] text-emerald-300 font-medium'
                      : 'bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
        </div>

        {selectedForecastMode === 'ensemble' && forecastStatus === 'loading' && (
          <div className="flex items-center gap-2 border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span>{t.trends.ensembleLoading}</span>
          </div>
        )}
        {selectedForecastMode === 'ensemble' && forecastStatus === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <span>
              <span className="font-semibold">{t.trends.ensembleError}:</span> {forecastError}{' '}
              {t.trends.ensembleFallback}
            </span>
            <button
              type="button"
              onClick={onRetryForecast}
              className="inline-flex items-center gap-1 rounded-[2px] border border-amber-500/50 px-2 py-0.5 text-amber-200 hover:bg-amber-500/20 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {t.trends.ensembleRetry}
            </button>
          </div>
        )}
        {isEnsemble && forecastDataset && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-[#A1A8B3]">
            {!ensembleCoversVariable ? (
              <span className="font-sans text-amber-200/90">{t.trends.ensembleEvlandNote}</span>
            ) : (
            <span title={t.trends.ensembleSkillHint}>
              {t.trends.ensembleSkill}:{' '}
              <span
                className={
                  ensembleSkill === null
                    ? 'text-[#7C8490]'
                    : ensembleSkill > 0
                    ? 'text-emerald-300'
                    : 'text-amber-300'
                }
              >
                {ensembleSkill === null
                  ? '—'
                  : `${ensembleSkill >= 0 ? '+' : ''}${(ensembleSkill * 100).toFixed(1)}%`}
              </span>
            </span>
            )}
            <span>
              {t.trends.ensembleTrained}: {forecastDataset.trainedUntil}
            </span>
            <span className="text-[#7C8490] font-sans">{t.trends.ensembleMapping}</span>
            {forecastDataset.sources.climateProjectionErrors && (
              <span
                className="font-sans text-amber-200/90"
                title={forecastDataset.sources.climateProjectionErrors.join('\n')}
              >
                {t.trends.ensembleNoCmip}
              </span>
            )}
          </div>
        )}

        <div className="h-[260px] sm:h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visibleSeries} margin={{ top: 12, right: 14, left: 2, bottom: 2 }}>
              <CartesianGrid stroke="#262B33" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="year"
                stroke="#7C8490"
                tick={{ fill: '#A1A8B3', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#262B33' }}
              />
              <YAxis
                stroke="#7C8490"
                width={48}
                tick={{ fill: '#A1A8B3', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#262B33' }}
                domain={yDomain}
                tickFormatter={(v: number) => v.toFixed(selectedVariable === 'GWETROOT' ? 2 : 1)}
              />
              <Tooltip
                content={
                  <CustomSeriesTooltip
                    decimals={decimals}
                    unit={unit}
                    labels={
                      isEnsemble ? { ...t.trends, tooltipCi: t.trends.tooltipCi80 } : t.trends
                    }
                  />
                }
              />
              {forecastMode !== 'historical' && (
                <ReferenceLine
                  x={2025}
                  stroke="#7C8490"
                  strokeDasharray="4 4"
                  label={{
                    value: t.trends.latestObsLabel,
                    position: 'insideTopLeft',
                    fill: '#A1A8B3',
                    fontSize: 10,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
              )}
              {effectiveYear < maxYear && (
                <ReferenceLine
                  x={effectiveYear}
                  stroke="#10b981"
                  strokeWidth={1.5}
                />
              )}
              {forecastMode !== 'historical' && (
                <Area
                  type="monotone"
                  dataKey="ciBand"
                  stroke="none"
                  fill={forecastMode === 'cmip6_ssp585' ? '#d97706' : lineAccent}
                  fillOpacity={0.14}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="trendLine"
                stroke="#7C8490"
                strokeWidth={1.25}
                strokeDasharray="3 3"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#A1A8B3"
                strokeWidth={1.5}
                dot={{ r: 1.75, fill: '#ECEEF0', strokeWidth: 0 }}
                activeDot={{ r: 4, fill: '#ECEEF0' }}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="movingAvg5Yr"
                stroke={lineAccent}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              {forecastMode !== 'historical' && (
                <Line
                  type="monotone"
                  dataKey="projectedValue"
                  stroke={forecastMode === 'cmip6_ssp585' ? '#d97706' : lineAccent}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Clean Chart Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#262B33] pt-2.5 text-[11px] text-[#A1A8B3]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-[#A1A8B3]" />
            <span>{t.trends.legendObserved}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5" style={{ backgroundColor: lineAccent }} />
            <span>{t.trends.legendMovingAvg}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 border-t border-dashed border-[#7C8490]" />
            <span>{t.trends.legendTrendline}</span>
          </span>
          {forecastMode !== 'historical' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-0.5 w-3.5 border-t-2 border-dashed"
                  style={{ borderColor: forecastMode === 'cmip6_ssp585' ? '#d97706' : lineAccent }}
                />
                <span>{isEnsemble ? t.trends.legendEnsemble : t.trends.legendProjection}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-3.5 border"
                  style={{
                    backgroundColor:
                      forecastMode === 'cmip6_ssp585'
                        ? 'rgba(217,119,6,0.18)'
                        : 'rgba(16,185,129,0.18)',
                    borderColor:
                      forecastMode === 'cmip6_ssp585'
                        ? 'rgba(217,119,6,0.45)'
                        : 'rgba(16,185,129,0.45)',
                  }}
                />
                <span>{isEnsemble ? t.trends.legendCi80 : t.trends.legendCiFan}</span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Threshold & Site Interpretation */}
      <div className="space-y-3">
        {thresholdFinding && (
          <div
            className={`border px-4 py-3 text-xs leading-relaxed ${
              thresholdFinding.crossed || thresholdFinding.alreadyExceeded
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-[#262B33] bg-[#111316] text-[#ECEEF0]'
            }`}
          >
            {lang === 'de' ? thresholdFinding.messageDe : thresholdFinding.messageEn}
          </div>
        )}

        <div className="border border-[#262B33] bg-[#111316] px-4 py-3.5 space-y-1.5">
          <div className="text-xs font-semibold text-[#ECEEF0]">
            {t.trends.explainerPrefix}: {explainer.headline}
          </div>
          <p className="text-xs leading-relaxed text-[#A1A8B3]">
            {explainer.statisticalInterpretation}
          </p>
          <p className="text-xs leading-relaxed text-[#7C8490]">
            {explainer.regionalMechanism}
          </p>
        </div>
      </div>
    </div>
  );
}

function CustomSeriesTooltip({
  active,
  payload,
  label,
  decimals,
  unit,
  labels,
}: {
  active?: boolean;
  payload?: Array<{ payload: AnnualPoint }>;
  label?: number;
  decimals: number;
  unit: string;
  labels: {
    tooltipYear: string;
    tooltipObserved: string;
    tooltipMovingAvg: string;
    tooltipTrend: string;
    tooltipProjected: string;
    tooltipCi: string;
    tooltipAnomaly: string;
  };
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="border border-[#262B33] bg-[#111316] px-3 py-2.5 text-xs font-mono tabular-nums text-[#ECEEF0]">
      <div className="font-semibold border-b border-[#262B33] pb-1 mb-1.5">
        {labels.tooltipYear} {label}
      </div>
      {pt.value !== null && (
        <div className="flex justify-between gap-4">
          <span className="text-[#A1A8B3]">{labels.tooltipObserved}</span>
          <span>
            {pt.value.toFixed(decimals)} {unit}
          </span>
        </div>
      )}
      {pt.movingAvg5Yr !== null && (
        <div className="flex justify-between gap-4">
          <span className="text-[#A1A8B3]">{labels.tooltipMovingAvg}</span>
          <span>
            {pt.movingAvg5Yr.toFixed(decimals)} {unit}
          </span>
        </div>
      )}
      {pt.projectedValue !== null && (
        <div className="flex justify-between gap-4 text-emerald-300">
          <span>{labels.tooltipProjected}</span>
          <span>
            {pt.projectedValue.toFixed(decimals)} {unit}
          </span>
        </div>
      )}
      {pt.ciLower !== null && pt.ciUpper !== null && pt.year >= 2026 && (
        <div className="flex justify-between gap-4 text-[#A1A8B3]">
          <span>{labels.tooltipCi}</span>
          <span>
            {pt.ciLower.toFixed(decimals)}–{pt.ciUpper.toFixed(decimals)}
          </span>
        </div>
      )}
    </div>
  );
}

function FieldShiftTabView({
  dataset,
  monthNames,
  activeMonths,
  periodEndLabel,
  lang,
  t,
  baselineCrop,
  onChangeBaselineCrop,
  priorities,
  onChangePriority,
  scenarios,
  activeScenario,
  onSelectScenario,
  selectedMonthCell,
  onSelectMonthCell,
}: {
  dataset: EarthSystemDataset;
  monthNames: string[];
  activeMonths: number[];
  periodEndLabel: string;
  lang: 'de' | 'en';
  t: ReturnType<typeof useI18n>['t'];
  baselineCrop: BaselineCropId;
  onChangeBaselineCrop: (crop: BaselineCropId) => void;
  priorities: FarmerPriorities;
  onChangePriority: (key: keyof FarmerPriorities, value: number) => void;
  scenarios: RotationScenario[];
  activeScenario: RotationScenario | null;
  onSelectScenario: (id: RotationScenario['id']) => void;
  selectedMonthCell: { yearLabel: string; cell: CropCalendarMonthCell } | null;
  onSelectMonthCell: (item: { yearLabel: string; cell: CropCalendarMonthCell } | null) => void;
}) {
  const priorityItems: Array<{ key: keyof FarmerPriorities; label: string }> = [
    { key: 'water', label: t.fieldShift.priorities.water },
    { key: 'nitrogen', label: t.fieldShift.priorities.nitrogen },
    { key: 'erosion', label: t.fieldShift.priorities.erosion },
    { key: 'profit', label: t.fieldShift.priorities.profit },
  ];

  return (
    <div role="tabpanel" className="space-y-5">
      {/* SoilGrids Asymmetric Summary */}
      <div className="border border-[#262B33] bg-[#111316] p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#262B33] pb-3">
          <div>
            <p className="text-xs text-[#A1A8B3]">
              {t.soil.kicker} · <span className="font-mono text-[#ECEEF0]">1990–{periodEndLabel}</span>
            </p>
            <h2 className="mt-0.5 text-sm font-semibold text-[#ECEEF0]">
              {localizeRegionName(dataset.regionName, dataset.lat, dataset.lon, lang)}
            </h2>
          </div>
          <span className="rounded-[2px] border border-emerald-500/35 bg-emerald-500/12 px-2.5 py-0.5 text-xs font-medium text-emerald-300 shrink-0">
            {localizeSoilTexture(dataset.soil.textureClass, lang)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-5 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-[#A1A8B3]">{t.soil.phTitle}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums text-[#ECEEF0]">
                  {dataset.soil.ph.toFixed(1)}
                </span>
                <span className="text-[11px] text-[#A1A8B3]">
                  {dataset.soil.ph < 6.0
                    ? t.soil.phAcidic
                    : dataset.soil.ph > 7.5
                    ? t.soil.phAlkaline
                    : t.soil.phOptimal}
                </span>
              </div>
            </div>

            <div>
              <div className="text-xs text-[#A1A8B3]">{t.soil.socTitle}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold tabular-nums text-emerald-400">
                  {dataset.soil.socPercent.toFixed(2)}
                </span>
                <span className="font-mono text-xs text-[#A1A8B3]">{t.soil.socUnit}</span>
              </div>
            </div>
          </div>

          <div className="md:col-span-7 space-y-2 md:border-l md:border-[#262B33] md:pl-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-[#A1A8B3]">
                <Layers3 className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <span>{t.soil.textureTitle}</span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[#ECEEF0]">
                {t.soil.clay} {dataset.soil.clayPercent}% · {t.soil.silt} {dataset.soil.siltPercent}% · {t.soil.sand} {dataset.soil.sandPercent}%
              </span>
            </div>

            <div className="flex h-2 w-full overflow-hidden bg-[#262B33]">
              <div
                style={{ width: `${dataset.soil.clayPercent}%` }}
                className="bg-amber-500/85"
                title={`${t.soil.clay} ${dataset.soil.clayPercent}%`}
              />
              <div
                style={{ width: `${dataset.soil.siltPercent}%` }}
                className="bg-emerald-500/85"
                title={`${t.soil.silt} ${dataset.soil.siltPercent}%`}
              />
              <div
                style={{ width: `${dataset.soil.sandPercent}%` }}
                className="bg-[#6B7280]"
                title={`${t.soil.sand} ${dataset.soil.sandPercent}%`}
              />
            </div>

            <div className="flex items-center justify-between gap-4 text-[11px] text-[#A1A8B3] pt-0.5">
              <span className="inline-flex items-center gap-1.5">
                <Thermometer className="h-3 w-3 text-amber-400" aria-hidden="true" />
                <span>{t.soil.heatTitle}:</span>
                <span className="font-mono text-amber-300">
                  {dataset.peakHeatMonths.map((m) => monthNames[m - 1]).join(' · ')}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Droplets className="h-3 w-3 text-[#ECEEF0]" aria-hidden="true" />
                <span>{t.soil.moistureTitle}:</span>
                <span className="font-mono text-[#ECEEF0]">
                  {dataset.moistureDeficitMonths.map((m) => monthNames[m - 1]).join(' · ')}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Baseline Crop & Farm Priorities */}
      <div className="border border-[#262B33] bg-[#111316] p-4 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#ECEEF0]">{t.fieldShift.title}</h3>
            <p className="text-xs text-[#A1A8B3]">{t.fieldShift.subtitle}</p>
          </div>
          <div className="sm:w-64">
            <label htmlFor="baseline-crop-select" className="sr-only">
              {t.fieldShift.baselineLabel}
            </label>
            <select
              id="baseline-crop-select"
              value={baselineCrop}
              onChange={(e) => onChangeBaselineCrop(e.target.value as BaselineCropId)}
              className="w-full rounded-[2px] border border-[#262B33] bg-[#171A1F] px-3 py-1.5 text-xs text-[#ECEEF0] focus:border-emerald-400 focus:outline-none transition-colors duration-200 ease-out"
            >
              {BASELINE_CROP_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {BASELINE_CROP_TEXT[lang][opt.id].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 border-t border-[#262B33] pt-3">
          {priorityItems.map((item) => (
            <label key={item.key} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-[#A1A8B3] w-36 shrink-0">{item.label}</span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={priorities[item.key]}
                onChange={(e) => onChangePriority(item.key, Number(e.target.value))}
                className="flex-1 accent-emerald-500 cursor-pointer"
              />
              <span className="font-mono text-[11px] tabular-nums text-[#ECEEF0] w-8 text-right">
                {priorities[item.key]}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Asymmetric Scenario Selector & Detail */}
      {activeScenario && (
        <div className="border border-[#262B33] bg-[#111316]">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#262B33] border-b border-[#262B33]">
            {scenarios.map((scenario) => {
              const selected = scenario.id === activeScenario.id;
              return (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => onSelectScenario(scenario.id)}
                  className={`p-3.5 text-left transition-colors duration-200 ease-out cursor-pointer ${
                    selected ? 'bg-[#1C2128]' : 'bg-[#111316] hover:bg-[#171A1F]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#A1A8B3]">{scenario.badgeLabel}</span>
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        selected ? 'text-emerald-400' : 'text-[#ECEEF0]'
                      }`}
                    >
                      {scenario.fitScore}/100
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[#ECEEF0]">{scenario.title}</div>
                  <div className="mt-0.5 text-[11px] text-[#7C8490] line-clamp-1">
                    {scenario.cropsSummary}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-4 space-y-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[#ECEEF0]">{t.fieldShift.whySuggested}</div>
              <p className="text-xs leading-relaxed text-[#A1A8B3]">{activeScenario.whySuggested}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[#262B33] pt-3.5">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-emerald-400">
                  {t.fieldShift.expectedBenefits}
                </div>
                <ul className="space-y-1 text-xs leading-relaxed text-[#ECEEF0]">
                  {activeScenario.expectedBenefits.map((benefit, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-amber-400">
                  {t.fieldShift.risksValidation}
                </div>
                <ul className="space-y-1 text-xs leading-relaxed text-[#A1A8B3]">
                  {activeScenario.risksAndValidation.map((risk, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Compact 36-Month Cover & Stress Calendar */}
            <div className="border-t border-[#262B33] pt-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-[#ECEEF0]">
                    {t.fieldShift.calendarTitle}
                  </h4>
                  <p className="text-[11px] text-[#7C8490]">{t.fieldShift.calendarSubtitle}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#A1A8B3]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 bg-[#334155]" />
                    <span>{t.fieldShift.legendCash}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 bg-emerald-500/75" />
                    <span>{t.fieldShift.legendCover}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 bg-amber-500/75" />
                    <span>{t.fieldShift.legendBare}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {activeScenario.calendarYears.map((yr) => (
                  <div key={yr.yearNumber} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-[#ECEEF0] font-medium">{yr.yearLabel}</span>
                      <span className="text-[#7C8490] truncate ml-2">{yr.sequenceTitle}</span>
                    </div>
                    <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                      {yr.months.map((cell) => {
                        const isSelected =
                          selectedMonthCell?.yearLabel === yr.yearLabel &&
                          selectedMonthCell?.cell.month === cell.month;
                        const isActiveTimelineMonth = activeMonths.includes(cell.month);
                        const bgClass =
                          cell.coverStatus === 'cover'
                            ? 'bg-emerald-500/20 border-emerald-500/45 text-emerald-200'
                            : cell.coverStatus === 'bare_risk'
                            ? 'bg-amber-500/20 border-amber-500/45 text-amber-200'
                            : 'bg-[#1D232B] border-[#2E3642] text-[#ECEEF0]';
                        return (
                          <button
                            key={cell.month}
                            type="button"
                            onClick={() => onSelectMonthCell({ yearLabel: yr.yearLabel, cell })}
                            title={`${cell.monthLabel}: ${cell.cropName}`}
                            className={`rounded-[2px] border px-1 py-1.5 text-center transition-colors duration-200 ease-out cursor-pointer ${bgClass} ${
                              isSelected
                                ? 'ring-1 ring-[#ECEEF0]'
                                : isActiveTimelineMonth
                                ? 'ring-1 ring-emerald-400/80'
                                : ''
                            }`}
                          >
                            <div className="font-mono text-[10px] leading-none">
                              {cell.monthLabel}
                            </div>
                            <div className="mt-1 flex justify-center">
                              <span
                                className={`h-1 w-1 rounded-full ${
                                  cell.stressFlag === 'heat_stress'
                                    ? 'bg-amber-400'
                                    : cell.stressFlag === 'water_stress'
                                    ? 'bg-[#ECEEF0]'
                                    : 'bg-transparent'
                                }`}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border border-[#262B33] bg-[#171A1F] px-3 py-2 text-xs text-[#A1A8B3]">
                {selectedMonthCell ? (
                  <div>
                    <span className="font-mono font-semibold text-[#ECEEF0]">
                      {selectedMonthCell.yearLabel} · {selectedMonthCell.cell.monthLabel}:
                    </span>{' '}
                    <span className="text-emerald-300 font-medium">
                      {selectedMonthCell.cell.cropName}
                    </span>{' '}
                    — {selectedMonthCell.cell.note}
                  </div>
                ) : (
                  <span>{t.fieldShift.hoverHint}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
