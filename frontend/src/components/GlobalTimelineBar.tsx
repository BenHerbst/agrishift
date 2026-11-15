import { Calendar, Pause, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { MONTH_SHORT_BY_LANG, VARIABLE_TEXT } from '../i18n/translations';
import { DISPLAY_START_YEAR, unitLabel, type MonthlyTimelineSnapshot } from '../utils/statistics';
import type { ClimateVariable, ForecastMode } from '../types/terrashift';

export type TimelineStepIncrement = 1 | 3 | 12;

interface GlobalTimelineBarProps {
  stepIndex: number;
  maxStep: number;
  /** End year of the active period. */
  activeYear: number;
  /** "Jul 2027", "Jun – Aug 2027" or "2027". */
  periodLabel: string;
  isPlaying: boolean;
  stepIncrement: TimelineStepIncrement;
  forecastMode: ForecastMode;
  /** The backend ensemble forecast is still being trained/loaded. */
  forecastLoading?: boolean;
  selectedVariable: ClimateVariable;
  activeMonthValues: MonthlyTimelineSnapshot['activeMonthValues'] | null;
  isLoading: boolean;
  onChangeStep: (nextStep: number) => void;
  onTogglePlay: () => void;
  onResetToFull: () => void;
  onChangeStepIncrement: (inc: TimelineStepIncrement) => void;
  onSelectVariable: (v: ClimateVariable) => void;
  /** Selected variable per year (trend window), drawn as climate stripes behind the slider. */
  stripes: Array<{ year: number; value: number | null }>;
  /** First and last slider step of the active period, highlighted on the stripes. */
  periodSteps: [number, number];
}

// ColorBrewer RdBu / BrBG, low → high
const STRIPE_RAMPS: Record<ClimateVariable, string[]> = {
  T2M: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f4f1ea', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
  PRECTOTCORR: ['#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#eef0ea', '#c7eae5', '#80cdc1', '#35978f', '#01665e'],
  GWETROOT: ['#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#eef0ea', '#c7eae5', '#80cdc1', '#35978f', '#01665e'],
  // More evaporation = drier, so the ramp runs the other way
  EVLAND: ['#01665e', '#35978f', '#80cdc1', '#c7eae5', '#eef0ea', '#f6e8c3', '#dfc27d', '#bf812d', '#8c510a'],
};

/** Colour per year: anomaly against the measured years' mean, ±2 standard deviations span the ramp. */
function stripeColors(stripes: GlobalTimelineBarProps['stripes'], variable: ClimateVariable): Map<number, string> {
  const measured = stripes.filter((s) => s.year <= 2025 && s.value !== null).map((s) => s.value as number);
  const out = new Map<number, string>();
  if (measured.length < 3) return out;
  const mean = measured.reduce((a, v) => a + v, 0) / measured.length;
  const sd = Math.sqrt(measured.reduce((a, v) => a + (v - mean) ** 2, 0) / measured.length) || 1;
  const ramp = STRIPE_RAMPS[variable];
  for (const { year, value } of stripes) {
    if (value === null) continue;
    const z = Math.max(-1, Math.min(1, (value - mean) / (2 * sd)));
    out.set(year, ramp[Math.round(((z + 1) / 2) * (ramp.length - 1))]);
  }
  return out;
}

const VARIABLES: ClimateVariable[] = ['T2M', 'PRECTOTCORR', 'GWETROOT', 'EVLAND'];

export function GlobalTimelineBar({
  stepIndex,
  maxStep,
  activeYear,
  periodLabel,
  isPlaying,
  stepIncrement,
  forecastMode,
  forecastLoading = false,
  selectedVariable,
  activeMonthValues,
  isLoading,
  onChangeStep,
  onTogglePlay,
  onResetToFull,
  onChangeStepIncrement,
  onSelectVariable,
  stripes,
  periodSteps,
}: GlobalTimelineBarProps) {
  const { lang, t } = useI18n();
  const monthNames = MONTH_SHORT_BY_LANG[lang];
  const isProjectedPeriod = activeYear > 2025;
  // The slider's last step defines the end year: 2025 (measured), ~2028 (ensemble) or 2035 (trend)
  const maxYear = DISPLAY_START_YEAR + Math.floor(Math.max(0, maxStep) / 12);

  const stepPct = (step: number) => (maxStep > 0 ? Math.min(100, Math.max(0, (step / (maxStep + 1)) * 100)) : 0);
  const colors = stripeColors(stripes, selectedVariable);
  const stripeYears: number[] = [];
  for (let yr = DISPLAY_START_YEAR; yr <= maxYear; yr++) stripeYears.push(yr);
  const cutoff2025Step = (2025 - DISPLAY_START_YEAR) * 12 + 11;
  const cutoff2025Pct = maxStep > 0 ? Math.min(100, (cutoff2025Step / maxStep) * 100) : 100;

  const stepOptions: Array<{ value: TimelineStepIncrement; label: string }> = [
    { value: 1, label: t.trends.stepMonth },
    { value: 3, label: t.trends.stepQuarter },
    { value: 12, label: t.trends.stepYear },
  ];

  // Every 5 years from the start, always including 2025 (end of measurements) and the last year
  const tickYears: number[] = [];
  for (let yr = DISPLAY_START_YEAR; yr <= maxYear; yr += 5) tickYears.push(yr);
  if (maxYear >= 2025 && !tickYears.includes(2025)) tickYears.push(2025);
  if (!tickYears.includes(maxYear)) tickYears.push(maxYear);
  tickYears.sort((a, b) => a - b);

  return (
    <section
      aria-label={t.trends.timelineLabel}
      className="bg-ground border-b border-line px-4 sm:px-6 py-3 space-y-2.5"
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        {/* Left: Playback Controls + Active Month/Year Readout */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={isLoading}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-out cursor-pointer disabled:opacity-40 ${
              isPlaying
                ? 'border-warn/50 bg-warn/15 text-warn'
                : 'border-crop/55 bg-crop/15 text-crop hover:bg-crop/25'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t.trends.pauseBtn}</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t.trends.playBtn}</span>
              </>
            )}
          </button>

          {/* Granularity / Speed: 1M | 3M | 1J */}
          <div className="flex items-center gap-px border border-line bg-line">
            {stepOptions.map((opt) => {
              const active = stepIncrement === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeStepIncrement(opt.value)}
                  className={`px-2 py-1 text-[11px] font-mono transition-colors duration-200 ease-out cursor-pointer ${
                    active
                      ? 'bg-raised text-crop font-semibold'
                      : 'bg-panel text-ink-2 hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {stepIndex < maxStep && (
            <button
              type="button"
              onClick={onResetToFull}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1 text-[11px] text-ink-2 hover:text-ink transition-colors duration-200 ease-out cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>{t.trends.resetBtn}</span>
            </button>
          )}

          <div className="flex items-center gap-2 pl-1">
            <Calendar className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
            <span className="font-mono text-sm font-semibold tabular-nums text-ink min-w-[78px] whitespace-nowrap">
              {stepIncrement > 1 && <span className="mr-1 text-ink-3">Ø</span>}
              {periodLabel}
            </span>
            <span
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
                isProjectedPeriod
                  ? 'border-warn/40 bg-warn/12 text-warn'
                  : 'border-crop/35 bg-crop/10 text-crop'
              }`}
            >
              {isProjectedPeriod ? t.trends.projBadge : t.trends.obsBadge}
            </span>
            {forecastLoading && (
              <span className="inline-flex items-center gap-1 rounded-md border border-crop/35 bg-crop/10 px-1.5 py-0.5 text-[10px] text-crop">
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                {t.trends.timelineForecastLoading}
              </span>
            )}
          </div>
        </div>

        {/* Right: 4 Live Monthly KPI Telemetry Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px border border-line bg-line">
          {VARIABLES.map((variable) => {
            const active = selectedVariable === variable;
            const decimals = variable === 'GWETROOT' ? 3 : 2;
            const valEntry = activeMonthValues?.[variable];
            const anom = valEntry?.anomaly ?? 0;
            const anomSign = anom >= 0 ? '+' : '';
            const isWarningAnom =
              (variable === 'T2M' && anom > 0.4) ||
              (variable === 'GWETROOT' && anom < -0.025) ||
              (variable === 'PRECTOTCORR' && anom < -0.25) ||
              (variable === 'EVLAND' && anom > 0.25);

            return (
              <button
                key={variable}
                type="button"
                onClick={() => onSelectVariable(variable)}
                className={`px-3 py-1.5 text-left transition-colors duration-200 ease-out cursor-pointer min-w-[132px] ${
                  active
                    ? 'bg-raised ring-1 ring-inset ring-crop/50'
                    : 'bg-panel hover:bg-raised'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] text-ink-2">
                  <span className={active ? 'text-crop font-medium' : ''}>
                    {VARIABLE_TEXT[lang][variable].shortLabel}
                  </span>
                  {valEntry && (
                    <span
                      className={`font-mono tabular-nums ${
                        isWarningAnom ? 'text-warn' : 'text-ink-3'
                      }`}
                    >
                      {anomSign}
                      {anom.toFixed(decimals)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-ink">
                  {isLoading || !valEntry
                    ? '—'
                    : `${valEntry.value.toFixed(decimals)} ${unitLabel(variable, lang)}`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Row: Full-Width Month-by-Month Range Slider + Decade Scale */}
      <div className="space-y-1.5">
        <div className="relative h-11">
          {/* One stripe per year; months after the slider stay faded until they are reached */}
          <div aria-hidden="true" className="absolute inset-0 flex overflow-hidden rounded-md ring-1 ring-line bg-raised">
            {stripeYears.map((yr) => {
              const months = yr < maxYear ? 12 : (maxStep % 12) + 1;
              return (
                <div
                  key={yr}
                  className="h-full transition-opacity duration-300"
                  style={{
                    flex: months,
                    background: colors.get(yr) ?? 'transparent',
                    opacity: yr > activeYear ? 0.32 : 1,
                  }}
                />
              );
            })}
          </div>
          {forecastMode !== 'historical' && cutoff2025Step < maxStep && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 border-l-2 border-dashed border-ink/50"
              style={{ left: `${cutoff2025Pct}%` }}
            >
              <span className="absolute bottom-1 left-1 rounded-sm bg-panel/85 px-1 text-[10px] font-semibold text-ink">{t.trends.projBadge}</span>
            </div>
          )}
          {/* Active period bracket */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-y-1 rounded-sm border-2 border-ink bg-white/25 transition-[left,width] duration-200 ease-out"
            style={{
              left: `${stepPct(periodSteps[0])}%`,
              width: `max(4px, ${stepPct(periodSteps[1] + 1) - stepPct(periodSteps[0])}%)`,
            }}
          />
          <input
            type="range"
            min={0}
            max={maxStep}
            step={1}
            value={Math.min(stepIndex, maxStep)}
            disabled={isLoading}
            onChange={(e) => onChangeStep(Number(e.target.value))}
            aria-label={t.trends.timelineAria}
            aria-valuetext={periodLabel}
            className="timeline-range absolute inset-0 h-full w-full cursor-pointer disabled:cursor-wait"
          />
        </div>

        <div className="relative h-4 text-[11px] font-mono text-ink-3">
          {tickYears.map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => {
                const targetStep = Math.min(
                  maxStep,
                  (yr - DISPLAY_START_YEAR) * 12 + (yr === maxYear ? maxStep % 12 : 6)
                );
                onChangeStep(targetStep);
              }}
              style={{ left: `${stepPct((yr - DISPLAY_START_YEAR) * 12 + 6)}%` }}
              className={`absolute -translate-x-1/2 cursor-pointer transition-colors hover:text-ink ${
                yr === activeYear ? 'text-ink font-semibold' : ''
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3">{t.trends.stripesHint}</p>
      </div>
    </section>
  );
}
