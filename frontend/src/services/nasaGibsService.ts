/**
 * NASA GIBS (Global Imagery Browse Services) satellite layers for the map, as WMTS tiles in Web Mercator.
 * No key, CORS open. Each layer is shown for the timeline period; dates without imagery fall back to the
 * nearest available one, future months show the latest image.
 *
 * https://nasa-gibs.github.io/gibs-api-docs/
 */
export type GibsLayerId = 'ndvi' | 'lst' | 'smap';

export interface GibsLayerSpec {
  id: GibsLayerId;
  /** GIBS layer identifier */
  layer: string;
  matrixSet: string;
  /** Deepest tile level GIBS serves; Mapbox over-zooms beyond it. */
  maxzoom: number;
  /** Instrument / product shown in the legend */
  product: string;
  resolution: string;
  cadence: 'p16d' | 'monthly' | 'daily';
  /** First and last available date (YYYY-MM-DD) */
  first: string;
  last: string;
  /** Additional gaps inside [first, last] (inclusive YYYY-MM-DD ranges) */
  gaps?: Array<[string, string]>;
  /** Colour stops sampled from the official GIBS colormap: [value, rgb] */
  stops: Array<[number, string]>;
  unit: string;
  /** Pixelated rendering for fine products, so 250 m pixels stay visible at field zoom */
  resampling: 'nearest' | 'linear';
}

// shortcut: availability copied from the GIBS capabilities document on 2026-11-15;
// read GetCapabilities at startup if the latest dates need to stay current for months.
export const GIBS_LAYERS: Record<GibsLayerId, GibsLayerSpec> = {
  ndvi: {
    id: 'ndvi',
    layer: 'MODIS_Terra_L3_NDVI_16Day',
    matrixSet: 'GoogleMapsCompatible_Level9',
    maxzoom: 9,
    product: 'MODIS Terra · MOD13Q1 NDVI',
    resolution: '250 m',
    cadence: 'p16d',
    first: '2000-03-05',
    last: '2026-10-16',
    stops: [
      [0, '#d7c4b3'],
      [0.24, '#ac8d74'],
      [0.39, '#8fb715'],
      [0.58, '#438d01'],
      [0.82, '#006400'],
    ],
    unit: 'NDVI',
    resampling: 'nearest',
  },
  lst: {
    id: 'lst',
    layer: 'MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxzoom: 6,
    product: 'MODIS Terra · MOD11C3 LST Tag',
    resolution: '0,05° (≈ 5 km)',
    cadence: 'monthly',
    first: '2000-03-01',
    last: '2026-10-01',
    stops: [
      [-55, '#4900ff'],
      [-35, '#004dff'],
      [-16, '#00f0ff'],
      [3, '#6dff01'],
      [22, '#e6ff00'],
      [41, '#ffb500'],
      [61, '#ff5200'],
    ],
    unit: '°C',
    resampling: 'linear',
  },
  smap: {
    id: 'smap',
    layer: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
    matrixSet: 'GoogleMapsCompatible_Level6',
    maxzoom: 6,
    product: 'SMAP L4 · Wurzelraum-Bodenfeuchte',
    resolution: '9 km',
    cadence: 'daily',
    first: '2015-03-31',
    last: '2026-11-10',
    gaps: [
      ['2025-07-07', '2025-07-07'], ['2025-07-10', '2025-07-10'], ['2025-07-21', '2025-07-21'],
      ['2025-08-04', '2025-08-04'], ['2025-08-23', '2025-08-23'], ['2025-08-26', '2025-08-26'],
      ['2025-09-05', '2025-09-05'], ['2025-10-01', '2025-10-01'], ['2025-10-10', '2025-12-11'],
      ['2026-03-17', '2026-03-17'], ['2026-05-11', '2026-05-11'], ['2026-05-17', '2026-05-18'],
      ['2026-08-10', '2026-08-15'], ['2026-08-31', '2026-08-31'], ['2026-11-07', '2026-11-07'],
    ],
    stops: [
      [0, '#ffa200'],
      [0.09, '#fff100'],
      [0.18, '#71b800'],
      [0.27, '#00ab57'],
      [0.36, '#00e7ff'],
      [0.46, '#0024ff'],
      [0.55, '#00009e'],
    ],
    unit: 'm³/m³',
    resampling: 'linear',
  },
};

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

/** Start date of the 16-day MODIS composite containing `d` (composites restart on 1 January). */
function composite16(d: Date): Date {
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((d.getTime() - jan1) / DAY_MS);
  return new Date(jan1 + Math.floor(doy / 16) * 16 * DAY_MS);
}

function snap(spec: GibsLayerSpec, d: Date): Date {
  if (spec.cadence === 'p16d') return composite16(d);
  if (spec.cadence === 'monthly') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return d;
}

export interface GibsFrame {
  /** Date requested from GIBS (YYYY-MM-DD) */
  date: string;
  /** 'exact' = inside the period; 'latest' = period is after the newest image; 'nearest' = gap filled */
  match: 'exact' | 'latest' | 'nearest';
  /** Last day the image covers (for 16-day composites) */
  until: string;
}

/**
 * Image for a calendar month (the 15th, i.e. mid-month). null if the instrument had not started yet.
 */
export function gibsFrameFor(spec: GibsLayerSpec, year: number, month: number): GibsFrame | null {
  const target = new Date(Date.UTC(year, month - 1, 15));
  const last = utc(spec.last);
  if (target.getTime() < utc(spec.first).getTime()) return null;

  let match: GibsFrame['match'] = 'exact';
  let d = snap(spec, target);
  if (d.getTime() > last.getTime()) {
    d = snap(spec, last);
    match = 'latest';
  }
  for (const [a, b] of spec.gaps ?? []) {
    if (iso(d) >= a && iso(d) <= b) {
      // Nearest edge of the gap that still has data
      const before = utc(a).getTime() - DAY_MS;
      const after = utc(b).getTime() + DAY_MS;
      d = new Date(Math.abs(d.getTime() - before) <= Math.abs(after - d.getTime()) || after > last.getTime() ? before : after);
      if (match === 'exact') match = 'nearest';
    }
  }
  const until =
    spec.cadence === 'p16d'
      ? iso(new Date(Math.min(d.getTime() + 15 * DAY_MS, Date.UTC(d.getUTCFullYear(), 11, 31))))
      : spec.cadence === 'monthly'
        ? iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
        : iso(d);
  return { date: iso(d), match, until };
}

export function gibsTileUrl(spec: GibsLayerSpec, date: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${spec.layer}/default/${date}/${spec.matrixSet}/{z}/{y}/{x}.png`;
}

/** CSS gradient of the colormap stops, evenly spread like the official GIBS legend. */
export function gibsGradient(spec: GibsLayerSpec): string {
  const [lo, hi] = [spec.stops[0][0], spec.stops[spec.stops.length - 1][0]];
  return `linear-gradient(90deg, ${spec.stops.map(([v, c]) => `${c} ${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ')})`;
}
