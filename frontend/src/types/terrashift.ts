export type ClimateVariable = 'T2M' | 'PRECTOTCORR' | 'GWETROOT' | 'EVLAND';

export type SeasonalWindow = 'annual' | 'summer_jja' | 'spring_mam';

export type ForecastMode = 'historical' | 'ensemble' | 'sens_slope' | 'cmip6_ssp585';

export type DataSourceStatus = 'live' | 'fallback' | 'loading';

export interface PresetRegion {
  id: string;
  name: string;
  shortName: string;
  country: string;
  lat: number;
  lon: number;
  climateZone: string;
  defaultBaselineCrop: BaselineCropId;
  summary: string;
}

export interface MonthlyRecord {
  year: number;
  month: number; // 1..12
  value: number;
}

export interface MonthlyClimatologyPoint {
  month: number; // 1..12
  label: string;
  t2m: number;
  prectotcorr: number;
  gwetroot: number;
  evland: number;
}

export interface AnnualPoint {
  year: number;
  value: number | null;
  movingAvg5Yr: number | null;
  trendLine: number | null;
  projectedValue: number | null;
  ciBand: [number, number] | null;
  ciLower: number | null;
  ciUpper: number | null;
  anomaly: number | null;
}

export interface ThresholdFinding {
  crossed: boolean;
  alreadyExceeded: boolean;
  crossingYear: number | null;
  uncertaintyYears: number | null;
  thresholdValue: number;
  projected2035: number;
  ci2035Lower: number;
  ci2035Upper: number;
  messageEn: string;
  messageDe: string;
}

export interface TrendStatistics {
  variable: ClimateVariable;
  window: SeasonalWindow;
  sampleCount: number;
  startYear: number;
  endYear: number;
  baselineMean: number;
  recentMean: number;
  olsSlopePerDecade: number;
  olsIntercept: number;
  rSquared: number;
  residualSE: number;
  sensSlopePerDecade: number;
  sensIntercept: number;
  mannKendallS: number;
  mannKendallVarS: number;
  mannKendallZ: number;
  pValue: number;
  confidencePct: number;
  isSignificant: boolean;
  direction: 'increasing' | 'decreasing' | 'neutral';
  classificationLabel: string;
}

export interface VariableMetadata {
  code: ClimateVariable;
  label: string;
  shortLabel: string;
  unit: string;
  accentHex: string;
  description: string;
}

export interface SoilProfile {
  ph: number;
  socPercent: number;
  clayPercent: number;
  sandPercent: number;
  siltPercent: number;
  textureClass: string;
  source: DataSourceStatus;
  latencyMs: number;
}

export interface DrawnFieldPolygon {
  coordinates: Array<[number, number]>; // [lon, lat] vertices
  centroidLat: number;
  centroidLon: number;
  areaHectares: number;
  perimeterMeters: number;
  samplePointsCount: number;
}

export interface EarthSystemDataset {
  lat: number;
  lon: number;
  regionName: string;
  powerSource: DataSourceStatus;
  powerLatencyMs: number;
  recordsByVariable: Record<ClimateVariable, MonthlyRecord[]>;
  climatology: MonthlyClimatologyPoint[];
  soil: SoilProfile;
  peakHeatMonths: number[];
  moistureDeficitMonths: number[];
  fetchedAtIso: string;
  fieldAreaStats?: {
    areaHectares: number;
    perimeterMeters: number;
    samplePointsCount: number;
    polygonCoordinates: Array<[number, number]>;
  };
}

export type BaselineCropId =
  | 'wheat_maize'
  | 'soy_corn'
  | 'irrigated_alfalfa'
  | 'rainfed_olive_cereal';

export interface FarmerPriorities {
  water: number; // 0-100
  nitrogen: number; // 0-100
  erosion: number; // 0-100
  profit: number; // 0-100
}

export type CalendarCoverStatus = 'cash' | 'cover' | 'bare_risk';

export type ClimateStressFlag = 'heat_stress' | 'water_stress' | 'optimal';

export interface CropCalendarMonthCell {
  month: number; // 1..12
  monthLabel: string;
  cropName: string;
  coverStatus: CalendarCoverStatus;
  stressFlag: ClimateStressFlag;
  note: string;
}

export interface CropCalendarYear {
  yearNumber: 1 | 2 | 3;
  yearLabel: string;
  sequenceTitle: string;
  months: CropCalendarMonthCell[];
}

export interface RadarMetricPoint {
  axis: string;
  baseline: number;
  hydroResilient: number;
  regenerativeSoil: number;
}

export interface RotationScenario {
  id: 'baseline' | 'hydro_resilient' | 'regenerative_soil';
  title: string;
  subtitle: string;
  badgeLabel: string;
  fitScore: number;
  cropsSummary: string;
  whySuggested: string;
  expectedBenefits: string[];
  risksAndValidation: string[];
  radarScores: {
    waterEfficiency: number;
    nitrogenFixation: number;
    erosionControl: number;
    heatResilience: number;
    economicStability: number;
  };
  calendarYears: CropCalendarYear[];
}

export interface AgroBriefingRequest {
  lang?: 'de' | 'en';
  regionName: string;
  lat: number;
  lon: number;
  seasonalWindow: SeasonalWindow;
  soil: SoilProfile;
  statsByVariable: Record<ClimateVariable, TrendStatistics>;
  priorities: FarmerPriorities;
  baselineCropLabel: string;
  recommendedScenario: {
    title: string;
    cropsSummary: string;
    whySuggested: string;
  };
}

export interface AgroBriefingResponse {
  headline: string;
  executiveSummary: string;
  climateSignalFindings: string[];
  recommendedActionPlan: string[];
  validationChecklist: string[];
  generatedBy: 'gemini-2.5-flash' | 'deterministic-engine';
  generatedAtIso: string;
}

// ---------------------------------------------------------------------------
// Terra Tuta forecast backend (FastAPI, ../backend): monthly ensemble forecast
// 1–3 years ahead, yearly agri indicators and seasonal risk probabilities.
// ---------------------------------------------------------------------------

/** Backend variables the frontend requests (subset of GET /variables). */
export type BackendVariable =
  | 'tmean'
  | 'precip'
  | 'et0'
  | 'water_balance'
  | 'soil_moisture_root'
  | 'gdd'
  | 'frost_days'
  | 'heat_days'
  | 'wet_days';

export interface ForecastMonth {
  month: string; // "YYYY-MM"
  year: number;
  monthIndex: number; // 1..12
  leadMonths: number;
  forecast: number;
  lower80: number;
  upper80: number;
  models: Record<string, number>;
}

export interface ForecastVariableResult {
  unit: string;
  /** 1 − MAE(ensemble)/MAE(climatology) in the rolling backtest; > 0 beats the 30-year normal. */
  skillVsClimatology: number | null;
  skillByLeadMonths: Record<string, number | null>;
  weightsByLeadMonths: Record<string, Record<string, number>>;
  ensembleMae: number | null;
  climatologyMae: number | null;
  forecast: ForecastMonth[];
}

export interface AgriIndicator {
  forecast: number;
  normal: number; // 1991–2020 mean for the same months
  anomaly: number;
  unit: string;
}

export interface AgriYearSummary {
  year: number;
  monthsCovered: string;
  completeYear: boolean;
  indicators: Partial<Record<BackendVariable, AgriIndicator>>;
  deficitMonths: string[];
  frostFreeMonths: number;
}

export type RiskEventId = 'dry' | 'wet' | 'drought' | 'hot' | 'frost';

export interface RiskEvent {
  probability: number;
  normalProbability: number;
  observedRecent: number;
  rule: string;
  variable: string;
  description: string;
}

export interface SeasonRisk {
  season: string; // e.g. "Jun–Aug 2027"
  seasonName: string; // "Dec–Feb" | "Mar–May" | "Jun–Aug" | "Sep–Nov"
  seasonYear: number;
  months: string[];
  events: Partial<Record<RiskEventId, RiskEvent>>;
  waterDeficitMm: {
    typical: number;
    dryYear1in5: number;
    extreme1in10: number;
    normalTypical: number;
  };
}

export interface ForecastSources {
  history: string | null;
  prophetMember: boolean;
  seasonalForecast: string | null;
  stationCalibration: string[] | null;
  climateProjections: string[] | null;
  /** Climate models that failed to load; forecast runs without them. */
  climateProjectionErrors: string[] | null;
  climateIndices: Record<string, string> | null;
}

/** Observed monthly value from the backend's ERA5 history (GET /history). */
export interface BackendMonthlyRecord {
  year: number;
  month: number; // 1..12
  value: number;
}

export interface ClimateForecastDataset {
  lat: number;
  lon: number;
  trainedUntil: string; // "YYYY-MM"
  horizonMonths: number;
  sources: ForecastSources;
  variables: Partial<Record<BackendVariable, ForecastVariableResult>>;
  /** Observed ERA5 months from 1991 up to trainedUntil, for the delta mapping onto NASA POWER. */
  history: Partial<Record<BackendVariable, BackendMonthlyRecord[]>>;
  agriSummary: AgriYearSummary[];
  risk: SeasonRisk[];
  fetchedAtIso: string;
  latencyMs: number;
}

export type ForecastLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * A backend forecast month expressed in the frontend's NASA POWER units for one
 * ClimateVariable (delta method, see utils/ensembleForecast.ts).
 */
export interface EnsembleMonthlyPoint {
  year: number;
  month: number; // 1..12
  value: number;
  lower: number;
  upper: number;
  /** true for ERA5 months observed after the NASA POWER archive ends, false for forecast months. */
  observed: boolean;
}

export type EnsembleRecordsByVariable = Record<ClimateVariable, EnsembleMonthlyPoint[]>;
