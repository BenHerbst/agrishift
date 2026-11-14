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
        <div className="flex items-start gap-3 border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
          <RefreshCw className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-emerald-300" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-emerald-200">{ft.loadingTitle}</div>
            <p className="mt-1 text-xs leading-relaxed text-[#A1A8B3]">{ft.loadingHint}</p>
          </div>
        </div>
        <div className="h-40 w-full bg-[#111316] border border-[#262B33]" />
        <div className="h-56 w-full bg-[#111316] border border-[#262B33]" />
      </div>
    );
  }

  if (status === 'error' || !forecast) {
    return (
      <div role="tabpanel" className="space-y-3">
        <div className="flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
          <div className="space-y-1.5 min-w-0">
            <div className="text-sm font-semibold text-amber-200">{ft.errorTitle}</div>
            {error && <p className="text-xs text-amber-100/90 break-words">{error}</p>}
            <p className="font-mono text-[11px] text-[#A1A8B3]">{ft.errorHint}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-[2px] border border-amber-500/50 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/20 cursor-pointer"
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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#262B33] pb-3">
        <div className="min-w-0">
          <p className="text-[11px] text-[#7C8490]">{ft.kicker}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-[#ECEEF0]">{ft.title}</h3>
          <p className="mt-0.5 text-xs text-[#A1A8B3]">{ft.subtitle}</p>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-[#A1A8B3] text-right shrink-0">
          <div>
            {ft.trainedUntil}: <span className="text-[#ECEEF0]">{forecast.trainedUntil}</span>
          </div>
          <div>
            {ft.horizon}: <span className="text-[#ECEEF0]">{forecast.horizonMonths}</span> {ft.monthsUnit}
          </div>
        </div>
      </div>

      {src.climateProjectionErrors && (
        <div
          className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
          title={src.climateProjectionErrors.join('\n')}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t.trends.ensembleNoCmip}</span>
        </div>
      )}

      {/* Year-by-year indicators */}
      <div className="border border-[#262B33] bg-[#111316]">
        <div className="border-b border-[#262B33] px-4 py-3">
          <h4 className="text-xs font-semibold text-[#ECEEF0]">{ft.yearlyTitle}</h4>
          <p className="text-[11px] text-[#7C8490]">{ft.yearlySubtitle}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#262B33] text-[#A1A8B3]">
                <th className="px-4 py-2 text-left font-medium" />
                {forecast.agriSummary.map((y) => (
                  <th key={y.year} className="px-3 py-2 text-right font-mono font-semibold text-[#ECEEF0] whitespace-nowrap">
                    {y.year}
                    {!y.completeYear && (
                      <div className="font-sans text-[10px] font-normal text-[#7C8490]">
                        {ft.incompleteYear} · {y.monthsCovered}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {YEARLY_INDICATORS.map((key) => (
                <tr key={key} className="border-b border-[#262B33] last:border-b-0">
                  <td className="px-4 py-2 text-[#A1A8B3] whitespace-nowrap">{ft.indicators[key]}</td>
                  {forecast.agriSummary.map((y) => {
                    const ind = y.indicators[key];
                    if (!ind) {
                      return (
                        <td key={y.year} className="px-3 py-2 text-right text-[#7C8490]">
                          —
                        </td>
                      );
                    }
                    const stress =
                      (POSITIVE_IS_STRESS.has(key) && ind.anomaly > 0) ||
                      (NEGATIVE_IS_STRESS.has(key) && ind.anomaly < 0);
                    return (
                      <td key={y.year} className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-[#ECEEF0]">
                          {fmt(ind.forecast, ind.unit)} <span className="text-[10px] text-[#7C8490]">{ind.unit}</span>
                        </div>
                        <div className={`text-[10px] ${stress ? 'text-amber-300' : 'text-[#7C8490]'}`}>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#262B33] border-t border-[#262B33]">
          {forecast.agriSummary.map((y) => (
            <div key={y.year} className="bg-[#111316] px-4 py-2.5 text-[11px] text-[#A1A8B3]">
              <div className="font-mono font-semibold text-[#ECEEF0]">
                {y.year} · {y.frostFreeMonths} {ft.frostFreeMonths}
              </div>
              <div className="mt-0.5">
                {ft.deficitMonths}:{' '}
                <span className="font-mono text-amber-200">
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
      <div className="border border-[#262B33] bg-[#111316]">
        <div className="border-b border-[#262B33] px-4 py-3">
          <h4 className="text-xs font-semibold text-[#ECEEF0]">{ft.riskTitle}</h4>
          <p className="text-[11px] text-[#7C8490]">{ft.riskSubtitle}</p>
        </div>
        <div className="divide-y divide-[#262B33]">
          {forecast.risk.map((season) => {
            const seasonLabel =
              ft.seasons[season.seasonName as keyof typeof ft.seasons] ?? season.seasonName;
            const wd = season.waterDeficitMm;
            return (
              <div key={season.season} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#ECEEF0]">
                    {seasonLabel} {season.seasonYear}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-[#A1A8B3]"
                    title={ft.deficitNote}
                  >
                    <Droplets className="h-3 w-3 text-sky-300" aria-hidden="true" />
                    {ft.deficitTitle}: <span className="text-[#ECEEF0]">{wd.typical} mm</span> {ft.deficitTypical}
                    {' · '}
                    <span className="text-amber-200">{wd.dryYear1in5} mm</span> {ft.deficitDry}
                    {' · '}
                    {wd.extreme1in10} mm {ft.deficitExtreme}
                    {' · '}
                    <span className="text-[#7C8490]">
                      {wd.normalTypical} mm {ft.deficitNormal}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  {RISK_EVENTS.map((id) => {
                    const ev = season.events[id];
                    if (!ev) {
                      return (
                        <div key={id} className="text-[11px] text-[#7C8490]">
                          {ft.events[id]}: —
                        </div>
                      );
                    }
                    const elevated = ev.probability > ev.normalProbability + 0.05;
                    const p = Math.round(ev.probability * 100);
                    return (
                      <div key={id} title={ft.eventHints[id]} className="space-y-1">
                        <div className="flex items-baseline justify-between text-[11px]">
                          <span className="text-[#A1A8B3]">{ft.events[id]}</span>
                          <span
                            className={`font-mono font-semibold tabular-nums ${
                              elevated ? 'text-amber-300' : 'text-[#ECEEF0]'
                            }`}
                          >
                            {p}%
                          </span>
                        </div>
                        <div className="relative h-1.5 w-full bg-[#262B33]">
                          <div
                            className={`absolute inset-y-0 left-0 ${elevated ? 'bg-amber-500/80' : 'bg-emerald-500/70'}`}
                            style={{ width: `${p}%` }}
                          />
                          <div
                            className="absolute -top-0.5 -bottom-0.5 w-px bg-[#ECEEF0]"
                            style={{ left: `${Math.round(ev.normalProbability * 100)}%` }}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="font-mono text-[10px] tabular-nums text-[#7C8490]">
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
      <div className="border border-[#262B33] bg-[#111316] p-4 space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-xs font-semibold text-[#ECEEF0]">
              {ft.monthlyTitle} · {ft.indicators[monthlyVar]}
            </h4>
            <p className="text-[11px] text-[#7C8490]">
              {ft.monthlySubtitle} ({monthlyUnit}) ·{' '}
              <span title={ft.skillHint}>
                {ft.skillLabel}:{' '}
                <span
                  className={
                    monthlySkill === null
                      ? ''
                      : monthlySkill > 0
                      ? 'text-emerald-300'
                      : 'text-amber-300'
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
            className="rounded-[2px] border border-[#262B33] bg-[#171A1F] px-2.5 py-1 text-xs text-[#ECEEF0] focus:border-emerald-400 focus:outline-none"
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
              <CartesianGrid stroke="#262B33" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#7C8490"
                interval={2}
                tick={{ fill: '#A1A8B3', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#262B33' }}
              />
              <YAxis
                stroke="#7C8490"
                width={46}
                tick={{ fill: '#A1A8B3', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#262B33' }}
                tickFormatter={(v: number) => fmt(v, monthlyUnit)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const pt = payload[0].payload as (typeof monthlyData)[number];
                  return (
                    <div className="border border-[#262B33] bg-[#111316] px-3 py-2 text-xs font-mono tabular-nums text-[#ECEEF0]">
                      <div className="font-semibold border-b border-[#262B33] pb-1 mb-1">{pt.month}</div>
                      <div className="flex justify-between gap-4 text-emerald-300">
                        <span>{ft.legendForecast}</span>
                        <span>
                          {fmt(pt.forecast, monthlyUnit)} {monthlyUnit}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4 text-[#A1A8B3]">
                        <span>{ft.legendRange}</span>
                        <span>
                          {fmt(pt.lower, monthlyUnit)}–{fmt(pt.upper, monthlyUnit)}
                        </span>
                      </div>
                      {pt.normal !== null && (
                        <div className="flex justify-between gap-4 text-[#A1A8B3]">
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
                fill="#10b981"
                fillOpacity={0.16}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="normal"
                stroke="#7C8490"
                strokeWidth={1.25}
                strokeDasharray="3 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#262B33] pt-2.5 text-[11px] text-[#A1A8B3]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-emerald-500" />
            {ft.legendForecast}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-3.5 border border-emerald-500/45 bg-emerald-500/20" />
            {ft.legendRange}
          </span>
          {monthlyData.some((d) => d.normal !== null) && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 border-t border-dashed border-[#7C8490]" />
              {ft.legendNormal}
            </span>
          )}
        </div>
      </div>

      {/* Sources & disclaimer */}
      <div className="border border-[#262B33] bg-[#111316] px-4 py-3 space-y-2 text-[11px]">
        <div className="text-xs font-semibold text-[#ECEEF0]">{ft.sourcesTitle}</div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[#A1A8B3]">
          <div>
            <dt className="inline">{ft.sourceHistory}: </dt>
            <dd className="inline text-[#ECEEF0]">{src.history ?? ft.none}</dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceProjections}: </dt>
            <dd className="inline font-mono text-[#ECEEF0]">
              {src.climateProjections?.join(', ') ?? ft.none}
            </dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceIndices}: </dt>
            <dd className="inline font-mono text-[#ECEEF0]">
              {src.climateIndices
                ? Object.entries(src.climateIndices)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')
                : ft.none}
            </dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceSeasonal}: </dt>
            <dd className="inline text-[#ECEEF0]">{src.seasonalForecast ?? ft.none}</dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceStation}: </dt>
            <dd className="inline text-[#ECEEF0]">{src.stationCalibration?.join(', ') ?? ft.none}</dd>
          </div>
          <div>
            <dt className="inline">{ft.sourceProphet}: </dt>
            <dd className="inline text-[#ECEEF0]">{src.prophetMember ? ft.yes : ft.no}</dd>
          </div>
        </dl>
        <p className="border-t border-[#262B33] pt-2 leading-relaxed text-[#7C8490]">{ft.disclaimer}</p>
      </div>
    </div>
  );
}
