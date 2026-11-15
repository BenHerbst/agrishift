/**
 * Client for the AgriShift forecast backend (FastAPI, ../backend).
 *
 * Requests go through the Express dev server (`/api/climate/*` → `BACKEND_URL/*`), so the
 * browser stays same-origin. Set VITE_CLIMATE_API_BASE to call the backend directly instead.
 *
 * The first request for a new location makes the backend download ~45 years of reanalysis
 * and train all models (1–2 minutes). Later requests for the same location are instant.
 */
import type {
  AgriYearSummary,
  BackendMonthlyRecord,
  BackendVariable,
  ClimateForecastDataset,
  ForecastMonth,
  ForecastSources,
  ForecastVariableResult,
  RiskEvent,
  RiskEventId,
  SeasonRisk,
} from '../types/terrashift';

const API_BASE =
  (import.meta.env?.VITE_CLIMATE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '/api/climate';

/** Monthly variables shown in the trend chart / timeline (mapped onto NASA POWER units). */
export const CORE_FORECAST_VARIABLES: BackendVariable[] = ['tmean', 'precip', 'et0', 'soil_moisture_root'];

/** Everything requested from GET /forecast. */
export const FORECAST_VARIABLES: BackendVariable[] = [
  ...CORE_FORECAST_VARIABLES,
  'water_balance',
  'gdd',
  'frost_days',
  'heat_days',
  'wet_days',
];

export const FORECAST_YEARS = 3;
export const HISTORY_START_YEAR = 1991;

export class ClimateForecastError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClimateForecastError';
    this.status = status;
  }
}

interface RawForecastMonth {
  month: string;
  lead_months: number;
  forecast: number;
  lower_80: number;
  upper_80: number;
  models?: Record<string, number>;
}

interface RawForecastResponse {
  latitude: number;
  longitude: number;
  trained_until: string;
  horizon_months: number;
  sources?: {
    history?: string | null;
    history_source?: string | null;
    history_period?: string | null;
    prophet_member?: boolean;
    seasonal_forecast?: string | null;
    station_calibration?: string[] | null;
    climate_projections?: string[] | null;
    climate_projection_errors?: string[] | null;
    climate_indices?: Record<string, string> | null;
  };
  variables: Record<
    string,
    {
      unit: string;
      backtest?: {
        climatology_mae?: number;
        ensemble_mae?: number;
        skill_vs_climatology?: number | null;
        skill_by_lead_months?: Record<string, number | null>;
        weights_by_lead_months?: Record<string, Record<string, number>>;
      };
      forecast: RawForecastMonth[];
    }
  >;
}

interface RawHistoryResponse {
  months: Array<{ month: string } & Record<string, number | string | null>>;
}

interface RawAgriSummaryResponse {
  summary: Array<{
    year: number;
    months_covered: string;
    complete_year: boolean;
    indicators: Record<string, { forecast: number; normal_1991_2020: number; anomaly: number; unit: string }>;
    deficit_months: string[];
    frost_free_months: number;
  }>;
}

interface RawRiskResponse {
  seasons: Array<{
    season: string;
    season_name: string;
    season_year: number;
    months: string[];
    events: Record<
      string,
      {
        probability: number;
        normal_probability: number;
        observed_last_15_years?: number;
        rule: string;
        variable: string;
        description: string;
      }
    >;
    water_deficit_mm: {
      typical: number;
      dry_year_1_in_5: number;
      extreme_1_in_10: number;
      normal_typical: number;
    };
  }>;
}

function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split('-');
  return { year: Number(y), month: Number(m) };
}

async function getJson<T>(
  path: string,
  params: Record<string, string | number>,
  signal?: AbortSignal
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const url = `${API_BASE}${path}?${query.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ClimateForecastError(
      `Forecast backend unreachable (${err instanceof Error ? err.message : 'network error'}).`,
      0
    );
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: unknown; error?: unknown };
      const d = body.detail ?? body.error;
      if (typeof d === 'string') detail = d;
      else if (d) detail = JSON.stringify(d);
    } catch {
      // non-JSON error body
    }
    throw new ClimateForecastError(detail, res.status);
  }
  return (await res.json()) as T;
}

function normalizeForecastVariables(
  raw: RawForecastResponse
): Partial<Record<BackendVariable, ForecastVariableResult>> {
  const out: Partial<Record<BackendVariable, ForecastVariableResult>> = {};
  for (const [name, entry] of Object.entries(raw.variables)) {
    const forecast: ForecastMonth[] = entry.forecast.map((row) => {
      const { year, month } = parseYearMonth(row.month);
      return {
        month: row.month,
        year,
        monthIndex: month,
        leadMonths: row.lead_months,
        forecast: row.forecast,
        lower80: row.lower_80,
        upper80: row.upper_80,
        models: row.models ?? {},
      };
    });
    out[name as BackendVariable] = {
      unit: entry.unit,
      skillVsClimatology: entry.backtest?.skill_vs_climatology ?? null,
      skillByLeadMonths: entry.backtest?.skill_by_lead_months ?? {},
      weightsByLeadMonths: entry.backtest?.weights_by_lead_months ?? {},
      ensembleMae: entry.backtest?.ensemble_mae ?? null,
      climatologyMae: entry.backtest?.climatology_mae ?? null,
      forecast,
    };
  }
  return out;
}

function normalizeHistory(
  raw: RawHistoryResponse,
  variables: BackendVariable[]
): Partial<Record<BackendVariable, BackendMonthlyRecord[]>> {
  const out: Partial<Record<BackendVariable, BackendMonthlyRecord[]>> = {};
  for (const v of variables) out[v] = [];
  for (const row of raw.months) {
    const { year, month } = parseYearMonth(row.month);
    for (const v of variables) {
      const value = row[v];
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[v]!.push({ year, month, value });
      }
    }
  }
  return out;
}

function normalizeAgriSummary(raw: RawAgriSummaryResponse): AgriYearSummary[] {
  return raw.summary.map((entry) => {
    const indicators: AgriYearSummary['indicators'] = {};
    for (const [key, ind] of Object.entries(entry.indicators)) {
      indicators[key as BackendVariable] = {
        forecast: ind.forecast,
        normal: ind.normal_1991_2020,
        anomaly: ind.anomaly,
        unit: ind.unit,
      };
    }
    return {
      year: entry.year,
      monthsCovered: entry.months_covered,
      completeYear: entry.complete_year,
      indicators,
      deficitMonths: entry.deficit_months,
      frostFreeMonths: entry.frost_free_months,
    };
  });
}

function normalizeRisk(raw: RawRiskResponse): SeasonRisk[] {
  return raw.seasons.map((season) => {
    const events: Partial<Record<RiskEventId, RiskEvent>> = {};
    for (const [id, ev] of Object.entries(season.events)) {
      events[id as RiskEventId] = {
        probability: ev.probability,
        normalProbability: ev.normal_probability,
        observedRecent: ev.observed_last_15_years ?? ev.normal_probability,
        rule: ev.rule,
        variable: ev.variable,
        description: ev.description,
      };
    }
    return {
      season: season.season,
      seasonName: season.season_name,
      seasonYear: season.season_year,
      months: season.months,
      events,
      waterDeficitMm: {
        typical: season.water_deficit_mm.typical,
        dryYear1in5: season.water_deficit_mm.dry_year_1_in_5,
        extreme1in10: season.water_deficit_mm.extreme_1_in_10,
        normalTypical: season.water_deficit_mm.normal_typical,
      },
    };
  });
}

function normalizeSources(raw: RawForecastResponse['sources']): ForecastSources {
  return {
    history: raw?.history ?? null,
    historySource: raw?.history_source ?? null,
    historyPeriod: raw?.history_period ?? null,
    prophetMember: Boolean(raw?.prophet_member),
    seasonalForecast: raw?.seasonal_forecast ?? null,
    stationCalibration: raw?.station_calibration ?? null,
    climateProjections: raw?.climate_projections ?? null,
    climateProjectionErrors: raw?.climate_projection_errors ?? null,
    climateIndices: raw?.climate_indices ?? null,
  };
}

/**
 * Loads forecast, observed history, yearly agri summary and seasonal risk for one location.
 *
 * `/forecast` is requested first on purpose: it trains and caches the location on the backend,
 * so the three follow-up requests are served from that cache instead of training three times.
 */
export async function fetchClimateForecast(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<ClimateForecastDataset> {
  const start = performance.now();
  const coords = { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };

  const forecastRaw = await getJson<RawForecastResponse>(
    '/forecast',
    { ...coords, years: FORECAST_YEARS, variables: FORECAST_VARIABLES.join(',') },
    signal
  );

  const [historyRaw, agriRaw, riskRaw] = await Promise.all([
    getJson<RawHistoryResponse>(
      '/history',
      { ...coords, start_year: HISTORY_START_YEAR, variables: CORE_FORECAST_VARIABLES.join(',') },
      signal
    ),
    getJson<RawAgriSummaryResponse>('/agri-summary', { ...coords, years: FORECAST_YEARS }, signal),
    getJson<RawRiskResponse>('/risk', { ...coords, years: FORECAST_YEARS }, signal),
  ]);

  return {
    lat: coords.lat,
    lon: coords.lon,
    trainedUntil: forecastRaw.trained_until,
    horizonMonths: forecastRaw.horizon_months,
    sources: normalizeSources(forecastRaw.sources),
    variables: normalizeForecastVariables(forecastRaw),
    history: normalizeHistory(historyRaw, CORE_FORECAST_VARIABLES),
    agriSummary: normalizeAgriSummary(agriRaw),
    risk: normalizeRisk(riskRaw),
    fetchedAtIso: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// GET /rotation: one crop per forecast year from the backend's crop scoring.
// ---------------------------------------------------------------------------

export interface RotationYear {
  year: number;
  crop: string | null;
  family: string | null;
  score: number | null;
  reasons: string[];
  alternatives: Array<{ crop: string; score: number }>;
}

export interface RotationPlan {
  plan: RotationYear[];
  soil: { texture_class?: string; ph?: number; total_available_water_mm?: number; error?: string };
  /** crop group → 'safe' | 'caution' | 'avoid' (nearby roads, industry, air quality) */
  pollution: Record<string, string> | { error: string } | null;
}

export function fetchRotationPlan(lat: number, lon: number, signal?: AbortSignal): Promise<RotationPlan> {
  return getJson<RotationPlan>('/rotation', { lat, lon, years: 3 }, signal);
}

// ---------------------------------------------------------------------------
// GET /rotation/compare: rotation scenarios scored side by side.
// ---------------------------------------------------------------------------

export const ROTATION_DIMENSIONS = [
  'climate_fit',
  'nutrient_cycling',
  'organic_matter',
  'erosion',
  'pest_cycle',
  'water_use',
  'forage',
  'market',
] as const;
export type RotationDimension = (typeof ROTATION_DIMENSIONS)[number];

export interface RotationScenario {
  /** recommended_plan, best_climate_fit, soil_building, water_saving, erosion_control, forage, market, balanced, custom_N */
  labels: string[];
  rotation: Array<{ year: number; crop: string }>;
  composite: number;
  /** 0–100, higher is better */
  scores: Record<RotationDimension, number>;
  metrics: {
    mineral_n_to_buy_kg_per_ha_year: number;
    n_credit_reused_kg_per_ha: number;
    humus_balance_kg_c_per_ha_year: number;
    erosion_risk_index: number;
    water_demand_mm_per_year: number;
    water_shortfall_mm_per_year: number;
    feed_value: number;
    indicative_margin_index: number;
  };
  rule_violations: string[];
  excluded_for_pollution: string[];
  best_at: RotationDimension[];
}

export interface RotationComparison {
  years: number[];
  scenarios: RotationScenario[];
}

export function fetchRotationComparison(lat: number, lon: number, signal?: AbortSignal): Promise<RotationComparison> {
  return getJson<RotationComparison>('/rotation/compare', { lat, lon, years: 3 }, signal);
}
