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

  const lineAccent = isNegativeWarning ? 'var(--color-warn)' : 'var(--color-crop)';

  return (
    <div className="flex flex-col bg-panel h-full min-w-0 lg:min-h-0">
      {/* Three Clean Flat Tabs */}
      <div
        className="flex items-stretch overflow-x-auto border-b border-line bg-ground"
        role="tablist"
        aria-label={t.rightPanel.tabListLabel}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'trends'}
          onClick={() => onSelectTab('trends')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-line border-b-2 ${
            activeTab === 'trends'
              ? 'border-b-crop bg-panel text-ink'
              : 'border-b-transparent bg-ground text-ink-2 hover:text-ink'
          }`}
        >
          {t.rightPanel.tabTrends}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'forecast'}
          onClick={() => onSelectTab('forecast')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-line border-b-2 ${
            activeTab === 'forecast'
              ? 'border-b-crop bg-panel text-ink'
              : 'border-b-transparent bg-ground text-ink-2 hover:text-ink'
          }`}
        >
          {t.rightPanel.tabForecast}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'field_shift'}
          onClick={() => onSelectTab('field_shift')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-line border-b-2 ${
            activeTab === 'field_shift'
              ? 'border-b-crop bg-panel text-ink'
              : 'border-b-transparent bg-ground text-ink-2 hover:text-ink'
          }`}
        >
          {t.rightPanel.tabFieldShift}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          onClick={() => onSelectTab('summary')}
          className={`px-4 sm:px-5 py-3 text-xs font-medium transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer border-r border-line border-b-2 ${
            activeTab === 'summary'
              ? 'border-b-crop bg-panel text-ink'
              : 'border-b-transparent bg-ground text-ink-2 hover:text-ink'
          }`}
        >
          {t.rightPanel.tabSummary}
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 p-4 sm:p-5 flex flex-col gap-5 min-w-0 lg:min-h-0 lg:overflow-y-auto">
        {!isLoading && dataset?.fieldAreaStats && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-crop/35 bg-crop/10 px-3.5 py-2 text-xs">
            <div className="flex items-center gap-2 text-crop font-medium">
              <span>
                {lang === 'de'
                  ? `Ø Feld-Durchschnitt (${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha)`
                  : `Field Average (${dataset.fieldAreaStats.areaHectares.toFixed(2)} ha)`}
              </span>
            </div>
            <div className="font-mono text-[11px] tabular-nums text-ink">
              {lang === 'de'
                ? `${dataset.fieldAreaStats.samplePointsCount} Messpunkte gemittelt · Umfang ${dataset.fieldAreaStats.perimeterMeters} m`
                : `${dataset.fieldAreaStats.samplePointsCount} sample points averaged · perimeter ${dataset.fieldAreaStats.perimeterMeters} m`}
            </div>
          </div>
        )}
        {isLoading || !dataset || !stats ? (
          <div className="space-y-4">
            <div className="h-9 w-full bg-ground border border-line" />
            <div className="h-24 w-full bg-ground border border-line" />
            <div className="h-[290px] w-full bg-ground border border-line" />
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t.drawer.title}</h3>
          <p className="text-xs text-ink-2 mt-0.5">
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
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ground px-3 py-1.5 text-xs text-ink hover:border-line-strong transition-colors duration-200 ease-out cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{t.drawer.regenerate}</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={!briefing || isLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-crop/45 bg-crop px-3 py-1.5 text-xs font-semibold text-ground hover:bg-crop/90 transition-colors duration-200 ease-out cursor-pointer disabled:opacity-50"
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
          <div className="h-24 bg-ground border border-line" />
          <div className="h-32 bg-ground border border-line" />
          <div className="h-32 bg-ground border border-line" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-4 text-xs text-warn">
          {error}
        </div>
      ) : briefing ? (
        <div className="space-y-5">
          <div className="border border-line bg-ground p-4 sm:p-5">
            <h4 className="text-base font-semibold text-ink text-balance">
              {briefing.headline}
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              {briefing.executiveSummary}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-ink">{t.drawer.section1}</h4>
            <ul className="divide-y divide-line border border-line bg-ground">
              {briefing.climateSignalFindings.map((item, idx) => (
                <li
                  key={idx}
                  className="px-4 py-2.5 text-xs leading-relaxed text-ink font-mono tabular-nums tracking-tight"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-crop">{t.drawer.section2}</h4>
              <ul className="divide-y divide-line border border-line bg-ground">
                {briefing.recommendedActionPlan.map((item, idx) => (
                  <li key={idx} className="px-4 py-2.5 text-xs leading-relaxed text-ink">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-warn">{t.drawer.section3}</h4>
              <ul className="divide-y divide-line border border-line bg-ground">
                {briefing.validationChecklist.map((item, idx) => (
                  <li key={idx} className="px-4 py-2.5 text-xs leading-relaxed text-ink-2">
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
    ? 'border-line bg-ground text-ink-2'
    : isNegativeWarning
    ? 'border-warn/40 bg-warn/12 text-warn'
    : 'border-crop/40 bg-crop/12 text-crop';

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
        <div className="flex flex-wrap items-center gap-px border border-line bg-line">
          {VARIABLES.map((v) => {
            const active = v === selectedVariable;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onSelectVariable(v)}
                className={`px-3 py-1.5 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-raised text-crop font-medium'
                    : 'bg-ground text-ink-2 hover:text-ink'
                }`}
              >
                {VARIABLE_TEXT[lang][v].shortLabel}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-px border border-line bg-line">
          {WINDOWS.map((w) => {
            const active = w === seasonalWindow;
            return (
              <button
                key={w}
                type="button"
                onClick={() => onSelectWindow(w)}
                className={`px-2.5 py-1.5 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-raised text-ink font-medium'
                    : 'bg-ground text-ink-2 hover:text-ink'
                }`}
              >
                {windowText[w].shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Asymmetric Verdict + 3-Metric Strip */}
      <div className="border border-line bg-ground">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${badgeStyles}`}
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
          <span className="font-mono text-xs tabular-nums text-ink-2">
            {stats.startYear}–{periodEndLabel} · n = {stats.sampleCount} {t.trends.yearsSuffix} · {windowText[seasonalWindow].shortLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line">
          <div className="bg-ground px-4 py-3.5">
            <div className="text-xs text-ink-2">{t.trends.kpiSens}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-ink">
                {slopeSign}
                {stats.sensSlopePerDecade.toFixed(decimals)}
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-2">
                {unit} {t.trends.perDecade}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-ink-3">
              {t.trends.olsSlope}: {stats.olsSlopePerDecade >= 0 ? '+' : ''}
              {stats.olsSlopePerDecade.toFixed(decimals)}
            </div>
          </div>

          <div className="bg-ground px-4 py-3.5">
            <div className="text-xs text-ink-2">{t.trends.kpiMk}</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-ink">
                Z = {stats.mannKendallZ >= 0 ? '+' : ''}
                {stats.mannKendallZ.toFixed(2)}
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-2">
                p {pFormatted.startsWith('<') ? pFormatted : `= ${pFormatted}`}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-ink-3">
              S = {stats.mannKendallS} · Var = {Math.round(stats.mannKendallVarS)}
            </div>
          </div>

          <div className="bg-ground px-4 py-3.5">
            <div className="text-xs text-ink-2">{t.trends.kpiConf}</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-crop">
                {stats.confidencePct.toFixed(1)}%
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-2">
                R² = {stats.rSquared.toFixed(3)}
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] tabular-nums text-ink-3">
              {stats.baselineMean.toFixed(decimals)} → {stats.recentMean.toFixed(decimals)} {unit}
            </div>
          </div>
        </div>
      </div>

      {/* Time-Series Chart + Projection Mode */}
      <div className="border border-line bg-ground p-4 space-y-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {varLabel} · {t.trends.chartTitle}
            </h3>
            <p className="text-xs text-ink-2">
              {selectedForecastMode === 'ensemble' ? t.trends.kickerEnsemble : t.trends.kicker}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-px border border-line bg-line">
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
                        ? 'bg-raised text-warn font-medium'
                        : 'bg-raised text-crop font-medium'
                      : 'bg-ground text-ink-2 hover:text-ink'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
        </div>

        {selectedForecastMode === 'ensemble' && forecastStatus === 'loading' && (
          <div className="flex items-center gap-2 border border-crop/35 bg-crop/10 px-3 py-2 text-[11px] text-crop">
            <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span>{t.trends.ensembleLoading}</span>
          </div>
        )}
        {selectedForecastMode === 'ensemble' && forecastStatus === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            <span>
              <span className="font-semibold">{t.trends.ensembleError}:</span> {forecastError}{' '}
              {t.trends.ensembleFallback}
            </span>
            <button
              type="button"
              onClick={onRetryForecast}
              className="inline-flex items-center gap-1 rounded-md border border-warn/50 px-2 py-0.5 text-warn hover:bg-warn/20 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {t.trends.ensembleRetry}
            </button>
          </div>
        )}
        {isEnsemble && forecastDataset && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-ink-2">
            {!ensembleCoversVariable ? (
              <span className="font-sans text-warn">{t.trends.ensembleEvlandNote}</span>
            ) : (
            <span title={t.trends.ensembleSkillHint}>
              {t.trends.ensembleSkill}:{' '}
              <span
                className={
                  ensembleSkill === null
                    ? 'text-ink-3'
                    : ensembleSkill > 0
                    ? 'text-crop'
                    : 'text-warn'
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
            <span className="text-ink-3 font-sans">{t.trends.ensembleMapping}</span>
            {forecastDataset.sources.climateProjectionErrors && (
              <span
                className="font-sans text-warn"
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
              <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="year"
                stroke="var(--color-ink-3)"
                tick={{ fill: 'var(--color-ink-2)', fontSize: 11, fontFamily: 'Archivo, sans-serif' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
              />
              <YAxis
                stroke="var(--color-ink-3)"
                width={48}
                tick={{ fill: 'var(--color-ink-2)', fontSize: 11, fontFamily: 'Archivo, sans-serif' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
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
                  stroke="var(--color-ink-3)"
                  strokeDasharray="4 4"
                  label={{
                    value: t.trends.latestObsLabel,
                    position: 'insideTopLeft',
                    fill: 'var(--color-ink-2)',
                    fontSize: 10,
                    fontFamily: 'Archivo, sans-serif',
                  }}
                />
              )}
              {effectiveYear < maxYear && (
                <ReferenceLine
                  x={effectiveYear}
                  stroke="var(--color-crop)"
                  strokeWidth={1.5}
                />
              )}
              {forecastMode !== 'historical' && (
                <Area
                  type="monotone"
                  dataKey="ciBand"
                  stroke="none"
                  fill={forecastMode === 'cmip6_ssp585' ? 'var(--color-warn)' : lineAccent}
                  fillOpacity={0.14}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="trendLine"
                stroke="var(--color-ink-3)"
                strokeWidth={1.25}
                strokeDasharray="3 3"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-ink-2)"
                strokeWidth={1.5}
                dot={{ r: 1.75, fill: 'var(--color-ink)', strokeWidth: 0 }}
                activeDot={{ r: 4, fill: 'var(--color-ink)' }}
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
                  stroke={forecastMode === 'cmip6_ssp585' ? 'var(--color-warn)' : lineAccent}
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line pt-2.5 text-[11px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-ink-2" />
            <span>{t.trends.legendObserved}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5" style={{ backgroundColor: lineAccent }} />
            <span>{t.trends.legendMovingAvg}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 border-t border-dashed border-ink-3" />
            <span>{t.trends.legendTrendline}</span>
          </span>
          {forecastMode !== 'historical' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-0.5 w-3.5 border-t-2 border-dashed"
                  style={{ borderColor: forecastMode === 'cmip6_ssp585' ? 'var(--color-warn)' : lineAccent }}
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
                ? 'border-warn/40 bg-warn/10 text-warn'
                : 'border-line bg-ground text-ink'
            }`}
          >
            {lang === 'de' ? thresholdFinding.messageDe : thresholdFinding.messageEn}
          </div>
        )}

        <div className="border border-line bg-ground px-4 py-3.5 space-y-1.5">
          <div className="text-xs font-semibold text-ink">
            {t.trends.explainerPrefix}: {explainer.headline}
          </div>
          <p className="text-xs leading-relaxed text-ink-2">
            {explainer.statisticalInterpretation}
          </p>
          <p className="text-xs leading-relaxed text-ink-3">
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
    <div className="border border-line bg-ground px-3 py-2.5 text-xs font-mono tabular-nums text-ink">
      <div className="font-semibold border-b border-line pb-1 mb-1.5">
        {labels.tooltipYear} {label}
      </div>
      {pt.value !== null && (
        <div className="flex justify-between gap-4">
          <span className="text-ink-2">{labels.tooltipObserved}</span>
          <span>
            {pt.value.toFixed(decimals)} {unit}
          </span>
        </div>
      )}
      {pt.movingAvg5Yr !== null && (
        <div className="flex justify-between gap-4">
          <span className="text-ink-2">{labels.tooltipMovingAvg}</span>
          <span>
            {pt.movingAvg5Yr.toFixed(decimals)} {unit}
          </span>
        </div>
      )}
      {pt.projectedValue !== null && (
        <div className="flex justify-between gap-4 text-crop">
          <span>{labels.tooltipProjected}</span>
          <span>
            {pt.projectedValue.toFixed(decimals)} {unit}
          </span>
        </div>
      )}
      {pt.ciLower !== null && pt.ciUpper !== null && pt.year >= 2026 && (
        <div className="flex justify-between gap-4 text-ink-2">
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
      <div className="border border-line bg-ground p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <p className="text-xs text-ink-2">
              {t.soil.kicker} · <span className="font-mono text-ink">1990–{periodEndLabel}</span>
            </p>
            <h2 className="mt-0.5 text-sm font-semibold text-ink">
              {localizeRegionName(dataset.regionName, dataset.lat, dataset.lon, lang)}
            </h2>
          </div>
          <span className="rounded-md border border-crop/35 bg-crop/12 px-2.5 py-0.5 text-xs font-medium text-crop shrink-0">
            {localizeSoilTexture(dataset.soil.textureClass, lang)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-5 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-ink-2">{t.soil.phTitle}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
                  {dataset.soil.ph.toFixed(1)}
                </span>
                <span className="text-[11px] text-ink-2">
                  {dataset.soil.ph < 6.0
                    ? t.soil.phAcidic
                    : dataset.soil.ph > 7.5
                    ? t.soil.phAlkaline
                    : t.soil.phOptimal}
                </span>
              </div>
            </div>

            <div>
              <div className="text-xs text-ink-2">{t.soil.socTitle}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold tabular-nums text-crop">
                  {dataset.soil.socPercent.toFixed(2)}
                </span>
                <span className="font-mono text-xs text-ink-2">{t.soil.socUnit}</span>
              </div>
            </div>
          </div>

          <div className="md:col-span-7 space-y-2 md:border-l md:border-line md:pl-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <Layers3 className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
                <span>{t.soil.textureTitle}</span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink">
                {t.soil.clay} {dataset.soil.clayPercent}% · {t.soil.silt} {dataset.soil.siltPercent}% · {t.soil.sand} {dataset.soil.sandPercent}%
              </span>
            </div>

            <div className="flex h-2 w-full overflow-hidden bg-line">
              <div
                style={{ width: `${dataset.soil.clayPercent}%` }}
                className="bg-warn/85"
                title={`${t.soil.clay} ${dataset.soil.clayPercent}%`}
              />
              <div
                style={{ width: `${dataset.soil.siltPercent}%` }}
                className="bg-crop/85"
                title={`${t.soil.silt} ${dataset.soil.siltPercent}%`}
              />
              <div
                style={{ width: `${dataset.soil.sandPercent}%` }}
                className="bg-ink-3"
                title={`${t.soil.sand} ${dataset.soil.sandPercent}%`}
              />
            </div>

            <div className="flex items-center justify-between gap-4 text-[11px] text-ink-2 pt-0.5">
              <span className="inline-flex items-center gap-1.5">
                <Thermometer className="h-3 w-3 text-warn" aria-hidden="true" />
                <span>{t.soil.heatTitle}:</span>
                <span className="font-mono text-warn">
                  {dataset.peakHeatMonths.map((m) => monthNames[m - 1]).join(' · ')}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Droplets className="h-3 w-3 text-ink" aria-hidden="true" />
                <span>{t.soil.moistureTitle}:</span>
                <span className="font-mono text-ink">
                  {dataset.moistureDeficitMonths.map((m) => monthNames[m - 1]).join(' · ')}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Baseline Crop & Farm Priorities */}
      <div className="border border-line bg-ground p-4 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t.fieldShift.title}</h3>
            <p className="text-xs text-ink-2">{t.fieldShift.subtitle}</p>
          </div>
          <div className="sm:w-64">
            <label htmlFor="baseline-crop-select" className="sr-only">
              {t.fieldShift.baselineLabel}
            </label>
            <select
              id="baseline-crop-select"
              value={baselineCrop}
              onChange={(e) => onChangeBaselineCrop(e.target.value as BaselineCropId)}
              className="w-full rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-ink focus:border-crop focus:outline-none transition-colors duration-200 ease-out"
            >
              {BASELINE_CROP_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {BASELINE_CROP_TEXT[lang][opt.id].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 border-t border-line pt-3">
          {priorityItems.map((item) => (
            <label key={item.key} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-ink-2 w-36 shrink-0">{item.label}</span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={priorities[item.key]}
                onChange={(e) => onChangePriority(item.key, Number(e.target.value))}
                className="flex-1 accent-crop cursor-pointer"
              />
              <span className="font-mono text-[11px] tabular-nums text-ink w-8 text-right">
                {priorities[item.key]}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Asymmetric Scenario Selector & Detail */}
      {activeScenario && (
        <div className="border border-line bg-ground">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line border-b border-line">
            {scenarios.map((scenario) => {
              const selected = scenario.id === activeScenario.id;
              return (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => onSelectScenario(scenario.id)}
                  className={`p-3.5 text-left transition-colors duration-200 ease-out cursor-pointer ${
                    selected ? 'bg-raised' : 'bg-ground hover:bg-panel'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-2">{scenario.badgeLabel}</span>
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        selected ? 'text-crop' : 'text-ink'
                      }`}
                    >
                      {scenario.fitScore}/100
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-ink">{scenario.title}</div>
                  <div className="mt-0.5 text-[11px] text-ink-3 line-clamp-1">
                    {scenario.cropsSummary}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-4 space-y-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-ink">{t.fieldShift.whySuggested}</div>
              <p className="text-xs leading-relaxed text-ink-2">{activeScenario.whySuggested}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-line pt-3.5">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-crop">
                  {t.fieldShift.expectedBenefits}
                </div>
                <ul className="space-y-1 text-xs leading-relaxed text-ink">
                  {activeScenario.expectedBenefits.map((benefit, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-crop shrink-0" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-warn">
                  {t.fieldShift.risksValidation}
                </div>
                <ul className="space-y-1 text-xs leading-relaxed text-ink-2">
                  {activeScenario.risksAndValidation.map((risk, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-warn shrink-0" />
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Compact 36-Month Cover & Stress Calendar */}
            <div className="border-t border-line pt-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-ink">
                    {t.fieldShift.calendarTitle}
                  </h4>
                  <p className="text-[11px] text-ink-3">{t.fieldShift.calendarSubtitle}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 bg-line-strong" />
                    <span>{t.fieldShift.legendCash}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 bg-crop/75" />
                    <span>{t.fieldShift.legendCover}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 bg-warn/75" />
                    <span>{t.fieldShift.legendBare}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {activeScenario.calendarYears.map((yr) => (
                  <div key={yr.yearNumber} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-ink font-medium">{yr.yearLabel}</span>
                      <span className="text-ink-3 truncate ml-2">{yr.sequenceTitle}</span>
                    </div>
                    <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                      {yr.months.map((cell) => {
                        const isSelected =
                          selectedMonthCell?.yearLabel === yr.yearLabel &&
                          selectedMonthCell?.cell.month === cell.month;
                        const isActiveTimelineMonth = activeMonths.includes(cell.month);
                        const bgClass =
                          cell.coverStatus === 'cover'
                            ? 'bg-crop/20 border-crop/45 text-crop'
                            : cell.coverStatus === 'bare_risk'
                            ? 'bg-warn/20 border-warn/45 text-warn'
                            : 'bg-raised border-line-strong text-ink';
                        return (
                          <button
                            key={cell.month}
                            type="button"
                            onClick={() => onSelectMonthCell({ yearLabel: yr.yearLabel, cell })}
                            title={`${cell.monthLabel}: ${cell.cropName}`}
                            className={`rounded-md border px-1 py-1.5 text-center transition-colors duration-200 ease-out cursor-pointer ${bgClass} ${
                              isSelected
                                ? 'ring-1 ring-ink'
                                : isActiveTimelineMonth
                                ? 'ring-1 ring-crop/80'
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
                                    ? 'bg-warn'
                                    : cell.stressFlag === 'water_stress'
                                    ? 'bg-ink'
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

              <div className="border border-line bg-panel px-3 py-2 text-xs text-ink-2">
                {selectedMonthCell ? (
                  <div>
                    <span className="font-mono font-semibold text-ink">
                      {selectedMonthCell.yearLabel} · {selectedMonthCell.cell.monthLabel}:
                    </span>{' '}
                    <span className="text-crop font-medium">
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
