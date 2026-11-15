import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Droplets, RefreshCw } from 'lucide-react';
import type { useI18n } from '../i18n/I18nContext';
import { MONTH_SHORT_BY_LANG, type AppLanguage } from '../i18n/translations';
import { NORMAL_PERIOD } from '../utils/ensembleForecast';
import type {
  BackendVariable,
  ClimateForecastDataset,
  ForecastLoadStatus,
  RiskEventId,
} from '../types/terrashift';

type T = ReturnType<typeof useI18n>['t'];

interface ForecastRiskPanelProps {
  forecast: ClimateForecastDataset | null;
  status: ForecastLoadStatus;
  error: string | null;
  onRetry: () => void;
  lang: AppLanguage;
  t: T;
}

const YEARLY_INDICATORS: BackendVariable[] = [
  'gdd',
  'precip',
  'et0',
  'water_balance',
  'frost_days',
  'heat_days',
  'wet_days',
  'tmean',
  'soil_moisture_root',
];

/** For these indicators a positive anomaly is bad for most field crops (shown amber). */
const POSITIVE_IS_STRESS = new Set<BackendVariable>(['et0', 'heat_days']);
const NEGATIVE_IS_STRESS = new Set<BackendVariable>(['precip', 'water_balance', 'soil_moisture_root']);

const RISK_EVENTS: RiskEventId[] = ['dry', 'wet', 'drought', 'hot', 'frost'];

const MONTHLY_VARIABLES: BackendVariable[] = [
  'tmean',
  'precip',
  'et0',
  'water_balance',
  'soil_moisture_root',
  'gdd',
  'frost_days',
  'heat_days',
  'wet_days',
];

const UNIT_DE: Record<string, string> = { '°C·day': '°C·Tag', days: 'Tage' };
const unitText = (unit: string, lang: 'de' | 'en') => (lang === 'de' ? UNIT_DE[unit] ?? unit : unit);

function fmt(value: number, unit: string): string {
  const digits = unit === 'm³/m³' ? 3 : Math.abs(value) >= 100 ? 0 : 1;
  return value.toFixed(digits);
}

function signed(value: number, unit: string): string {
  return `${value >= 0 ? '+' : ''}${fmt(value, unit)}`;
}

export function ForecastRiskPanel({ forecast, status, error, onRetry, lang, t }: ForecastRiskPanelProps) {
  const ft = t.forecast;
  const [monthlyVar, setMonthlyVar] = useState<BackendVariable>('tmean');
  const monthNames = MONTH_SHORT_BY_LANG[lang];

  const monthlyData = useMemo(() => {
    const result = forecast?.variables[monthlyVar];
    if (!result) return [];
    // 1991–2020 normal per calendar month, where the observed history is available
    const history = forecast?.history[monthlyVar] ?? [];
    const sums = new Map<number, { s: number; n: number }>();
    for (const r of history) {
      if (r.year < NORMAL_PERIOD.start || r.year > NORMAL_PERIOD.end) continue;
      const acc = sums.get(r.month) ?? { s: 0, n: 0 };
      acc.s += r.value;
      acc.n += 1;
      sums.set(r.month, acc);
    }
    return result.forecast.map((m) => {
      const normal = sums.get(m.monthIndex);
      return {
        label: `${monthNames[m.monthIndex - 1]} ${String(m.year).slice(2)}`,
        month: m.month,
        forecast: m.forecast,
        band: [m.lower80, m.upper80] as [number, number],
        lower: m.lower80,
        upper: m.upper80,
        normal: normal ? Number((normal.s / normal.n).toFixed(3)) : null,
      };
    });
  }, [forecast, monthlyVar, monthNames]);

  if (status === 'loading' || status === 'idle') {
    return (
      <div role="tabpanel" className="space-y-4">
        <div className="flex items-start gap-3 border border-crop/35 bg-crop/10 px-4 py-3">
          <RefreshCw className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-crop" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-crop">{ft.loadingTitle}</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">{ft.loadingHint}</p>
          </div>
        </div>
        <div className="h-40 w-full bg-ground border border-line" />
        <div className="h-56 w-full bg-ground border border-line" />
      </div>
    );
  }

  if (status === 'error' || !forecast) {
    return (
      <div role="tabpanel" className="space-y-3">
        <div className="flex items-start gap-3 border border-warn/40 bg-warn/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <div className="space-y-1.5 min-w-0">
            <div className="text-sm font-semibold text-warn">{ft.errorTitle}</div>
            {error && <p className="text-xs text-warn break-words">{error}</p>}
            <p className="text-xs text-ink-2">{ft.errorHint}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-warn/50 px-2.5 py-1 text-xs text-warn hover:bg-warn/20 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {ft.retry}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const monthlyResult = forecast.variables[monthlyVar];
  const monthlyUnit = monthlyResult?.unit ?? '';
  const monthlySkill = monthlyResult?.skillVsClimatology ?? null;
  const src = forecast.sources;

  return (
    <div role="tabpanel" className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <p className="text-[11px] text-ink-3">
            {[
              ft.kicker,
              src.history ? `${src.history}${src.historyPeriod ? ` (${src.historyPeriod})` : ''}` : null,
              src.climateProjections?.length ? 'CMIP6' : null,
              src.climateIndices ? 'ENSO/NAO/PDO' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-ink">{ft.title}</h3>
          <p className="mt-0.5 text-xs text-ink-2">{ft.subtitle}</p>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-ink-2 text-right shrink-0">
          <div>
            {ft.trainedUntil}: <span className="text-ink">{forecast.trainedUntil}</span>
          </div>
          <div>
            {ft.horizon}: <span className="text-ink">{forecast.horizonMonths}</span> {ft.monthsUnit}
          </div>
        </div>
      </div>

      {src.climateProjectionErrors && (
        <div
          className="flex items-start gap-2 border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn"
          title={src.climateProjectionErrors.join('\n')}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t.trends.ensembleNoCmip}</span>
        </div>
      )}

      {/* Year-by-year indicators */}
      <div className="border border-line bg-ground">
        <div className="border-b border-line px-4 py-3">
          <h4 className="text-xs font-semibold text-ink">{ft.yearlyTitle}</h4>
          <p className="text-[11px] text-ink-3">{ft.yearlySubtitle}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-ink-2">
                <th className="px-4 py-2 text-left font-medium" />
                {forecast.agriSummary.map((y) => (
                  <th key={y.year} className="px-3 py-2 text-right font-mono font-semibold text-ink whitespace-nowrap">
                    {y.year}
                    {!y.completeYear && (
                      <div className="font-sans text-[10px] font-normal text-ink-3">
                        {ft.incompleteYear} ·{' '}
                        {y.monthsCovered.replace(/\d{4}-(\d{2})\s*–\s*\d{4}-(\d{2})/, (_, a, b) => `${monthNames[Number(a) - 1]}–${monthNames[Number(b) - 1]}`)}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {YEARLY_INDICATORS.map((key) => (
                <tr key={key} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2 text-ink-2 whitespace-nowrap">{ft.indicators[key]}</td>
                  {forecast.agriSummary.map((y) => {
                    const ind = y.indicators[key];
                    if (!ind) {
                      return (
                        <td key={y.year} className="px-3 py-2 text-right text-ink-3">
                          —
                        </td>
                      );
                    }
                    const stress =
                      (POSITIVE_IS_STRESS.has(key) && ind.anomaly > 0) ||
                      (NEGATIVE_IS_STRESS.has(key) && ind.anomaly < 0);
                    return (
                      <td key={y.year} className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-ink">
                          {fmt(ind.forecast, ind.unit)} <span className="text-[10px] text-ink-3">{unitText(ind.unit, lang)}</span>
                        </div>
                        <div className={`text-[10px] ${stress ? 'text-warn' : 'text-ink-3'}`}>
                          {signed(ind.anomaly, ind.unit)} vs. {ft.normalShort}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line border-t border-line">
          {forecast.agriSummary.map((y) => (
            <div key={y.year} className="bg-ground px-4 py-2.5 text-[11px] text-ink-2">
              <div className="font-mono font-semibold text-ink">
                {y.year} · {y.frostFreeMonths} {ft.frostFreeMonths}
              </div>
              <div className="mt-0.5">
                {ft.deficitMonths}:{' '}
                <span className="font-mono text-warn">
                  {y.deficitMonths.length === 0
                    ? ft.noDeficit
                    : y.deficitMonths.map((m) => monthNames[Number(m.slice(5, 7)) - 1]).join(' · ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Seasonal risk */}
      <div className="border border-line bg-ground">
        <div className="border-b border-line px-4 py-3">
          <h4 className="text-xs font-semibold text-ink">{ft.riskTitle}</h4>
          <p className="text-[11px] text-ink-3">{ft.riskSubtitle}</p>
        </div>
        <div className="divide-y divide-line">
          {forecast.risk.map((season) => {
            const seasonLabel =
              ft.seasons[season.seasonName as keyof typeof ft.seasons] ?? season.seasonName;
            const wd = season.waterDeficitMm;
            return (
              <div key={season.season} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-ink">
                    {seasonLabel} {season.seasonYear}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-ink-2"
                    title={ft.deficitNote}
                  >
                    <Droplets className="h-3 w-3 text-water" aria-hidden="true" />
                    {ft.deficitTitle}: <span className="text-ink">{wd.typical} mm</span> {ft.deficitTypical}
                    {' · '}
                    <span className="text-warn">{wd.dryYear1in5} mm</span> {ft.deficitDry}
                    {' · '}
                    {wd.extreme1in10} mm {ft.deficitExtreme}
                    {' · '}
                    <span className="text-ink-3">
                      {wd.normalTypical} mm {ft.deficitNormal}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  {RISK_EVENTS.map((id) => {
                    const ev = season.events[id];
                    if (!ev) {
                      return (
                        <div key={id} className="text-[11px] text-ink-3">
                          {ft.events[id]}: —
                        </div>
                      );
                    }
                    const elevated = ev.probability > ev.normalProbability + 0.05;
                    const p = Math.round(ev.probability * 100);
                    return (
                      <div key={id} title={ft.eventHints[id]} className="space-y-1">
                        <div className="flex items-baseline justify-between text-[11px]">
                          <span className="text-ink-2">{ft.events[id]}</span>
                          <span
                            className={`font-mono font-semibold tabular-nums ${
                              elevated ? 'text-warn' : 'text-ink'
                            }`}
                          >
                            {p}%
                          </span>
                        </div>
                        <div className="relative h-1.5 w-full bg-line">
                          <div
                            className={`absolute inset-y-0 left-0 ${elevated ? 'bg-warn/80' : 'bg-crop/70'}`}
                            style={{ width: `${p}%` }}
                          />
                          <div
                            className="absolute -top-0.5 -bottom-0.5 w-px bg-ink"
                            style={{ left: `${Math.round(ev.normalProbability * 100)}%` }}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="font-mono text-[10px] tabular-nums text-ink-3">
                          {ft.normalOdds} {Math.round(ev.normalProbability * 100)}% · {ft.recentOdds}{' '}
                          {Math.round(ev.observedRecent * 100)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Monthly forecast chart */}
      <div className="border border-line bg-ground p-4 space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-xs font-semibold text-ink">
              {ft.monthlyTitle} · {ft.indicators[monthlyVar]}
            </h4>
            <p className="text-[11px] text-ink-3">
              {ft.monthlySubtitle} ({unitText(monthlyUnit, lang)}) ·{' '}
              <span title={ft.skillHint}>
                {ft.skillLabel}:{' '}
                <span
                  className={
                    monthlySkill === null
                      ? ''
                      : monthlySkill > 0
                      ? 'text-crop'
                      : 'text-warn'
                  }
                >
                  {monthlySkill === null
                    ? '—'
                    : `${monthlySkill >= 0 ? '+' : ''}${(monthlySkill * 100).toFixed(1)}%`}
                </span>
              </span>
            </p>
          </div>
          <label className="sr-only" htmlFor="forecast-monthly-variable">
            {ft.monthlyTitle}
          </label>
          <select
            id="forecast-monthly-variable"
            value={monthlyVar}
            onChange={(e) => setMonthlyVar(e.target.value as BackendVariable)}
            className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-ink focus:border-crop focus:outline-none"
          >
            {MONTHLY_VARIABLES.filter((v) => forecast.variables[v]).map((v) => (
              <option key={v} value={v}>
                {ft.indicators[v]}
              </option>
            ))}
          </select>
        </div>

        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthlyData} margin={{ top: 8, right: 12, left: 2, bottom: 2 }}>
              <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--color-ink-3)"
                interval={2}
                tick={{ fill: 'var(--color-ink-2)', fontSize: 10, fontFamily: 'Archivo, sans-serif' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
              />
              <YAxis
                stroke="var(--color-ink-3)"
                width={46}
                tick={{ fill: 'var(--color-ink-2)', fontSize: 10, fontFamily: 'Archivo, sans-serif' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
                tickFormatter={(v: number) => fmt(v, monthlyUnit)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const pt = payload[0].payload as (typeof monthlyData)[number];
                  return (
                    <div className="border border-line bg-ground px-3 py-2 text-xs font-mono tabular-nums text-ink">
                      <div className="font-semibold border-b border-line pb-1 mb-1">{pt.month}</div>
                      <div className="flex justify-between gap-4 text-crop">
                        <span>{ft.legendForecast}</span>
                        <span>
                          {fmt(pt.forecast, monthlyUnit)} {unitText(monthlyUnit, lang)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4 text-ink-2">
                        <span>{ft.legendRange}</span>
                        <span>
                          {fmt(pt.lower, monthlyUnit)}–{fmt(pt.upper, monthlyUnit)}
                        </span>
                      </div>
                      {pt.normal !== null && (
                        <div className="flex justify-between gap-4 text-ink-2">
                          <span>{ft.legendNormal}</span>
                          <span>{fmt(pt.normal, monthlyUnit)}</span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="band"
                stroke="none"
                fill="var(--color-crop)"
                fillOpacity={0.16}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="normal"
                stroke="var(--color-ink-3)"
                strokeWidth={1.25}
                strokeDasharray="3 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="var(--color-crop)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line pt-2.5 text-[11px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-crop" />
            {ft.legendForecast}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 border border-crop/45 bg-crop/20" />
            {ft.legendRange}
          </span>
          {monthlyData.some((d) => d.normal !== null) && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 border-t border-dashed border-ink-3" />
              {ft.legendNormal}
            </span>
          )}
        </div>
      </div>

      {/* Sources & disclaimer */}
      <div className="border border-line bg-ground px-4 py-3 space-y-2 text-[11px]">
        <div className="text-xs font-semibold text-ink">{ft.sourcesTitle}</div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-ink-2">
          <div>
            <dt className="inline">{ft.sourceHistory}: </dt>
            <dd className="inline text-ink">{src.history ?? ft.none}</dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceProjections}: </dt>
            <dd className="inline font-mono text-ink">
              {src.climateProjections?.join(', ') ?? ft.none}
            </dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceIndices}: </dt>
            <dd className="inline font-mono text-ink">
              {src.climateIndices
                ? Object.entries(src.climateIndices)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')
                : ft.none}
            </dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceSeasonal}: </dt>
            <dd className="inline text-ink">{src.seasonalForecast ?? ft.none}</dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceStation}: </dt>
            <dd className="inline text-ink">{src.stationCalibration?.join(', ') ?? ft.none}</dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceProphet}: </dt>
            <dd className="inline text-ink">{src.prophetMember ? ft.yes : ft.no}</dd>
          </div>
        </dl>
        <p className="border-t border-line pt-2 leading-relaxed text-ink-3">{ft.disclaimer}</p>
      </div>
    </div>
  );
}
