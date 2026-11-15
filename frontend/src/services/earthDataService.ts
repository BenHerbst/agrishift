import {
  PRESET_REGIONS,
  classifySoilTexture,
  computeMonthlyClimatology,
  generateFallbackSeries,
} from '../data/presets';
import { generateFieldSamplePoints } from '../utils/fieldGeometry';
import type {
  ClimateVariable,
  DataSourceStatus,
  DrawnFieldPolygon,
  EarthSystemDataset,
  MonthlyRecord,
  SoilProfile,
} from '../types/terrashift';

// NASA POWER answers in about a second; SoilGrids takes 4–12 s for a point it has not served recently.
// Both go through the server's disk cache, so only the first visit of a site waits this long.
const POWER_TIMEOUT_MS = 15000;
const SOIL_TIMEOUT_MS = 25000;
// SoilGrids depth intervals for the topsoil, weighted by thickness (cm)
const TOPSOIL_DEPTHS: Array<[string, number]> = [['0-5cm', 5], ['5-15cm', 10], ['15-30cm', 15]];

interface NasaPowerResponse {
  properties?: {
    parameter?: Partial<Record<ClimateVariable, Record<string, number>>>;
  };
}

interface SoilGridsLayer {
  name: string;
  depths?: Array<{
    label?: string;
    values?: {
      mean?: number | null;
    };
  }>;
}

interface SoilGridsResponse {
  properties?: {
    layers?: SoilGridsLayer[];
  };
}

// Goes through the Express server's disk cache (server.ts, /api/cached), so a location that was
// visited once loads instantly afterwards.
const cached = (url: string) => `/api/cached?url=${encodeURIComponent(url)}`;

async function fetchWithTimeout(url: string, timeoutMs: number, externalSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function parseNasaParameterMap(rawMap: Record<string, number> | undefined): MonthlyRecord[] {
  if (!rawMap) return [];
  const records: MonthlyRecord[] = [];

  for (const [key, val] of Object.entries(rawMap)) {
    if (!/^\d{6}$/.test(key)) continue;
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4, 6));
    // Skip month 13 (POWER annual aggregate) and -999 fill values
    if (month < 1 || month > 12) continue;
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= -900) continue;
    records.push({ year, month, value: val });
  }

  return records.sort((a, b) => a.year - b.year || a.month - b.month);
}

function findRegionLabel(lat: number, lon: number): string {
  const matched = PRESET_REGIONS.find(
    (p) => Math.abs(p.lat - lat) < 0.05 && Math.abs(p.lon - lon) < 0.05
  );
  if (matched) return matched.name;
  const latHem = lat >= 0 ? 'N' : 'S';
  const lonHem = lon >= 0 ? 'E' : 'W';
  return `Custom Site (${Math.abs(lat).toFixed(3)}°${latHem}, ${Math.abs(lon).toFixed(3)}°${lonHem})`;
}

/** NASA POWER monthly point request: 4 agro-climate parameters, 1990–2025, Agroclimatology community. */
export function nasaPowerMonthlyUrl(lat: number, lon: number): string {
  return `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR,GWETROOT,EVLAND&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&start=1990&end=2025&format=JSON`;
}

async function fetchNasaPower(
  lat: number,
  lon: number,
  fallbackRecords: Record<ClimateVariable, MonthlyRecord[]>,
  signal?: AbortSignal
): Promise<{
  recordsByVariable: Record<ClimateVariable, MonthlyRecord[]>;
  source: DataSourceStatus;
  latencyMs: number;
}> {
  const start = performance.now();
  const url = nasaPowerMonthlyUrl(lat, lon);

  try {
    const res = await fetchWithTimeout(cached(url), POWER_TIMEOUT_MS, signal);
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return { recordsByVariable: fallbackRecords, source: 'fallback', latencyMs };
    }

    const json = (await res.json()) as NasaPowerResponse;
    const params = json?.properties?.parameter;
    if (!params) {
      return { recordsByVariable: fallbackRecords, source: 'fallback', latencyMs };
    }

    const parsed: Record<ClimateVariable, MonthlyRecord[]> = {
      T2M: parseNasaParameterMap(params.T2M),
      PRECTOTCORR: parseNasaParameterMap(params.PRECTOTCORR),
      GWETROOT: parseNasaParameterMap(params.GWETROOT),
      EVLAND: parseNasaParameterMap(params.EVLAND),
    };

    // Ensure at least 15 years of real records exist (e.g., if an ocean point returns empty GWETROOT)
    const hasCoreData =
      parsed.T2M.length >= 180 &&
      parsed.PRECTOTCORR.length >= 180 &&
      parsed.GWETROOT.length >= 120 &&
      parsed.EVLAND.length >= 120;

    if (!hasCoreData) {
      return {
        recordsByVariable: {
          T2M: parsed.T2M.length >= 180 ? parsed.T2M : fallbackRecords.T2M,
          PRECTOTCORR: parsed.PRECTOTCORR.length >= 180 ? parsed.PRECTOTCORR : fallbackRecords.PRECTOTCORR,
          GWETROOT: parsed.GWETROOT.length >= 120 ? parsed.GWETROOT : fallbackRecords.GWETROOT,
          EVLAND: parsed.EVLAND.length >= 120 ? parsed.EVLAND : fallbackRecords.EVLAND,
        },
        source: parsed.T2M.length >= 180 ? 'live' : 'fallback',
        latencyMs,
      };
    }

    return {
      recordsByVariable: parsed,
      source: 'live',
      latencyMs,
    };
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return {
      recordsByVariable: fallbackRecords,
      source: 'fallback',
      latencyMs,
    };
  }
}

/** ISRIC SoilGrids point request: pH, organic carbon, clay and sand for the three topsoil intervals. */
export function soilGridsUrl(lat: number, lon: number): string {
  const depthQuery = TOPSOIL_DEPTHS.map(([label]) => `depth=${label}`).join('&');
  return `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&property=phh2o&property=soc&property=clay&property=sand&${depthQuery}&value=mean`;
}

interface BackendSoilResponse {
  profile?: {
    topsoil_0_30cm?: { 'sand_%'?: number; 'clay_%'?: number; 'organic_matter_%'?: number; ph?: number };
  };
}

/** Backend /soil: SoilGrids median of the soil pixels within ~1 km. null if unavailable. */
async function soilFromBackend(lat: number, lon: number, start: number, signal?: AbortSignal): Promise<SoilProfile | null> {
  try {
    const res = await fetchWithTimeout(
      `${(import.meta.env?.VITE_CLIMATE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '/api/climate'}/soil?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
      SOIL_TIMEOUT_MS * 2,
      signal
    );
    if (!res.ok) return null;
    const top = ((await res.json()) as BackendSoilResponse).profile?.topsoil_0_30cm;
    if (!top || top.ph == null || top['clay_%'] == null || top['sand_%'] == null || top['organic_matter_%'] == null) return null;
    const clayPercent = Math.round(top['clay_%']);
    const sandPercent = Math.round(top['sand_%']);
    const siltPercent = Math.max(0, 100 - clayPercent - sandPercent);
    return {
      ph: Number(top.ph.toFixed(1)),
      socPercent: Number((top['organic_matter_%'] / 1.724).toFixed(2)), // van Bemmelen factor
      clayPercent,
      sandPercent,
      siltPercent,
      textureClass: classifySoilTexture(clayPercent, sandPercent, siltPercent),
      source: 'live',
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return null;
  }
}

async function fetchSoilGrids(
  lat: number,
  lon: number,
  fallbackSoil: SoilProfile,
  signal?: AbortSignal
): Promise<SoilProfile> {
  const start = performance.now();
  const url = soilGridsUrl(lat, lon);

  try {
    const res = await fetchWithTimeout(cached(url), SOIL_TIMEOUT_MS, signal);
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return (await soilFromBackend(lat, lon, start, signal)) ?? { ...fallbackSoil, source: 'fallback', latencyMs };
    }

    const json = (await res.json()) as SoilGridsResponse;
    const layers = json?.properties?.layers ?? [];

    // Thickness-weighted 0–30 cm mean over the depth intervals that have data
    const readLayerMean = (name: string): number | null => {
      const layer = layers.find((l) => l.name === name);
      let sum = 0;
      let weight = 0;
      for (const [label, cm] of TOPSOIL_DEPTHS) {
        const val = layer?.depths?.find((d) => d.label === label)?.values?.mean;
        if (typeof val === 'number' && Number.isFinite(val)) {
          sum += val * cm;
          weight += cm;
        }
      }
      return weight > 0 ? sum / weight : null;
    };

    const rawPh = readLayerMean('phh2o');
    const rawSoc = readLayerMean('soc');
    const rawClay = readLayerMean('clay');
    const rawSand = readLayerMean('sand');

    if (rawPh === null || rawSoc === null || rawClay === null || rawSand === null) {
      // Built-up or water pixel: SoilGrids masks it, the backend takes the median of soil pixels nearby
      return (await soilFromBackend(lat, lon, start, signal)) ?? { ...fallbackSoil, source: 'fallback', latencyMs };
    }

    // SoilGrids v2.0 standard unit conversions:
    // phh2o: pH * 10 | soc: dg/kg -> divide by 100 for % | clay/sand: g/kg -> divide by 10 for %
    const ph = Number((rawPh / 10).toFixed(1));
    const socPercent = Number((rawSoc / 100).toFixed(2));
    const clayPercent = Math.round(rawClay / 10);
    const sandPercent = Math.round(rawSand / 10);
    const siltPercent = Math.max(0, 100 - clayPercent - sandPercent);

    return {
      ph,
      socPercent,
      clayPercent,
      sandPercent,
      siltPercent,
      textureClass: classifySoilTexture(clayPercent, sandPercent, siltPercent),
      source: 'live',
      latencyMs,
    };
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return { ...fallbackSoil, source: 'fallback', latencyMs };
  }
}

function averageMonthlyRecordSets(
  sets: Array<Record<ClimateVariable, MonthlyRecord[]>>
): Record<ClimateVariable, MonthlyRecord[]> {
  if (sets.length === 1) return sets[0];
  const vars: ClimateVariable[] = ['T2M', 'PRECTOTCORR', 'GWETROOT', 'EVLAND'];
  const result = {} as Record<ClimateVariable, MonthlyRecord[]>;

  for (const v of vars) {
    const byKey = new Map<string, { year: number; month: number; sum: number; count: number }>();
    for (const set of sets) {
      for (const rec of set[v]) {
        const key = `${rec.year}-${rec.month}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.sum += rec.value;
          existing.count += 1;
        } else {
          byKey.set(key, { year: rec.year, month: rec.month, sum: rec.value, count: 1 });
        }
      }
    }
    const merged: MonthlyRecord[] = [];
    for (const item of byKey.values()) {
      merged.push({
        year: item.year,
        month: item.month,
        value: Number((item.sum / item.count).toFixed(4)),
      });
    }
    result[v] = merged.sort((a, b) => a.year - b.year || a.month - b.month);
  }

  return result;
}

function averageSoilProfiles(profiles: SoilProfile[]): SoilProfile {
  const live = profiles.filter((p) => p.source === 'live');
  const pool = live.length > 0 ? live : profiles;
  const n = pool.length;

  const ph = Number((pool.reduce((s, p) => s + p.ph, 0) / n).toFixed(1));
  const socPercent = Number((pool.reduce((s, p) => s + p.socPercent, 0) / n).toFixed(2));
  const clayPercent = Math.round(pool.reduce((s, p) => s + p.clayPercent, 0) / n);
  const sandPercent = Math.round(pool.reduce((s, p) => s + p.sandPercent, 0) / n);
  const siltPercent = Math.max(0, 100 - clayPercent - sandPercent);
  const latencyMs = Math.round(pool.reduce((s, p) => s + p.latencyMs, 0) / n);

  return {
    ph,
    socPercent,
    clayPercent,
    sandPercent,
    siltPercent,
    textureClass: classifySoilTexture(clayPercent, sandPercent, siltPercent),
    source: live.length > 0 ? 'live' : 'fallback',
    latencyMs,
  };
}

export async function fetchEarthSystemData(
  lat: number,
  lon: number,
  signal?: AbortSignal,
  customRegionLabel?: string
): Promise<EarthSystemDataset> {
  const fallback = generateFallbackSeries(lat, lon);

  const [powerResult, soilResult] = await Promise.all([
    fetchNasaPower(lat, lon, fallback.recordsByVariable, signal),
    fetchSoilGrids(lat, lon, fallback.soil, signal),
  ]);

  const { climatology, peakHeatMonths, moistureDeficitMonths } = computeMonthlyClimatology(
    powerResult.recordsByVariable
  );

  return {
    lat,
    lon,
    regionName: customRegionLabel || findRegionLabel(lat, lon),
    powerSource: powerResult.source,
    powerPoints: [{ lat, lon }],
    powerLatencyMs: powerResult.latencyMs,
    recordsByVariable: powerResult.recordsByVariable,
    climatology,
    soil: soilResult,
    peakHeatMonths,
    moistureDeficitMonths,
    fetchedAtIso: new Date().toISOString(),
  };
}

export async function fetchFieldAverageEarthSystemData(
  field: DrawnFieldPolygon,
  signal?: AbortSignal
): Promise<EarthSystemDataset> {
  const samplePoints = generateFieldSamplePoints(field.coordinates, 5);

  // Deduplicate MERRA-2 0.5° x 0.625° cells for NASA POWER requests (max 4 unique cells)
  const uniquePowerPoints: Array<{ lat: number; lon: number }> = [];
  const seenCells = new Set<string>();
  for (const pt of samplePoints) {
    const cellKey = `${Math.round(pt.lat / 0.5)}_${Math.round(pt.lon / 0.625)}`;
    if (!seenCells.has(cellKey)) {
      seenCells.add(cellKey);
      uniquePowerPoints.push(pt);
    }
    if (uniquePowerPoints.length >= 4) break;
  }

  const [powerResults, soilResults] = await Promise.all([
    Promise.all(
      uniquePowerPoints.map((pt) => {
        const fb = generateFallbackSeries(pt.lat, pt.lon);
        return fetchNasaPower(pt.lat, pt.lon, fb.recordsByVariable, signal);
      })
    ),
    // shortcut: soil from the field centre only. SoilGrids allows ~5 requests a minute and a field of a
    // few dozen hectares spans 2–3 of its 250 m pixels; sample more points for very large fields.
    Promise.all(
      [{ lat: field.centroidLat, lon: field.centroidLon }].map((pt) => {
        const fb = generateFallbackSeries(pt.lat, pt.lon);
        return fetchSoilGrids(pt.lat, pt.lon, fb.soil, signal);
      })
    ),
  ]);

  const livePower = powerResults.filter((r) => r.source === 'live');
  const powerPool = livePower.length > 0 ? livePower : powerResults;
  const averagedRecords = averageMonthlyRecordSets(powerPool.map((p) => p.recordsByVariable));
  const avgPowerLatency = Math.round(
    powerPool.reduce((s, p) => s + p.latencyMs, 0) / powerPool.length
  );

  const averagedSoil = averageSoilProfiles(soilResults);
  const { climatology, peakHeatMonths, moistureDeficitMonths } =
    computeMonthlyClimatology(averagedRecords);

  const areaLabel = `${field.areaHectares.toFixed(1)} ha`;

  return {
    lat: field.centroidLat,
    lon: field.centroidLon,
    regionName: `Drawn Field (${areaLabel})`,
    powerSource: livePower.length > 0 ? 'live' : 'fallback',
    powerPoints: uniquePowerPoints,
    powerLatencyMs: avgPowerLatency,
    recordsByVariable: averagedRecords,
    climatology,
    soil: averagedSoil,
    peakHeatMonths,
    moistureDeficitMonths,
    fetchedAtIso: new Date().toISOString(),
    fieldAreaStats: {
      areaHectares: field.areaHectares,
      perimeterMeters: field.perimeterMeters,
      samplePointsCount: samplePoints.length,
      polygonCoordinates: field.coordinates,
    },
  };
}
