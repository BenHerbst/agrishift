/**
 * Bridges the forecast backend (ERA5-based, backend units) and the frontend's NASA POWER
 * series (1990–2025) with the delta method. All normals are 1991–2020 statistics for the same
 * calendar month, so the forecast continues the NASA POWER curve without a level jump:
 *
 *   additive      NASA_mean + (forecast − backend_mean)                       temperature
 *   ratio         NASA_mean × (forecast ÷ backend_mean)                       precipitation
 *   standardized  NASA_mean + (forecast − backend_mean) / backend_sd × NASA_sd  root-zone moisture
 *   recent_clim   NASA mean of the last 15 years (± 1.28 sd for the 80 % range) evapotranspiration
 *
 * Choice per variable, checked against Aachen JJA 1991–2025 (NASA vs. backend history):
 *   T2M ↔ tmean          r = 0.96, same variability                → additive
 *   PRECTOTCORR ↔ precip r = 0.95, same relative variability       → ratio
 *   GWETROOT ↔ root SM   r = 0.43, ERA5 relative sd ~1.3× larger   → standardized (ratio would exaggerate)
 *   EVLAND ↔ et0         r = −0.15: ET0 is atmospheric demand, EVLAND actual ET, which drops in dry
 *                        summers when ET0 rises. The backend has no actual-ET forecast, so EVLAND
 *                        continues with the recent NASA climatology instead of a mapped forecast.
 *
 * The backend's own CMIP6 projection and /risk endpoint use the same shift-by-delta idea.
 */
import type {
  AnnualPoint,
  BackendVariable,
  ClimateForecastDataset,
  ClimateVariable,
  EnsembleMonthlyPoint,
  EnsembleRecordsByVariable,
  MonthlyRecord,
  SeasonalWindow,
} from '../types/terrashift';

export const NORMAL_PERIOD = { start: 1991, end: 2020 } as const;

/** Ratio limits as in backend/app/risk.py, so one odd month can't explode the mapping. */
const RATIO_LIMITS: [number, number] = [0.5, 2.0];

export type BridgeMethod = 'additive' | 'ratio' | 'standardized' | 'recent_climatology';

interface VariableBridge {
  backend: BackendVariable;
  method: BridgeMethod;
  /** Converts a backend monthly value to the NASA POWER unit before the delta is formed. */
  toFrontendUnit: (value: number, year: number, month: number) => number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const perDay = (value: number, year: number, month: number) => value / daysInMonth(year, month);
const identity = (value: number) => value;

export const VARIABLE_BRIDGE: Record<ClimateVariable, VariableBridge> = {
  // °C mean ↔ °C mean
  T2M: { backend: 'tmean', method: 'additive', toFrontendUnit: identity },
  // mm/month total ↔ mm/day rate
  PRECTOTCORR: { backend: 'precip', method: 'ratio', toFrontendUnit: perDay },
  // volumetric m³/m³ ↔ saturation fraction, different variability → standardized anomaly
  GWETROOT: { backend: 'soil_moisture_root', method: 'standardized', toFrontendUnit: identity },
  // reference ET0 is not actual ET (anti-correlated in dry summers) → recent NASA climatology
  EVLAND: { backend: 'et0', method: 'recent_climatology', toFrontendUnit: perDay },
};

/** Years of NASA POWER record behind the EVLAND recent climatology. */
export const RECENT_CLIMATOLOGY_YEARS = 15;
const Z80 = 1.2816;

function clampByVariable(variable: ClimateVariable, val: number): number {
  if (variable === 'GWETROOT') return Math.min(0.98, Math.max(0.04, val));
  if (variable === 'PRECTOTCORR' || variable === 'EVLAND') return Math.max(0.02, val);
  return val;
}

function calendarMonthStats(
  records: Array<{ year: number; month: number; value: number }>,
  startYear: number,
  endYear: number
): Map<number, { mean: number; sd: number }> {
  const byMonth = new Map<number, number[]>();
  for (const r of records) {
    if (r.year < startYear || r.year > endYear) continue;
    if (!Number.isFinite(r.value) || r.value <= -900) continue;
    const arr = byMonth.get(r.month);
    if (arr) arr.push(r.value);
    else byMonth.set(r.month, [r.value]);
  }
  const stats = new Map<number, { mean: number; sd: number }>();
  for (const [m, vals] of byMonth) {
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const sd =
      vals.length > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1)) : 0;
    stats.set(m, { mean, sd });
  }
  return stats;
}

function lastRecordKey(records: MonthlyRecord[]): number {
  let key = -Infinity;
  for (const r of records) {
    if (!Number.isFinite(r.value) || r.value <= -900) continue;
    key = Math.max(key, r.year * 12 + r.month);
  }
  return key;
}

/**
 * Builds the monthly continuation of each NASA POWER series from the backend dataset:
 * observed ERA5 months after the NASA archive ends (zero-width range), then the forecast
 * months with their 80 % range. Returns null if the backend lacks a variable.
 */
export function buildEnsembleMonthlyRecords(
  forecast: ClimateForecastDataset,
  nasaRecordsByVariable: Record<ClimateVariable, MonthlyRecord[]>
): EnsembleRecordsByVariable | null {
  const out = {} as EnsembleRecordsByVariable;

  for (const variable of Object.keys(VARIABLE_BRIDGE) as ClimateVariable[]) {
    const bridge = VARIABLE_BRIDGE[variable];
    const backendForecast = forecast.variables[bridge.backend];
    const backendHistory = forecast.history[bridge.backend] ?? [];
    if (!backendForecast || backendHistory.length === 0) return null;

    const nasaRecords = nasaRecordsByVariable[variable] ?? [];
    const decimals = variable === 'GWETROOT' ? 3 : 2;
    const round = (v: number) => Number(v.toFixed(decimals));
    const afterNasa = lastRecordKey(nasaRecords);
    const points: EnsembleMonthlyPoint[] = [];

    if (bridge.method === 'recent_climatology') {
      // No backend equivalent: continue with the last 15 years of NASA POWER per calendar month,
      // from the month after the NASA archive up to the end of the backend forecast.
      const lastYear = Math.floor((afterNasa - 1) / 12);
      const recent = calendarMonthStats(nasaRecords, lastYear - RECENT_CLIMATOLOGY_YEARS + 1, lastYear);
      const lastForecast = backendForecast.forecast[backendForecast.forecast.length - 1];
      if (recent.size < 12 || !lastForecast) return null;
      const endKey = lastForecast.year * 12 + lastForecast.monthIndex;
      for (let key = afterNasa + 1; key <= endKey; key++) {
        const year = Math.floor((key - 1) / 12);
        const month = key - year * 12;
        const { mean, sd } = recent.get(month)!;
        points.push({
          year,
          month,
          value: round(clampByVariable(variable, mean)),
          lower: round(clampByVariable(variable, mean - Z80 * sd)),
          upper: round(clampByVariable(variable, mean + Z80 * sd)),
          observed: false,
        });
      }
      out[variable] = points;
      continue;
    }

    const nasaNormals = calendarMonthStats(nasaRecords, NORMAL_PERIOD.start, NORMAL_PERIOD.end);
    const backendNormals = calendarMonthStats(
      backendHistory.map((r) => ({ ...r, value: bridge.toFrontendUnit(r.value, r.year, r.month) })),
      NORMAL_PERIOD.start,
      NORMAL_PERIOD.end
    );
    if (nasaNormals.size < 12 || backendNormals.size < 12) return null;

    const map = (raw: number, year: number, month: number): number => {
      const value = bridge.toFrontendUnit(raw, year, month);
      const nasa = nasaNormals.get(month)!;
      const backend = backendNormals.get(month)!;
      if (bridge.method === 'additive') {
        return clampByVariable(variable, nasa.mean + (value - backend.mean));
      }
      if (bridge.method === 'standardized') {
        if (!(backend.sd > 0)) return clampByVariable(variable, nasa.mean);
        return clampByVariable(variable, nasa.mean + ((value - backend.mean) / backend.sd) * nasa.sd);
      }
      if (!(backend.mean > 0)) return clampByVariable(variable, nasa.mean);
      const ratio = Math.min(RATIO_LIMITS[1], Math.max(RATIO_LIMITS[0], value / backend.mean));
      return clampByVariable(variable, nasa.mean * ratio);
    };

    // 1. ERA5 months already observed after the NASA archive ends (e.g. 2026 so far)
    for (const r of backendHistory) {
      if (r.year * 12 + r.month <= afterNasa) continue;
      const v = round(map(r.value, r.year, r.month));
      points.push({ year: r.year, month: r.month, value: v, lower: v, upper: v, observed: true });
    }

    // 2. Forecast months with their 80 % range
    for (const fm of backendForecast.forecast) {
      if (fm.year * 12 + fm.monthIndex <= afterNasa) continue;
      const value = map(fm.forecast, fm.year, fm.monthIndex);
      const lo = map(fm.lower80, fm.year, fm.monthIndex);
      const hi = map(fm.upper80, fm.year, fm.monthIndex);
      points.push({
        year: fm.year,
        month: fm.monthIndex,
        value: round(value),
        lower: round(Math.min(lo, hi)),
        upper: round(Math.max(lo, hi)),
        observed: false,
      });
    }

    points.sort((a, b) => a.year - b.year || a.month - b.month);
    out[variable] = points;
  }

  return out;
}

/** Last month covered by the ensemble continuation, or null when nothing is available. */
export function ensembleHorizon(
  records: EnsembleRecordsByVariable | null
): { year: number; month: number } | null {
  if (!records) return null;
  let best: { year: number; month: number } | null = null;
  for (const points of Object.values(records)) {
    const last = points[points.length - 1];
    if (!last) continue;
    if (!best || last.year * 12 + last.month > best.year * 12 + best.month) {
      best = { year: last.year, month: last.month };
    }
  }
  return best;
}

const WINDOW_MONTHS: Record<SeasonalWindow, number[]> = {
  annual: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  summer_jja: [6, 7, 8],
  spring_mam: [3, 4, 5],
};

/**
 * Aggregates the monthly continuation into one point per year for the seasonal window, in the
 * shape of the trend chart. Years with an incomplete window are skipped so that a partial last
 * year (e.g. Jan–Oct) does not masquerade as a full annual mean.
 */
export function aggregateEnsembleByWindow(
  points: EnsembleMonthlyPoint[],
  window: SeasonalWindow,
  decimals: number
): AnnualPoint[] {
  const months = WINDOW_MONTHS[window];
  const byYear = new Map<number, EnsembleMonthlyPoint[]>();
  for (const p of points) {
    if (!months.includes(p.month)) continue;
    const arr = byYear.get(p.year);
    if (arr) arr.push(p);
    else byYear.set(p.year, [p]);
  }

  const out: AnnualPoint[] = [];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const rows = byYear.get(year)!;
    if (rows.length < months.length) continue;
    const mean = (pick: (p: EnsembleMonthlyPoint) => number) =>
      Number((rows.reduce((acc, p) => acc + pick(p), 0) / rows.length).toFixed(decimals));
    const value = mean((p) => p.value);
    const lower = mean((p) => p.lower);
    const upper = mean((p) => p.upper);
    out.push({
      year,
      value: null,
      movingAvg5Yr: null,
      trendLine: null,
      projectedValue: value,
      ciBand: [lower, upper],
      ciLower: lower,
      ciUpper: upper,
      anomaly: null,
    });
  }
  return out;
}
