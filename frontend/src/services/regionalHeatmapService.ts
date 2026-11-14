/**
 * Regional climate grids for the map heatmaps: NASA POWER monthly *regional* endpoint
 * (MERRA-2 grid, 0.5° lat × 0.625° lon), 1990–2025, one parameter per request.
 *
 * Requests go through the Express disk cache (server.ts, /api/cached), so a region that was
 * shown once loads instantly afterwards.
 *
 * Months after the measured record (forecast years) are built with the same delta method as the
 * site forecast: each cell's 1991–2020 normal for that calendar month plus the site's anomaly
 * (additive for temperature and soil moisture, as a ratio for precipitation).
 */

export type HeatmapLayerId = 'temp' | 'precip' | 'moisture';

export interface HeatmapLayerSpec {
  id: HeatmapLayerId;
  parameter: 'T2M' | 'PRECTOTCORR' | 'GWETROOT';
  unit: string;
  decimals: number;
  anomaly: 'additive' | 'ratio';
  /** Low → high colour ramp. */
  colors: string[];
}

export const HEATMAP_LAYERS: Record<HeatmapLayerId, HeatmapLayerSpec> = {
  temp: {
    id: 'temp',
    parameter: 'T2M',
    unit: '°C',
    decimals: 1,
    anomaly: 'additive',
    colors: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
  },
  precip: {
    id: 'precip',
    parameter: 'PRECTOTCORR',
    unit: 'mm/d',
    decimals: 2,
    anomaly: 'ratio',
    colors: ['#f7fcf0', '#ccebc5', '#7bccc4', '#43a2ca', '#0868ac', '#253494', '#081d58'],
  },
  moisture: {
    id: 'moisture',
    parameter: 'GWETROOT',
    unit: 'GWET',
    decimals: 2,
    anomaly: 'additive',
    colors: ['#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#c7eae5', '#80cdc1', '#35978f', '#01665e'],
  },
};

export const MEASURED_START_YEAR = 1990;
export const MEASURED_END_YEAR = 2025;
const NORMAL_START = 1991;
const NORMAL_END = 2020;
const HALF_LAT_SPAN = 3;
const HALF_LON_SPAN = 4;
export const GRID_LAT_STEP = 0.5;
export const GRID_LON_STEP = 0.625;

export interface RegionalGrid {
  layer: HeatmapLayerSpec;
  /** [lon, lat] per grid cell */
  points: Array<[number, number]>;
  /** 'YYYYMM' → value per point (NaN where missing) */
  months: Map<string, Float64Array>;
  /** calendar month (1–12) → 1991–2020 mean per point */
  normals: Float64Array[];
  /**
   * Colour scale per calendar month (index 0 = January): 2nd–98th percentile over all cells and
   * years, so each month shows both the regional pattern and how a year compares to others.
   */
  ranges: Array<[number, number]>;
}

export interface GridFrame {
  values: Float64Array;
  kind: 'measured' | 'forecast' | 'normal';
}

const gridCache = new Map<string, Promise<RegionalGrid>>();

/** Box snapped to whole degrees so nearby sites share one cached request. */
export function regionalBox(lat: number, lon: number) {
  const cLat = Math.min(86, Math.max(-86, Math.round(lat)));
  const cLon = Math.min(175, Math.max(-175, Math.round(lon)));
  return {
    latMin: cLat - HALF_LAT_SPAN,
    latMax: cLat + HALF_LAT_SPAN,
    lonMin: cLon - HALF_LON_SPAN,
    lonMax: cLon + HALF_LON_SPAN,
  };
}

interface PowerRegionalResponse {
  features?: Array<{
    geometry: { coordinates: number[] };
    properties: { parameter: Record<string, Record<string, number>> };
  }>;
  messages?: string[];
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

async function loadGrid(layer: HeatmapLayerSpec, lat: number, lon: number): Promise<RegionalGrid> {
  const box = regionalBox(lat, lon);
  const url =
    `https://power.larc.nasa.gov/api/temporal/monthly/regional?parameters=${layer.parameter}&community=AG` +
    `&latitude-min=${box.latMin}&latitude-max=${box.latMax}&longitude-min=${box.lonMin}&longitude-max=${box.lonMax}` +
    `&start=${MEASURED_START_YEAR}&end=${MEASURED_END_YEAR}&format=JSON`;
  const res = await fetch(`/api/cached?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`NASA POWER regional request failed (${res.status})`);
  const json = (await res.json()) as PowerRegionalResponse;
  const features = json.features ?? [];
  if (features.length === 0) throw new Error(json.messages?.join(' ') || 'NASA POWER returned no grid cells');

  const points = features.map((f) => [f.geometry.coordinates[0], f.geometry.coordinates[1]] as [number, number]);
  const months = new Map<string, Float64Array>();
  const sums = Array.from({ length: 12 }, () => new Float64Array(points.length));
  const counts = Array.from({ length: 12 }, () => new Float64Array(points.length));
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);

  features.forEach((f, i) => {
    const series = f.properties.parameter[layer.parameter] ?? {};
    for (const [key, raw] of Object.entries(series)) {
      const month = Number(key.slice(4));
      if (month < 1 || month > 12) continue; // 'YYYY13' is the annual mean
      const value = raw === -999 || !Number.isFinite(raw) ? NaN : raw;
      let arr = months.get(key);
      if (!arr) {
        arr = new Float64Array(points.length).fill(NaN);
        months.set(key, arr);
      }
      arr[i] = value;
      if (Number.isNaN(value)) continue;
      byMonth[month - 1].push(value);
      const year = Number(key.slice(0, 4));
      if (year >= NORMAL_START && year <= NORMAL_END) {
        sums[month - 1][i] += value;
        counts[month - 1][i] += 1;
      }
    }
  });

  const normals = sums.map((s, m) => s.map((v, i) => (counts[m][i] > 0 ? v / counts[m][i] : NaN)));
  const ranges = byMonth.map((values): [number, number] => {
    values.sort((a, b) => a - b);
    const lo = percentile(values, 0.02);
    const hi = percentile(values, 0.98);
    return hi > lo ? [lo, hi] : [lo - 1, lo + 1];
  });
  return { layer, points, months, normals, ranges };
}

export function fetchRegionalGrid(layerId: HeatmapLayerId, lat: number, lon: number): Promise<RegionalGrid> {
  const box = regionalBox(lat, lon);
  const key = `${layerId}:${box.latMin}:${box.lonMin}`;
  let pending = gridCache.get(key);
  if (!pending) {
    pending = loadGrid(HEATMAP_LAYERS[layerId], lat, lon);
    pending.catch(() => gridCache.delete(key)); // retry on the next toggle
    gridCache.set(key, pending);
  }
  return pending;
}

export function nearestPointIndex(grid: RegionalGrid, lat: number, lon: number): number {
  let best = 0;
  let bestDist = Infinity;
  grid.points.forEach(([pLon, pLat], i) => {
    const d = ((pLat - lat) / GRID_LAT_STEP) ** 2 + ((pLon - lon) / GRID_LON_STEP) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/**
 * Grid values for one month. Measured months come straight from NASA POWER; later months apply
 * the site's value for that month as an anomaly to every cell's 1991–2020 normal.
 */
export function gridFrame(
  grid: RegionalGrid,
  year: number,
  month: number,
  site: { lat: number; lon: number; value?: number }
): GridFrame {
  const measured = grid.months.get(`${year}${String(month).padStart(2, '0')}`);
  if (measured && measured.some((v) => !Number.isNaN(v))) {
    return { values: measured, kind: 'measured' };
  }
  const normal = grid.normals[month - 1];
  const siteNormal = normal[nearestPointIndex(grid, site.lat, site.lon)];
  if (site.value === undefined || !Number.isFinite(site.value) || !Number.isFinite(siteNormal)) {
    return { values: normal, kind: 'normal' };
  }
  if (grid.layer.anomaly === 'ratio') {
    const ratio = siteNormal > 0.05 ? Math.min(3, Math.max(0.3, site.value / siteNormal)) : 1;
    return { values: normal.map((v) => v * ratio), kind: 'forecast' };
  }
  const delta = site.value - siteNormal;
  return { values: normal.map((v) => v + delta), kind: 'forecast' };
}
