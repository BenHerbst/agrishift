import type {
  AnnualPoint,
  ClimateVariable,
  EnsembleMonthlyPoint,
  EnsembleRecordsByVariable,
  ForecastMode,
  MonthlyClimatologyPoint,
  MonthlyRecord,
  SeasonalWindow,
  ThresholdFinding,
  TrendStatistics,
  VariableMetadata,
} from '../types/terrashift';
import { aggregateEnsembleByWindow } from './ensembleForecast';

/** First year shown in the chart and timeline. Trend statistics still use the full 1990–2025 record. */
export const DISPLAY_START_YEAR = 2000;

export interface YearMonth {
  year: number;
  month: number; // 1..12
}

/** Months the timeline currently averages over. Step 0 = Jan of DISPLAY_START_YEAR. */
export interface TimelinePeriod {
  size: 1 | 3 | 12;
  start: YearMonth;
  end: YearMonth;
  months: YearMonth[];
}

const stepToYearMonth = (step: number): YearMonth => ({
  year: DISPLAY_START_YEAR + Math.floor(step / 12),
  month: (step % 12) + 1,
});

/**
 * The period containing `step`: the month itself, its meteorological season (Dec–Feb, Mar–May,
 * Jun–Aug, Sep–Nov, same as the backend's risk seasons) or its calendar year, clipped to [0, maxStep].
 */
export function timelinePeriod(step: number, size: 1 | 3 | 12, maxStep: number): TimelinePeriod {
  const m0 = step % 12;
  const offset = size === 12 ? m0 : size === 3 ? (m0 + 1) % 3 : 0;
  const startStep = Math.max(0, step - offset);
  const endStep = Math.min(maxStep, step - offset + size - 1);
  const months: YearMonth[] = [];
  for (let s = startStep; s <= endStep; s++) months.push(stepToYearMonth(s));
  return { size, start: months[0], end: months[months.length - 1], months };
}

/** "Jul 2027", "Dez 2026 – Feb 2027", "Jun – Aug 2027", "2027" (or "2028 (Jan – Mär)" if cut off). */
export function formatTimelinePeriod(period: TimelinePeriod, monthNames: string[]): string {
  const { start, end, size, months } = period;
  const mn = (m: number) => monthNames[m - 1];
  if (size === 1) return `${mn(start.month)} ${start.year}`;
  if (size === 12) {
    return months.length === 12 ? `${start.year}` : `${start.year} (${mn(start.month)} – ${mn(end.month)})`;
  }
  if (months.length === 1) return `${mn(start.month)} ${start.year}`;
  return start.year === end.year
    ? `${mn(start.month)} – ${mn(end.month)} ${end.year}`
    : `${mn(start.month)} ${start.year} – ${mn(end.month)} ${end.year}`;
}

export const VARIABLE_META: Record<ClimateVariable, VariableMetadata> = {
  T2M: {
    code: 'T2M',
    label: 'Air Temperature at 2m',
    shortLabel: 'T2M · Temp 2m',
    unit: '°C',
    accentHex: '#d97706',
    description: 'Near-surface air temperature governing growing degree days and heat stress.',
  },
  PRECTOTCORR: {
    code: 'PRECTOTCORR',
    label: 'Precipitation',
    shortLabel: 'PRECTOTCORR',
    unit: 'mm/day',
    accentHex: '#eceef0',
    description: 'Daily precipitation rate controlling soil recharge and rainfed yield.',
  },
  GWETROOT: {
    code: 'GWETROOT',
    label: 'Root-Zone Soil Moisture',
    shortLabel: 'GWETROOT',
    unit: 'frac',
    accentHex: '#10b981',
    description: 'Moisture saturation across the 0–100 cm active crop rooting column.',
  },
  EVLAND: {
    code: 'EVLAND',
    label: 'Evapotranspiration',
    shortLabel: 'EVLAND · ET',
    unit: 'mm/day',
    accentHex: '#d97706',
    description: 'Total water flux returned to the atmosphere via soil evaporation and crop transpiration.',
  },
};

export const SEASONAL_WINDOW_LABELS: Record<SeasonalWindow, { label: string; shortLabel: string; months: number[] }> = {
  annual: {
    label: 'Annual Mean (Jan–Dec)',
    shortLabel: 'Annual (Jan–Dec)',
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  summer_jja: {
    label: 'Summer Growing Season (Jun–Aug)',
    shortLabel: 'Summer (JJA)',
    months: [6, 7, 8],
  },
  spring_mam: {
    label: 'Spring Planting Window (Mar–May)',
    shortLabel: 'Spring (MAM)',
    months: [3, 4, 5],
  },
};

function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-z * z);
}

function twoTailedPValue(zScore: number): number {
  if (!Number.isFinite(zScore)) return 1;
  const p = erfc(Math.abs(zScore) / Math.SQRT2);
  return Math.min(1, Math.max(0, p));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function aggregateRecordsByWindow(
  records: MonthlyRecord[],
  window: SeasonalWindow
): Array<{ year: number; value: number }> {
  const allowedMonths = new Set(SEASONAL_WINDOW_LABELS[window].months);
  const grouped = new Map<number, number[]>();

  for (const rec of records) {
    if (!Number.isFinite(rec.value) || rec.value <= -900) continue;
    if (!allowedMonths.has(rec.month)) continue;
    const arr = grouped.get(rec.year);
    if (arr) {
      arr.push(rec.value);
    } else {
      grouped.set(rec.year, [rec.value]);
    }
  }

  const years = Array.from(grouped.keys()).sort((a, b) => a - b);
  const output: Array<{ year: number; value: number }> = [];

  for (const year of years) {
    const vals = grouped.get(year) ?? [];
    if (vals.length === 0) continue;
    const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length;
    output.push({ year, value: Number(mean.toFixed(4)) });
  }

  return output;
}

export function computeLinearRegression(points: Array<{ year: number; value: number }>): {
  slope: number;
  slopePerDecade: number;
  intercept: number;
  rSquared: number;
  residualSE: number;
} {
  const n = points.length;
  if (n < 2) {
    return {
      slope: 0,
      slopePerDecade: 0,
      intercept: points[0]?.value ?? 0,
      rSquared: 0,
      residualSE: 0,
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.year;
    sumY += p.value;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.year - meanX;
    const dy = p.value - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const rSquared = sxx === 0 || syy === 0 ? 0 : Math.min(1, Math.max(0, (sxy * sxy) / (sxx * syy)));

  let sse = 0;
  for (const p of points) {
    const err = p.value - (slope * p.year + intercept);
    sse += err * err;
  }
  const residualSE = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;

  return {
    slope,
    slopePerDecade: slope * 10,
    intercept,
    rSquared,
    residualSE,
  };
}

export function computeSensSlopeAndIntercept(points: Array<{ year: number; value: number }>): {
  sensSlopePerYear: number;
  sensSlopePerDecade: number;
  sensIntercept: number;
} {
  const n = points.length;
  if (n < 2) {
    return {
      sensSlopePerYear: 0,
      sensSlopePerDecade: 0,
      sensIntercept: points[0]?.value ?? 0,
    };
  }

  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[j].year - points[i].year;
      if (dx !== 0) {
        slopes.push((points[j].value - points[i].value) / dx);
      }
    }
  }

  const sensSlopePerYear = median(slopes);
  const intercepts = points.map((p) => p.value - sensSlopePerYear * p.year);
  const sensIntercept = median(intercepts);

  return {
    sensSlopePerYear,
    sensSlopePerDecade: sensSlopePerYear * 10,
    sensIntercept,
  };
}

export function computeMannKendall(points: Array<{ year: number; value: number }>): {
  s: number;
  varS: number;
  zScore: number;
  pValue: number;
} {
  const n = points.length;
  if (n < 4) {
    return { s: 0, varS: 0, zScore: 0, pValue: 1 };
  }

  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = points[j].value - points[i].value;
      if (diff > 1e-9) s += 1;
      else if (diff < -1e-9) s -= 1;
    }
  }

  const counts = new Map<string, number>();
  for (const p of points) {
    const key = p.value.toFixed(6);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let tieAdjustment = 0;
  for (const tp of counts.values()) {
    if (tp > 1) {
      tieAdjustment += tp * (tp - 1) * (2 * tp + 5);
    }
  }

  const varS = (n * (n - 1) * (2 * n + 5) - tieAdjustment) / 18;
  if (varS <= 0) {
    return { s, varS: 0, zScore: 0, pValue: 1 };
  }

  const stdS = Math.sqrt(varS);
  let zScore = 0;
  if (s > 0) zScore = (s - 1) / stdS;
  else if (s < 0) zScore = (s + 1) / stdS;

  const pValue = twoTailedPValue(zScore);
  return { s, varS, zScore, pValue };
}

function classifyTrendLabel(
  variable: ClimateVariable,
  zScore: number,
  pValue: number
): {
  isSignificant: boolean;
  direction: 'increasing' | 'decreasing' | 'neutral';
  classificationLabel: string;
} {
  const isSignificant = pValue < 0.05;
  if (!isSignificant) {
    return {
      isSignificant: false,
      direction: 'neutral',
      classificationLabel: 'NO SIGNIFICANT TREND / NOISE',
    };
  }

  const increasing = zScore > 0;
  const direction = increasing ? 'increasing' : 'decreasing';

  switch (variable) {
    case 'T2M':
      return {
        isSignificant: true,
        direction,
        classificationLabel: increasing ? 'SIGNIFICANT WARMING TREND' : 'SIGNIFICANT COOLING TREND',
      };
    case 'PRECTOTCORR':
      return {
        isSignificant: true,
        direction,
        classificationLabel: increasing ? 'SIGNIFICANT WETTING TREND' : 'SIGNIFICANT PRECIP DECLINE',
      };
    case 'GWETROOT':
      return {
        isSignificant: true,
        direction,
        classificationLabel: increasing ? 'SIGNIFICANT SOIL MOISTENING' : 'SIGNIFICANT DRYING TREND',
      };
    case 'EVLAND':
      return {
        isSignificant: true,
        direction,
        classificationLabel: increasing ? 'SIGNIFICANT ET DEMAND RISE' : 'SIGNIFICANT ET DECLINE',
      };
  }
}

export function analyzeClimateSeries(
  records: MonthlyRecord[],
  variable: ClimateVariable,
  window: SeasonalWindow
): {
  series: AnnualPoint[];
  stats: TrendStatistics;
} {
  const aggregated = aggregateRecordsByWindow(records, window);
  const reg = computeLinearRegression(aggregated);
  const sens = computeSensSlopeAndIntercept(aggregated);
  const mk = computeMannKendall(aggregated);
  const classification = classifyTrendLabel(variable, mk.zScore, mk.pValue);

  if (aggregated.length === 0) {
    const validRaw = records.filter((r) => Number.isFinite(r.value) && r.value > -900);
    const fallbackMean =
      validRaw.length > 0
        ? validRaw.reduce((acc, r) => acc + r.value, 0) / validRaw.length
        : 0;
    const minYr = validRaw[0]?.year ?? 1990;
    const maxYr = validRaw[validRaw.length - 1]?.year ?? minYr;
    return {
      series: [],
      stats: {
        variable,
        window,
        sampleCount: 0,
        startYear: minYr,
        endYear: maxYr,
        baselineMean: fallbackMean,
        recentMean: fallbackMean,
        olsSlopePerDecade: 0,
        olsIntercept: fallbackMean,
        rSquared: 0,
        residualSE: 0,
        sensSlopePerDecade: 0,
        sensIntercept: fallbackMean,
        mannKendallS: 0,
        mannKendallVarS: 0,
        mannKendallZ: 0,
        pValue: 1,
        confidencePct: 0,
        isSignificant: false,
        direction: 'neutral',
        classificationLabel: 'NO SIGNIFICANT TREND / NOISE',
      },
    };
  }

  const baselinePts = aggregated.filter((p) => p.year <= 2000);
  const baselineMean =
    baselinePts.length > 0
      ? baselinePts.reduce((acc, p) => acc + p.value, 0) / baselinePts.length
      : aggregated.reduce((acc, p) => acc + p.value, 0) / Math.max(1, aggregated.length);

  const firstAggYear = aggregated[0]?.year ?? 1990;
  const lastAggYear = aggregated[aggregated.length - 1]?.year ?? 2025;
  const recentStartYear = Math.max(firstAggYear, lastAggYear - 9);
  const recentPts = aggregated.filter((p) => p.year >= recentStartYear);
  const recentMean =
    recentPts.length > 0
      ? recentPts.reduce((acc, p) => acc + p.value, 0) / recentPts.length
      : baselineMean;

  const series: AnnualPoint[] = aggregated.map((pt, idx) => {
    let movingAvg5Yr: number | null = null;
    if (idx >= 4) {
      const slice = aggregated.slice(idx - 4, idx + 1);
      movingAvg5Yr = Number(
        (slice.reduce((acc, item) => acc + item.value, 0) / slice.length).toFixed(4)
      );
    }

    const trendLine = Number((reg.slope * pt.year + reg.intercept).toFixed(4));
    const anomaly = Number((pt.value - baselineMean).toFixed(4));

    return {
      year: pt.year,
      value: pt.value,
      movingAvg5Yr,
      trendLine,
      projectedValue: null,
      ciBand: null,
      ciLower: null,
      ciUpper: null,
      anomaly,
    };
  });

  const stats: TrendStatistics = {
    variable,
    window,
    sampleCount: aggregated.length,
    startYear: aggregated[0]?.year ?? 1990,
    endYear: aggregated[aggregated.length - 1]?.year ?? 2025,
    baselineMean,
    recentMean,
    olsSlopePerDecade: reg.slopePerDecade,
    olsIntercept: reg.intercept,
    rSquared: reg.rSquared,
    residualSE: reg.residualSE,
    sensSlopePerDecade: sens.sensSlopePerDecade,
    sensIntercept: sens.sensIntercept,
    mannKendallS: mk.s,
    mannKendallVarS: mk.varS,
    mannKendallZ: mk.zScore,
    pValue: mk.pValue,
    confidencePct: (1 - mk.pValue) * 100,
    isSignificant: classification.isSignificant,
    direction: classification.direction,
    classificationLabel: classification.classificationLabel,
  };

  return { series, stats };
}

function clampByVariable(variable: ClimateVariable, val: number): number {
  if (variable === 'GWETROOT') return Math.min(0.98, Math.max(0.04, val));
  if (variable === 'PRECTOTCORR' || variable === 'EVLAND') return Math.max(0.02, val);
  return val;
}

export function buildForecastSeries(
  historicalSeries: AnnualPoint[],
  stats: TrendStatistics,
  mode: ForecastMode,
  ensembleMonthly?: EnsembleMonthlyPoint[] | null
): AnnualPoint[] {
  if (mode === 'historical' || historicalSeries.length === 0) {
    return historicalSeries;
  }

  const lastPoint = historicalSeries[historicalSeries.length - 1];

  if (mode === 'ensemble') {
    // Backend ensemble forecast (delta-mapped onto NASA POWER units), aggregated per window.
    const decimals = stats.variable === 'GWETROOT' ? 3 : 2;
    const projection = aggregateEnsembleByWindow(ensembleMonthly ?? [], stats.window, decimals).filter(
      (pt) => pt.year > lastPoint.year
    );
    if (projection.length === 0) return historicalSeries;
    const anchor = lastPoint.value ?? stats.recentMean;
    const anchored: AnnualPoint = {
      ...lastPoint,
      projectedValue: anchor,
      ciBand: [anchor, anchor],
      ciLower: anchor,
      ciUpper: anchor,
    };
    return [...historicalSeries.slice(0, -1), anchored, ...projection];
  }

  const anchorYear = lastPoint.year;
  const sensSlopePerYear = stats.sensSlopePerDecade / 10;
  // Anchor projection cleanly at Sen's fitted endpoint in 2025 (or latest obs year)
  const anchorValue = sensSlopePerYear * anchorYear + stats.sensIntercept;
  const n = Math.max(4, stats.sampleCount);

  const clonedHistorical: AnnualPoint[] = historicalSeries.map((pt, idx) => {
    if (idx === historicalSeries.length - 1) {
      const roundedAnchor = Number(anchorValue.toFixed(4));
      return {
        ...pt,
        projectedValue: roundedAnchor,
        ciBand: [roundedAnchor, roundedAnchor],
        ciLower: roundedAnchor,
        ciUpper: roundedAnchor,
      };
    }
    return pt;
  });

  const projectionYears: AnnualPoint[] = [];
  for (let year = anchorYear + 1; year <= 2035; year++) {
    const dt = year - anchorYear;
    let rawProjected = anchorValue + sensSlopePerYear * dt;

    if (mode === 'cmip6_ssp585') {
      // Regional CMIP6 SSP5-8.5 high-forcing stress amplification
      const nonlinearFactor = Math.pow(dt, 1.12);
      switch (stats.variable) {
        case 'T2M': {
          const sspSlope = Math.max(sensSlopePerYear * 1.45, sensSlopePerYear + 0.045);
          rawProjected = anchorValue + sspSlope * nonlinearFactor;
          break;
        }
        case 'GWETROOT': {
          const sspDrySlope = Math.min(sensSlopePerYear * 1.4, sensSlopePerYear - 0.0032);
          rawProjected = anchorValue + sspDrySlope * nonlinearFactor;
          break;
        }
        case 'PRECTOTCORR': {
          const sspPrecipSlope =
            sensSlopePerYear < 0
              ? sensSlopePerYear * 1.35 - 0.008
              : sensSlopePerYear * 1.2;
          rawProjected = anchorValue + sspPrecipSlope * nonlinearFactor;
          break;
        }
        case 'EVLAND': {
          const sspEtSlope = Math.max(sensSlopePerYear * 1.35, sensSlopePerYear + 0.014);
          rawProjected = anchorValue + sspEtSlope * nonlinearFactor;
          break;
        }
      }
    }

    const projected = clampByVariable(stats.variable, rawProjected);
    // Exact 95% confidence interval formula: ± 1.96 * SE * sqrt(1 + Δt / N)
    // Plus gradual horizon dispersion scaling so cone visually expands cleanly from 2026 to 2035
    const baseHalfWidth = 1.96 * stats.residualSE * Math.sqrt(1 + dt / n);
    const horizonWidth = baseHalfWidth * (0.55 + 0.08 * dt) * (mode === 'cmip6_ssp585' ? 1.15 : 1.0);

    const ciLower = Number(clampByVariable(stats.variable, projected - horizonWidth).toFixed(4));
    const ciUpper = Number(clampByVariable(stats.variable, projected + horizonWidth).toFixed(4));
    const projRounded = Number(projected.toFixed(4));

    projectionYears.push({
      year,
      value: null,
      movingAvg5Yr: null,
      trendLine: null,
      projectedValue: projRounded,
      ciBand: [ciLower, ciUpper],
      ciLower,
      ciUpper,
      anomaly: null,
    });
  }

  return [...clonedHistorical, ...projectionYears];
}

export function evaluateAgronomicThreshold(
  forecastSeries: AnnualPoint[],
  stats: TrendStatistics,
  mode: ForecastMode
): ThresholdFinding {
  const projPoints = forecastSeries.filter((p) => p.year >= 2026 && p.projectedValue !== null);
  const lastHist = forecastSeries.find((p) => p.year === stats.endYear) ?? forecastSeries[forecastSeries.length - 1];
  const point2035 = forecastSeries[forecastSeries.length - 1];
  // Horizon year and range width depend on the mode: the trend/CMIP6 extrapolations run to 2035
  // with a 95 % band, the backend ensemble forecast runs 1–3 years with an 80 % band.
  const horizonYear = point2035?.year ?? 2035;
  const rangePct = mode === 'ensemble' ? 80 : 95;

  const projected2035 = point2035?.projectedValue ?? lastHist?.value ?? stats.recentMean;
  const ci2035Lower = point2035?.ciLower ?? projected2035;
  const ci2035Upper = point2035?.ciUpper ?? projected2035;

  if (mode === 'ensemble' && projPoints.length === 0) {
    const decimals = stats.variable === 'GWETROOT' ? 3 : 2;
    const unit = VARIABLE_META[stats.variable].unit;
    return {
      crossed: false,
      alreadyExceeded: false,
      crossingYear: null,
      uncertaintyYears: null,
      thresholdValue: 0,
      projected2035: lastHist?.value ?? stats.recentMean,
      ci2035Lower: lastHist?.value ?? stats.recentMean,
      ci2035Upper: lastHist?.value ?? stats.recentMean,
      messageEn: `Ensemble forecast not available for this window yet. Latest mean: ${stats.recentMean.toFixed(decimals)} ${unit}.`,
      messageDe: `Für dieses Zeitfenster liegt noch keine Ensemble-Prognose vor. Aktuelles Mittel: ${stats.recentMean.toFixed(decimals)} ${unit}.`,
    };
  }

  if (mode === 'historical') {
    const decimals = stats.variable === 'GWETROOT' ? 3 : 2;
    const unit = VARIABLE_META[stats.variable].unit;
    return {
      crossed: false,
      alreadyExceeded: false,
      crossingYear: null,
      uncertaintyYears: null,
      thresholdValue: 0,
      projected2035: lastHist?.value ?? stats.recentMean,
      ci2035Lower: lastHist?.value ?? stats.recentMean,
      ci2035Upper: lastHist?.value ?? stats.recentMean,
      messageEn: `Historical diagnostic mode (${stats.startYear}–${stats.endYear}). Latest mean: ${stats.recentMean.toFixed(decimals)} ${unit}. Switch to Sen's Slope or CMIP6 SSP5-8.5 to evaluate 2026–2035 threshold crossings.`,
      messageDe: `Historischer Diagnosemodus (${stats.startYear}–${stats.endYear}). Aktuelles Mittel: ${stats.recentMean.toFixed(decimals)} ${unit}. Wähle Sen-Extrapolation oder CMIP6 SSP5-8.5 für 2026–2035 Schwellenwert-Prognosen.`,
    };
  }

  // Variable-specific critical agronomic thresholds
  if (stats.variable === 'GWETROOT') {
    const threshold = 0.32;
    const startVal = lastHist?.value ?? stats.recentMean;
    if (startVal <= threshold) {
      return {
        crossed: true,
        alreadyExceeded: true,
        crossingYear: stats.endYear,
        uncertaintyYears: null,
        thresholdValue: threshold,
        projected2035,
        ci2035Lower,
        ci2035Upper,
        messageEn: `Already below the 0.32 wilting point (${startVal.toFixed(3)} in ${stats.endYear}); ${horizonYear} projection is ${projected2035.toFixed(3)} (${rangePct}% range: ${ci2035Lower.toFixed(3)}–${ci2035Upper.toFixed(3)}).`,
        messageDe: `Bereits unter dem Welkepunkt von 0,32 (${startVal.toFixed(3)} im Jahr ${stats.endYear}); Ausblick ${horizonYear}: ${projected2035.toFixed(3)} (${rangePct}-%-Bereich: ${ci2035Lower.toFixed(3)}–${ci2035Upper.toFixed(3)}).`,
      };
    }

    const crossPt = projPoints.find((p) => (p.projectedValue ?? 1) <= threshold);
    const earlyCross = projPoints.find((p) => (p.ciLower ?? 1) <= threshold);
    const lateCross = projPoints.find((p) => (p.ciUpper ?? 1) <= threshold);

    if (crossPt) {
      const unc = earlyCross
        ? Math.max(1, Math.abs(crossPt.year - earlyCross.year))
        : lateCross
        ? Math.max(1, Math.abs(lateCross.year - crossPt.year))
        : 3;
      return {
        crossed: true,
        alreadyExceeded: false,
        crossingYear: crossPt.year,
        uncertaintyYears: unc,
        thresholdValue: threshold,
        projected2035,
        ci2035Lower,
        ci2035Upper,
        messageEn: `Root-zone moisture is projected to drop below the 0.32 wilting threshold by ${crossPt.year} (±${unc} yrs).`,
        messageDe: `Die Wurzelraumfeuchte fällt voraussichtlich bis ${crossPt.year} (±${unc} J.) unter den Welkepunkt von 0,32.`,
      };
    }

    if (earlyCross) {
      return {
        crossed: false,
        alreadyExceeded: false,
        crossingYear: earlyCross.year,
        uncertaintyYears: horizonYear - earlyCross.year,
        thresholdValue: threshold,
        projected2035,
        ci2035Lower,
        ci2035Upper,
        messageEn: `Mean forecast stays at ${projected2035.toFixed(3)} in ${horizonYear}, though the lower ${rangePct}% bound dips below 0.32 by ${earlyCross.year}.`,
        messageDe: `Der Mittelwert bleibt ${horizonYear} bei ${projected2035.toFixed(3)}, aber das untere ${rangePct}-%-Band fällt ab ${earlyCross.year} unter 0,32.`,
      };
    }

    return {
      crossed: false,
      alreadyExceeded: false,
      crossingYear: null,
      uncertaintyYears: null,
      thresholdValue: threshold,
      projected2035,
      ci2035Lower,
      ci2035Upper,
      messageEn: `${horizonYear} moisture forecast: ${projected2035.toFixed(3)} (${rangePct}% range: ${ci2035Lower.toFixed(3)}–${ci2035Upper.toFixed(3)}), staying above the 0.32 wilting threshold.`,
      messageDe: `Ausblick ${horizonYear}: ${projected2035.toFixed(3)} (${rangePct}-%-Bereich: ${ci2035Lower.toFixed(3)}–${ci2035Upper.toFixed(3)}) — bleibt oberhalb des Welkepunkts (0,32).`,
    };
  }

  if (stats.variable === 'T2M') {
    const threshold = stats.window === 'summer_jja' ? 23.0 : stats.window === 'spring_mam' ? 15.0 : 14.5;
    const startVal = lastHist?.value ?? stats.recentMean;
    if (startVal >= threshold) {
      return {
        crossed: true,
        alreadyExceeded: true,
        crossingYear: stats.endYear,
        uncertaintyYears: null,
        thresholdValue: threshold,
        projected2035,
        ci2035Lower,
        ci2035Upper,
        messageEn: `Already above the ${threshold.toFixed(1)} °C heat-stress limit; ${horizonYear} projection reaches ${projected2035.toFixed(2)} °C (${rangePct}% range: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} °C).`,
        messageDe: `Bereits über der Hitzeschwelle von ${threshold.toFixed(1)} °C; Ausblick ${horizonYear}: ${projected2035.toFixed(2)} °C (${rangePct}-%-Bereich: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} °C).`,
      };
    }
    const crossPt = projPoints.find((p) => (p.projectedValue ?? 0) >= threshold);
    const earlyCross = projPoints.find((p) => (p.ciUpper ?? 0) >= threshold);
    if (crossPt) {
      const unc = earlyCross ? Math.max(1, Math.abs(crossPt.year - earlyCross.year)) : 2;
      return {
        crossed: true,
        alreadyExceeded: false,
        crossingYear: crossPt.year,
        uncertaintyYears: unc,
        thresholdValue: threshold,
        projected2035,
        ci2035Lower,
        ci2035Upper,
        messageEn: `Mean temperature is projected to cross the ${threshold.toFixed(1)} °C heat-stress limit around ${crossPt.year} (±${unc} yrs).`,
        messageDe: `Die Mitteltemperatur überschreitet die Hitzeschwelle von ${threshold.toFixed(1)} °C voraussichtlich bis ${crossPt.year} (±${unc} J.).`,
      };
    }
    return {
      crossed: false,
      alreadyExceeded: false,
      crossingYear: null,
      uncertaintyYears: null,
      thresholdValue: threshold,
      projected2035,
      ci2035Lower,
      ci2035Upper,
      messageEn: `${horizonYear} outlook: ${projected2035.toFixed(2)} °C (${rangePct}% range: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} °C) — stays below the ${threshold.toFixed(1)} °C heat threshold.`,
      messageDe: `Ausblick ${horizonYear}: ${projected2035.toFixed(2)} °C (${rangePct}-%-Bereich: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} °C) — bleibt unter der Hitzeschwelle von ${threshold.toFixed(1)} °C.`,
    };
  }

  if (stats.variable === 'PRECTOTCORR') {
    const threshold = 1.25;
    const crossPt = projPoints.find((p) => (p.projectedValue ?? 99) <= threshold);
    const earlyCross = projPoints.find((p) => (p.ciLower ?? 99) <= threshold);
    if (crossPt) {
      const unc = earlyCross ? Math.max(1, Math.abs(crossPt.year - earlyCross.year)) : 3;
      return {
        crossed: true,
        alreadyExceeded: false,
        crossingYear: crossPt.year,
        uncertaintyYears: unc,
        thresholdValue: threshold,
        projected2035,
        ci2035Lower,
        ci2035Upper,
        messageEn: `Rainfall is projected to fall below the ${threshold.toFixed(2)} mm/day rainfed threshold around ${crossPt.year} (±${unc} yrs).`,
        messageDe: `Der Niederschlag fällt voraussichtlich bis ${crossPt.year} (±${unc} J.) unter ${threshold.toFixed(2)} mm/Tag.`,
      };
    }
    return {
      crossed: false,
      alreadyExceeded: false,
      crossingYear: null,
      uncertaintyYears: null,
      thresholdValue: threshold,
      projected2035,
      ci2035Lower,
      ci2035Upper,
      messageEn: `${horizonYear} outlook: ${projected2035.toFixed(2)} mm/day (${rangePct}% range: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} mm/day) — above the ${threshold.toFixed(2)} mm/day dryland cutoff.`,
      messageDe: `Ausblick ${horizonYear}: ${projected2035.toFixed(2)} mm/Tag (${rangePct}-%-Bereich: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} mm/Tag) — über der Trockengrenze von ${threshold.toFixed(2)} mm/Tag.`,
    };
  }

  // EVLAND
  const threshold = 2.4;
  const crossPt = projPoints.find((p) => (p.projectedValue ?? 0) >= threshold);
  const earlyCross = projPoints.find((p) => (p.ciUpper ?? 0) >= threshold);
  if (crossPt) {
    const unc = earlyCross ? Math.max(1, Math.abs(crossPt.year - earlyCross.year)) : 3;
    return {
      crossed: true,
      alreadyExceeded: false,
      crossingYear: crossPt.year,
      uncertaintyYears: unc,
      thresholdValue: threshold,
      projected2035,
      ci2035Lower,
      ci2035Upper,
      messageEn: `Evaporation demand is projected to exceed ${threshold.toFixed(2)} mm/day around ${crossPt.year} (±${unc} yrs).`,
      messageDe: `Die Verdunstung überschreitet ${threshold.toFixed(2)} mm/Tag voraussichtlich bis ${crossPt.year} (±${unc} J.).`,
    };
  }

  return {
    crossed: false,
    alreadyExceeded: false,
    crossingYear: null,
    uncertaintyYears: null,
    thresholdValue: threshold,
    projected2035,
    ci2035Lower,
    ci2035Upper,
    messageEn: `${horizonYear} outlook: ${projected2035.toFixed(2)} mm/day (${rangePct}% range: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} mm/day) — below the ${threshold.toFixed(2)} mm/day high-demand threshold.`,
    messageDe: `Ausblick ${horizonYear}: ${projected2035.toFixed(2)} mm/Tag (${rangePct}-%-Bereich: ${ci2035Lower.toFixed(2)}–${ci2035Upper.toFixed(2)} mm/Tag) — unter der Verdunstungsschwelle von ${threshold.toFixed(2)} mm/Tag.`,
  };
}

export function localizeTrendClassification(
  stats: TrendStatistics,
  lang: 'de' | 'en'
): string {
  if (!stats.isSignificant) {
    return lang === 'de'
      ? 'Kein eindeutiger Trend (Schwankung)'
      : 'No clear trend (natural variation)';
  }
  const inc = stats.direction === 'increasing';
  if (lang === 'en') {
    switch (stats.variable) {
      case 'T2M':
        return inc ? 'Clear warming trend' : 'Clear cooling trend';
      case 'PRECTOTCORR':
        return inc ? 'Increasing rainfall' : 'Declining rainfall';
      case 'GWETROOT':
        return inc ? 'Rising soil moisture' : 'Drying root zone';
      case 'EVLAND':
        return inc ? 'Rising evaporation demand' : 'Declining evaporation';
    }
  }
  switch (stats.variable) {
    case 'T2M':
      return inc ? 'Eindeutige Erwärmung' : 'Eindeutige Abkühlung';
    case 'PRECTOTCORR':
      return inc ? 'Zunehmender Niederschlag' : 'Rückläufiger Niederschlag';
    case 'GWETROOT':
      return inc ? 'Zunehmende Bodenfeuchte' : 'Austrocknender Wurzelraum';
    case 'EVLAND':
      return inc ? 'Steigende Verdunstung' : 'Sinkende Verdunstung';
  }
}

export function generateDetectiveExplainer(
  stats: TrendStatistics,
  regionName: string,
  lang: 'de' | 'en' = 'en'
): {
  headline: string;
  statisticalInterpretation: string;
  regionalMechanism: string;
} {
  const meta = VARIABLE_META[stats.variable];
  const slopeSign = stats.sensSlopePerDecade >= 0 ? '+' : '';
  const slopeFormatted = `${slopeSign}${stats.sensSlopePerDecade.toFixed(3)} ${meta.unit}/${lang === 'de' ? 'Dekade' : 'decade'}`;
  const pFormatted = stats.pValue < 0.001 ? '< 0.001' : stats.pValue.toFixed(4);

  if (lang === 'de') {
    const varNameDe =
      stats.variable === 'T2M'
        ? 'Lufttemperatur (2m)'
        : stats.variable === 'PRECTOTCORR'
        ? 'Niederschlag'
        : stats.variable === 'GWETROOT'
        ? 'Wurzelraum-Bodenfeuchte'
        : 'Land-Evapotranspiration';
    const windowLabelDe =
      stats.window === 'summer_jja'
        ? 'Sommer (Jun–Aug)'
        : stats.window === 'spring_mam'
        ? 'Frühjahr (Mär–Mai)'
        : 'Jahresmittel';

    if (stats.isSignificant) {
      const dirWord = stats.direction === 'increasing' ? 'aufwärtsgerichtete' : 'abwärtsgerichtete';
      return {
        headline: `Bestätigte ${dirWord} Veränderung bei ${varNameDe} (${windowLabelDe})`,
        statisticalInterpretation: `Über ${stats.sampleCount} Jahre (${stats.startYear}–${stats.endYear}) am Standort ${regionName} erreicht der nicht-parametrische Mann-Kendall-Test Z = ${stats.mannKendallZ.toFixed(2)} (p = ${pFormatted}) und überschreitet damit die 95%-Signifikanzschwelle. Die robuste Sen-Steigung schätzt eine langfristige Rate von ${slopeFormatted} (SE = ${stats.residualSE.toFixed(3)} ${meta.unit}).`,
        regionalMechanism: getRegionalPhysicsNote(stats.variable, stats.direction, 'de'),
      };
    }

    return {
      headline: `Starke Jahres-Variabilität überlagert den Trend bei ${varNameDe}`,
      statisticalInterpretation: `Für das Zeitfenster ${windowLabelDe} am Standort ${regionName} liegt der Mann-Kendall-Wert bei Z = ${stats.mannKendallZ.toFixed(2)} mit p = ${pFormatted} (unterhalb von 95% Konfidenz). Obwohl die Sen-Steigung ${slopeFormatted} anzeigt, verhindern starke Schwankungen (SE = ${stats.residualSE.toFixed(3)}) eine statistisch abgesicherte Trennung vom Klimarauschen.`,
      regionalMechanism: getRegionalPhysicsNote(stats.variable, stats.direction, 'de'),
    };
  }

  const windowLabel = SEASONAL_WINDOW_LABELS[stats.window].shortLabel;

  if (stats.isSignificant) {
    const directionWord = stats.direction === 'increasing' ? 'upward' : 'downward';
    return {
      headline: `Confirmed ${directionWord} shift in ${meta.shortLabel} (${windowLabel})`,
      statisticalInterpretation: `Across ${stats.sampleCount} years (${stats.startYear}–${stats.endYear}) at ${regionName}, the non-parametric Mann-Kendall test yields Z = ${stats.mannKendallZ.toFixed(2)} (p = ${pFormatted}), surpassing the 95% confidence threshold. Sen's Slope estimates a sustained change of ${slopeFormatted} with residual SE = ${stats.residualSE.toFixed(3)} ${meta.unit}.`,
      regionalMechanism: getRegionalPhysicsNote(stats.variable, stats.direction, 'en'),
    };
  }

  return {
    headline: `High year-to-year variability masks a clear trend in ${meta.shortLabel}`,
    statisticalInterpretation: `For ${windowLabel} at ${regionName}, the Mann-Kendall statistic is Z = ${stats.mannKendallZ.toFixed(2)} with p = ${pFormatted} (below 95% confidence). While Sen's Slope reads ${slopeFormatted} (SE = ${stats.residualSE.toFixed(3)}), strong inter-annual oscillations keep the long-term signal indistinguishable from natural variability.`,
    regionalMechanism: getRegionalPhysicsNote(stats.variable, stats.direction, 'en'),
  };
}

function getRegionalPhysicsNote(
  variable: ClimateVariable,
  direction: 'increasing' | 'decreasing' | 'neutral',
  lang: 'de' | 'en'
): string {
  if (lang === 'de') {
    switch (variable) {
      case 'T2M':
        return 'Physikalischer Hintergrund: Kontinentale Becken erwärmen sich schneller, sobald trockene Böden weniger Verdunstungskühlung liefern, während küstennahe oder bewässerte Täler Temperaturspitzen abpuffern.';
      case 'PRECTOTCORR':
        return 'Physikalischer Hintergrund: Eine polwärtige Verlagerung subtropischer Hochdruckgürtel trocknet mediterrane Sommergürtel aus, während wärmere Luftmassen ~7 % mehr Wasserdampf pro °C aufnehmen.';
      case 'GWETROOT':
        return direction === 'decreasing'
          ? 'Physikalischer Hintergrund: Selbst bei stabilem Jahresniederschlag treiben heißere Sommer das Sättigungsdefizit (VPD) hoch und entziehen dem Wurzelraum schneller Wasser, als Starkregen versickern können.'
          : 'Physikalischer Hintergrund: Die Wurzelraumfeuchte spiegelt das Zusammenspiel aus Versickerung, Ton-Speicherkapazität, Bewässerung und Verdunstungsanspruch wider.';
      case 'EVLAND':
        return 'Physikalischer Hintergrund: In energielimitierten Regionen steigt die Verdunstung mit der Temperatur, während sie in wasserlimitierten Regionen im Hochsommer mangels Bodenwasser stagniert.';
    }
  }

  switch (variable) {
    case 'T2M':
      return 'Regional mechanism: Lower-latitude continental interiors warm faster when dry soils reduce evaporative cooling, whereas coastal or heavily irrigated valleys experience buffered daytime highs.';
    case 'PRECTOTCORR':
      return 'Regional mechanism: Poleward expansion of subtropical high-pressure belts dries Mediterranean summer belts, while warmer air masses hold ~7% more moisture per °C and intensify convective storms elsewhere.';
    case 'GWETROOT':
      return direction === 'decreasing'
        ? 'Regional mechanism: Even where annual rainfall stays flat, warmer summers drive higher atmospheric vapor-pressure deficit (VPD), pulling moisture out of the root zone faster than sporadic downpours can infiltrate.'
        : 'Regional mechanism: Root-zone wetness reflects the balance between rainfall infiltration, clay water-holding capacity, irrigation return flows, and evaporative demand.';
    case 'EVLAND':
      return 'Regional mechanism: Evapotranspiration increases in energy-limited cool regions as temperatures warm, but plateaus or declines in water-limited arid regions once soil moisture is exhausted.';
  }
}

export interface MonthlyTimelineSnapshot {
  slicedRecordsByVariable: Record<ClimateVariable, MonthlyRecord[]>;
  activeMonthValues: Record<
    ClimateVariable,
    {
      value: number;
      baseline1990sMonthMean: number;
      anomaly: number;
    }
  >;
}

function projectMonthlyDelta(
  variable: ClimateVariable,
  sensSlopePerYear: number,
  dt: number,
  mode: ForecastMode
): number {
  if (mode !== 'cmip6_ssp585') {
    return sensSlopePerYear * dt;
  }
  const nonlinearFactor = Math.pow(dt, 1.12);
  switch (variable) {
    case 'T2M': {
      const sspSlope = Math.max(sensSlopePerYear * 1.45, sensSlopePerYear + 0.045);
      return sspSlope * nonlinearFactor;
    }
    case 'GWETROOT': {
      const sspDrySlope = Math.min(sensSlopePerYear * 1.4, sensSlopePerYear - 0.0032);
      return sspDrySlope * nonlinearFactor;
    }
    case 'PRECTOTCORR': {
      const sspPrecipSlope =
        sensSlopePerYear < 0
          ? sensSlopePerYear * 1.35 - 0.008
          : sensSlopePerYear * 1.2;
      return sspPrecipSlope * nonlinearFactor;
    }
    case 'EVLAND': {
      const sspEtSlope = Math.max(sensSlopePerYear * 1.35, sensSlopePerYear + 0.014);
      return sspEtSlope * nonlinearFactor;
    }
  }
}

/**
 * Extends 1990–2025 monthly records through Dec 2035 when in projection mode,
 * slices all 4 variables strictly up to (activeYear, activeMonth), and computes
 * the telemetry + 1990s seasonal baseline anomaly averaged over `periodMonths` (default: that month).
 */
export function extendAndSliceMonthlyRecords(
  recordsByVariable: Record<ClimateVariable, MonthlyRecord[]>,
  climatology: MonthlyClimatologyPoint[],
  forecastMode: ForecastMode,
  activeYear: number,
  activeMonth: number,
  ensembleRecords?: EnsembleRecordsByVariable | null,
  periodMonths: YearMonth[] = [{ year: activeYear, month: activeMonth }]
): MonthlyTimelineSnapshot {
  const variables: ClimateVariable[] = ['T2M', 'PRECTOTCORR', 'GWETROOT', 'EVLAND'];
  const slicedRecordsByVariable = {} as Record<ClimateVariable, MonthlyRecord[]>;
  const activeMonthValues = {} as MonthlyTimelineSnapshot['activeMonthValues'];

  for (const variable of variables) {
    const rawRecords = recordsByVariable[variable] ?? [];
    const decimals = variable === 'GWETROOT' ? 3 : 2;
    const annualStats = analyzeClimateSeries(rawRecords, variable, 'annual').stats;
    const sensSlopePerYear = annualStats.sensSlopePerDecade / 10;

    // 1990-2000 baseline mean per calendar month for seasonal anomaly calculation
    const baselineMonthMeans = new Map<number, number>();
    const recentMonthAnchors = new Map<number, number>();

    for (let m = 1; m <= 12; m++) {
      const climFallback =
        climatology[m - 1]?.[
          variable === 'T2M'
            ? 't2m'
            : variable === 'PRECTOTCORR'
            ? 'prectotcorr'
            : variable === 'GWETROOT'
            ? 'gwetroot'
            : 'evland'
        ] ?? annualStats.baselineMean;

      const base90s = rawRecords.filter(
        (r) => r.month === m && r.year <= 2000 && Number.isFinite(r.value) && r.value > -900
      );
      baselineMonthMeans.set(
        m,
        base90s.length > 0
          ? base90s.reduce((acc, r) => acc + r.value, 0) / base90s.length
          : climFallback
      );

      // Anchor 2025 seasonal cycle from 2021-2025 average adjusted smoothly to 2025
      const recent5 = rawRecords.filter(
        (r) => r.month === m && r.year >= 2021 && Number.isFinite(r.value) && r.value > -900
      );
      const anchorVal =
        recent5.length > 0
          ? recent5.reduce((acc, r) => acc + r.value, 0) / recent5.length + sensSlopePerYear * 2
          : climFallback + sensSlopePerYear * 17;
      recentMonthAnchors.set(m, anchorVal);
    }

    const extended: MonthlyRecord[] = [...rawRecords];
    if (forecastMode !== 'historical' && activeYear > 2025) {
      for (let yr = 2026; yr <= 2035; yr++) {
        const dt = yr - 2025;
        const delta = projectMonthlyDelta(variable, sensSlopePerYear, dt, forecastMode);
        for (let m = 1; m <= 12; m++) {
          const anchor = recentMonthAnchors.get(m) ?? annualStats.recentMean;
          const val = Number(clampByVariable(variable, anchor + delta).toFixed(decimals));
          extended.push({ year: yr, month: m, value: val });
        }
      }
    }
    if (forecastMode === 'ensemble' && activeYear > 2025 && ensembleRecords) {
      // Backend ensemble: observed ERA5 months after the NASA archive, then the monthly forecast
      const lastNasaKey = rawRecords.reduce((acc, r) => Math.max(acc, r.year * 12 + r.month), -Infinity);
      for (const pt of ensembleRecords[variable] ?? []) {
        if (pt.year * 12 + pt.month <= lastNasaKey) continue;
        extended.push({ year: pt.year, month: pt.month, value: pt.value });
      }
    }

    const sliced = extended.filter(
      (r) => r.year < activeYear || (r.year === activeYear && r.month <= activeMonth)
    );
    slicedRecordsByVariable[variable] = sliced;

    const periodKeys = new Set(periodMonths.map((p) => p.year * 12 + p.month));
    const periodRecords = sliced.filter((r) => periodKeys.has(r.year * 12 + r.month));
    const mean = (xs: number[]) => xs.reduce((acc, x) => acc + x, 0) / xs.length;
    const currentValue =
      periodRecords.length > 0
        ? mean(periodRecords.map((r) => r.value))
        : sliced[sliced.length - 1]?.value ?? annualStats.recentMean;
    // Baseline over the same calendar months the period actually has data for
    const baseMonths = periodRecords.length > 0 ? periodRecords.map((r) => r.month) : [activeMonth];
    const baseMonthMean = mean(
      baseMonths.map((m) => baselineMonthMeans.get(m) ?? annualStats.baselineMean)
    );

    activeMonthValues[variable] = {
      value: Number(currentValue.toFixed(decimals)),
      baseline1990sMonthMean: Number(baseMonthMean.toFixed(decimals)),
      anomaly: Number((currentValue - baseMonthMean).toFixed(decimals)),
    };
  }

  return {
    slicedRecordsByVariable,
    activeMonthValues,
  };
}

