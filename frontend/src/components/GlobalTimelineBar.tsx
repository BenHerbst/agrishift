import { Calendar, Pause, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { MONTH_SHORT_BY_LANG, VARIABLE_TEXT } from '../i18n/translations';
import { DISPLAY_START_YEAR, VARIABLE_META, type MonthlyTimelineSnapshot } from '../utils/statistics';
import type { ClimateVariable, ForecastMode } from '../types/terrashift';

export type TimelineStepIncrement = 1 | 3 | 12;

interface GlobalTimelineBarProps {
  stepIndex: number;
  maxStep: number;
  activeYear: number;
  activeMonth: number; // 1..12
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
}

const VARIABLES: ClimateVariable[] = ['T2M', 'PRECTOTCORR', 'GWETROOT', 'EVLAND'];

export function GlobalTimelineBar({
  stepIndex,
  maxStep,
  activeYear,
  activeMonth,
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
}: GlobalTimelineBarProps) {
  const { lang, t } = useI18n();
  const monthNames = MONTH_SHORT_BY_LANG[lang];
  const activeMonthLabel = monthNames[Math.max(0, Math.min(11, activeMonth - 1))];
  const isProjectedPeriod = activeYear > 2025;
  // The slider's last step defines the end year: 2025 (measured), ~2028 (ensemble) or 2035 (trend)
  const maxYear = DISPLAY_START_YEAR + Math.floor(Math.max(0, maxStep) / 12);
  const maxMonthLabel = monthNames[Math.max(0, Math.min(11, maxStep % 12))];

  const progressPct = maxStep > 0 ? Math.min(100, Math.max(0, (stepIndex / maxStep) * 100)) : 100;
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
      className="bg-[#111316] border-b border-[#262B33] px-4 sm:px-6 py-3 space-y-2.5"
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        {/* Left: Playback Controls + Active Month/Year Readout */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={isLoading}
            className={`inline-flex items-center gap-1.5 rounded-[2px] border px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-out cursor-pointer disabled:opacity-40 ${
              isPlaying
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                : 'border-emerald-500/55 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
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
          <div className="flex items-center gap-px border border-[#262B33] bg-[#262B33]">
            {stepOptions.map((opt) => {
              const active = stepIncrement === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeStepIncrement(opt.value)}
                  className={`px-2 py-1 text-[11px] font-mono transition-colors duration-200 ease-out cursor-pointer ${
                    active
                      ? 'bg-[#222730] text-emerald-300 font-semibold'
                      : 'bg-[#171A1F] text-[#A1A8B3] hover:text-[#ECEEF0]'
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
              className="inline-flex items-center gap-1 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-2.5 py-1 text-[11px] text-[#A1A8B3] hover:text-[#ECEEF0] transition-colors duration-200 ease-out cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>{t.trends.resetBtn}</span>
            </button>
          )}

          <div className="flex items-center gap-2 pl-1">
            <Calendar className="h-3.5 w-3.5 text-[#7C8490]" aria-hidden="true" />
            <span className="font-mono text-sm font-semibold tabular-nums text-[#ECEEF0] min-w-[78px]">
              {activeMonthLabel} {activeYear}
            </span>
            <span
              className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                isProjectedPeriod
                  ? 'border-amber-500/40 bg-amber-500/12 text-amber-300'
                  : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {isProjectedPeriod ? t.trends.projBadge : t.trends.obsBadge}
            </span>
            {forecastLoading && (
              <span className="inline-flex items-center gap-1 rounded-[2px] border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                {t.trends.timelineForecastLoading}
              </span>
            )}
          </div>
        </div>

        {/* Right: 4 Live Monthly KPI Telemetry Chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px border border-[#262B33] bg-[#262B33]">
          {VARIABLES.map((variable) => {
            const active = selectedVariable === variable;
            const meta = VARIABLE_META[variable];
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
                    ? 'bg-[#1E232B] ring-1 ring-inset ring-emerald-500/50'
                    : 'bg-[#171A1F] hover:bg-[#1B2027]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] text-[#A1A8B3]">
                  <span className={active ? 'text-emerald-300 font-medium' : ''}>
                    {VARIABLE_TEXT[lang][variable].shortLabel}
                  </span>
                  {valEntry && (
                    <span
                      className={`font-mono tabular-nums ${
                        isWarningAnom ? 'text-amber-300' : 'text-[#7C8490]'
                      }`}
                    >
                      {anomSign}
                      {anom.toFixed(decimals)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#ECEEF0]">
                  {isLoading || !valEntry
                    ? '—'
                    : `${valEntry.value.toFixed(decimals)} ${meta.unit}`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Row: Full-Width Month-by-Month Range Slider + Decade Scale */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-[#7C8490] shrink-0">
            {monthNames[0]} {DISPLAY_START_YEAR}
          </span>

          <div className="relative flex-1 flex items-center">
            {forecastMode !== 'historical' && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#7C8490]/60 z-0"
                style={{ left: `${cutoff2025Pct}%` }}
              />
            )}
            <input
              type="range"
              min={0}
              max={maxStep}
              step={1}
              value={Math.min(stepIndex, maxStep)}
              disabled={isLoading}
              onChange={(e) => onChangeStep(Number(e.target.value))}
              aria-label={t.trends.timelineAria}
              style={{
                background: `linear-gradient(to right, ${
                  isProjectedPeriod ? '#d97706' : '#10b981'
                } ${progressPct}%, #262B33 ${progressPct}%)`,
              }}
              className="relative z-10 w-full h-1.5 appearance-none rounded-[2px] accent-emerald-400 cursor-pointer disabled:opacity-50"
            />
          </div>

          <span className="font-mono text-[11px] tabular-nums text-[#7C8490] shrink-0">
            {maxMonthLabel} {maxYear}
          </span>
        </div>

        {/* Clean Year Scale Ticks */}
        <div className="hidden sm:flex items-center justify-between px-16 font-mono text-[10px] tabular-nums text-[#7C8490]">
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
              className={`cursor-pointer transition-colors hover:text-[#ECEEF0] ${
                yr === activeYear ? 'text-emerald-300 font-semibold' : ''
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
