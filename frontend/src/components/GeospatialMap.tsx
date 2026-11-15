import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Check,
  CloudRain,
  Droplets,
  Globe,
  Layers,
  Leaf,
  Loader2,
  LocateFixed,
  Satellite,
  Sprout,
  PenTool,
  Thermometer,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  buildDrawnFieldPolygon,
  computePolygonMetrics,
} from '../utils/fieldGeometry';
import {
  GRID_LAT_STEP,
  GRID_LON_STEP,
  HEATMAP_LAYERS,
  MEASURED_END_YEAR,
  regionalBox,
  fetchRegionalGrid,
  gridFrame,
  type GridFrame,
  type HeatmapLayerId,
  type RegionalGrid,
} from '../services/regionalHeatmapService';
import {
  GIBS_LAYERS,
  gibsFrameFor,
  gibsGradient,
  gibsTileUrl,
  type GibsLayerId,
} from '../services/nasaGibsService';
import type { DrawnFieldPolygon } from '../types/terrashift';

interface MapTimelineTelemetry {
  /** Months of the active timeline period; values below are averages over them. */
  months: Array<{ year: number; month: number }>;
  periodLabel: string;
  tempC?: number;
  precip?: number;
  moisture?: number;
}

/** Fly here when `n` changes (sites opened from outside the map, e.g. a saved field). */
export interface MapFocusTarget {
  lat: number;
  lon: number;
  coordinates?: Array<[number, number]>;
  n: number;
}

interface GeospatialMapProps {
  focusTarget?: MapFocusTarget | null;
  lat: number;
  lon: number;
  regionName: string;
  drawnField: DrawnFieldPolygon | null;
  activeTimeline?: MapTimelineTelemetry | null;
  onSelectCoordinates: (lat: number, lon: number) => void;
  onConfirmDrawnField: (field: DrawnFieldPolygon) => void;
  onClearDrawnField: () => void;
}

type BasemapMode = 'dark' | 'satellite';

// Replace with 'YOUR_MAPBOX_TOKEN_HERE' or set VITE_MAPBOX_ACCESS_TOKEN to override
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ||
  'pk.eyJ1IjoiYmVuLWhic3QiLCJhIjoiY213Z2M5ZG11MG9ucDJ4cjJ1eDVoOW5ldiJ9.u7Kx63wzSgrNfs7RVNwGYg';

const SATELLITE_STYLE: mapboxgl.StyleSpecification = {
  version: 8,
  name: 'AgriShift Satellite',
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    'esri-labels': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 16,
    },
  },
  layers: [
    {
      id: 'satellite-base',
      type: 'raster',
      source: 'esri-imagery',
    },
    {
      id: 'satellite-labels',
      type: 'raster',
      source: 'esri-labels',
      paint: {
        'raster-opacity': 0.85,
      },
    },
  ],
};

const MAPBOX_STYLES: Record<BasemapMode, string | mapboxgl.StyleSpecification> = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite: SATELLITE_STYLE,
};

type GeoJsonData = Parameters<mapboxgl.GeoJSONSource['setData']>[0];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildDrawnFieldGeoJson(drawnField: DrawnFieldPolygon | null): GeoJsonData {
  if (!drawnField || drawnField.coordinates.length < 3) {
    return { type: 'FeatureCollection', features: [] };
  }
  const ring = [...drawnField.coordinates, drawnField.coordinates[0]];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        properties: {
          areaLabel: `${drawnField.areaHectares.toFixed(1)} ha`,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    ],
  };
}

function buildDraftFieldGeoJson(
  vertices: Array<[number, number]>,
  cursorCoord: [number, number] | null
): { shapes: GeoJsonData; handles: GeoJsonData } {
  const shapeFeatures: Array<{
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry:
      | { type: 'Polygon'; coordinates: number[][][] }
      | { type: 'LineString'; coordinates: number[][] };
  }> = [];

  const livePts = cursorCoord && vertices.length > 0 ? [...vertices, cursorCoord] : vertices;

  if (livePts.length >= 3) {
    shapeFeatures.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[...livePts, livePts[0]]],
      },
    });
  } else if (livePts.length >= 2) {
    shapeFeatures.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: livePts,
      },
    });
  }

  const handleFeatures = vertices.map((coord, idx) => ({
    type: 'Feature' as const,
    id: idx + 1,
    properties: {
      isFirst: idx === 0,
      canClose: idx === 0 && vertices.length >= 3,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: coord,
    },
  }));

  return {
    shapes: { type: 'FeatureCollection', features: shapeFeatures },
    handles: { type: 'FeatureCollection', features: handleFeatures },
  };
}

function buildSitePointGeoJson(
  lat: number,
  lon: number,
  regionName: string,
  drawnField: DrawnFieldPolygon | null
): GeoJsonData {
  const label = drawnField
    ? `${drawnField.areaHectares.toFixed(1)} ha`
    : regionName;

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        properties: { label },
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
      },
    ],
  };
}

function getFirstBasemapSymbolId(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  const symbolLayer = layers.find(
    (layer) =>
      layer.type === 'symbol' &&
      !layer.id.startsWith('site-') &&
      !layer.id.startsWith('drawn-') &&
      !layer.id.startsWith('draft-')
  );
  return symbolLayer?.id;
}

// ---------------------------------------------------------------------------
// Climate heatmaps (Mapbox heatmap layers over the NASA POWER regional grid).
// Two layers take turns: the next month is loaded into the hidden one, then both
// opacities cross-fade with Mapbox's own paint transitions, entirely on the GPU.
// ---------------------------------------------------------------------------
const HEAT_SOURCE_IDS = ['heat-source-a', 'heat-source-b'] as const;
const HEAT_LAYER_IDS = ['heat-layer-a', 'heat-layer-b'] as const;
/** Lowest value still gets this weight, so cold/dry areas show colour instead of a hole. */
const HEAT_MIN_WEIGHT = 0.14;
/** Kernel radius relative to the grid spacing: large enough to blend cells into a smooth field. */
const HEAT_RADIUS_FACTOR = 1.3;
const HEAT_MAX_ZOOM = 11.5;
const HEAT_OPACITY = 0.72;
/** Close in, the 0.5° cells are drawn as a flat tint (the heatmap kernel would get huge). */
const HEAT_CELL_MIN_ZOOM = HEAT_MAX_ZOOM - 0.6;
const HEAT_CELL_OPACITY = 0.3;
// Mapbox heatmap kernel: weight · intensity · GAUSS_COEF · exp(-4.5 · (d / radius)²)
const GAUSS_COEF = 0.3989422804014327;

const HEAT_ICONS: Record<HeatmapLayerId, typeof Thermometer> = {
  temp: Thermometer,
  precip: CloudRain,
  moisture: Droplets,
};

const SAT_ICONS: Record<GibsLayerId, typeof Thermometer> = {
  ndvi: Leaf,
  lst: Thermometer,
  smap: Sprout,
};
// NASA GIBS rasters: two sources take turns so a new date fades in only once its tiles are there
const SAT_IDS = ['gibs-a', 'gibs-b'] as const;
const SAT_OPACITY = 0.82;
const SAT_FADE_MS = 700;

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Density → colour. The weights are normalised so that density ≈ the cell's position in the range. */
function heatColorExpression(colors: string[]): mapboxgl.ExpressionSpecification {
  const stops: Array<number | string> = [0, hexToRgba(colors[0], 0), HEAT_MIN_WEIGHT * 0.55, hexToRgba(colors[0], 0)];
  colors.forEach((c, i) => {
    stops.push(HEAT_MIN_WEIGHT + ((1 - HEAT_MIN_WEIGHT) * i) / (colors.length - 1), c);
  });
  return ['interpolate', ['linear'], ['heatmap-density'], ...stops] as mapboxgl.ExpressionSpecification;
}

/**
 * Radius grows with the grid's on-screen spacing (×2 per zoom level) and the intensity cancels the
 * summed kernel, so inside the grid the density equals the local (smoothed) weight at every zoom.
 */
function heatKernel(lat: number) {
  const pxPerDeg = 512 / 360;
  const sx = GRID_LON_STEP * pxPerDeg;
  const sy = (GRID_LAT_STEP * pxPerDeg) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const r0 = HEAT_RADIUS_FACTOR * Math.max(sx, sy);
  const kernelSum = (GAUSS_COEF * 2 * Math.PI * r0 * r0) / (9 * sx * sy);
  return {
    radius: ['interpolate', ['exponential', 2], ['zoom'], 0, r0, 12, r0 * 4096] as mapboxgl.ExpressionSpecification,
    intensity: 1 / kernelSum,
  };
}

/** Weight → colour for the close-up cell layer, same ramp as the heatmap. */
function cellColorExpression(colors: string[]): mapboxgl.ExpressionSpecification {
  const stops: Array<number | string> = [];
  colors.forEach((c, i) => {
    stops.push(HEAT_MIN_WEIGHT + ((1 - HEAT_MIN_WEIGHT) * i) / (colors.length - 1), c);
  });
  return ['interpolate', ['linear'], ['get', 'w'], ...stops] as mapboxgl.ExpressionSpecification;
}

function heatWeights(grid: RegionalGrid, frame: GridFrame): Array<{ i: number; w: number }> {
  const [lo, hi] = frame.range;
  return grid.points.flatMap((_, i) => {
    const v = frame.values[i];
    if (!Number.isFinite(v)) return [];
    const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return [{ i, w: HEAT_MIN_WEIGHT + (1 - HEAT_MIN_WEIGHT) * f }];
  });
}

function buildHeatGeoJson(grid: RegionalGrid, frame: GridFrame): GeoJsonData {
  const features = heatWeights(grid, frame).map(({ i, w }) => ({
    type: 'Feature' as const,
    properties: { w },
    geometry: { type: 'Point' as const, coordinates: grid.points[i] },
  }));
  return { type: 'FeatureCollection', features };
}

function buildHeatCellGeoJson(grid: RegionalGrid, frame: GridFrame): GeoJsonData {
  const dLon = GRID_LON_STEP / 2;
  const dLat = GRID_LAT_STEP / 2;
  const features = heatWeights(grid, frame).map(({ i, w }) => {
    const [lon, lat] = grid.points[i];
    return {
      type: 'Feature' as const,
      properties: { w },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat],
          [lon - dLon, lat + dLat], [lon - dLon, lat - dLat],
        ]],
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

const EMPTY_GEOJSON: GeoJsonData = { type: 'FeatureCollection', features: [] };

function dedupeVertices(vertices: Array<[number, number]>): Array<[number, number]> {
  const cleaned: Array<[number, number]> = [];
  for (const pt of vertices) {
    const prev = cleaned[cleaned.length - 1];
    if (
      prev &&
      Math.abs(prev[0] - pt[0]) < 0.000015 &&
      Math.abs(prev[1] - pt[1]) < 0.000015
    ) {
      continue;
    }
    cleaned.push(pt);
  }
  return cleaned;
}

export function GeospatialMap({
  lat,
  lon,
  regionName,
  drawnField,
  activeTimeline,
  onSelectCoordinates,
  onConfirmDrawnField,
  onClearDrawnField,
  focusTarget,
}: GeospatialMapProps) {
  const { lang, t } = useI18n();
  const [basemap, setBasemap] = useState<BasemapMode>('satellite');
  // Clicks pick a site by default; drawing a field is started explicitly
  const [isDrawingField, setIsDrawingField] = useState<boolean>(false);
  const [draftVertices, setDraftVertices] = useState<Array<[number, number]>>([]);
  const [cursorCoord, setCursorCoord] = useState<[number, number] | null>(null);
  const [styleRevision, setStyleRevision] = useState<number>(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [heatLayer, setHeatLayer] = useState<HeatmapLayerId | null>(null);
  const [heatGrid, setHeatGrid] = useState<RegionalGrid | null>(null);
  const [heatStatus, setHeatStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [heatFrame, setHeatFrame] = useState<GridFrame | null>(null);
  const [heatCursorValue, setHeatCursorValue] = useState<number | null>(null);
  const [heatTooClose, setHeatTooClose] = useState<boolean>(false);
  const [satLayer, setSatLayer] = useState<GibsLayerId | null>(null);
  const satRef = useRef({
    front: 0,
    pending: -1,
    key: '',
    fadeTimer: 0 as ReturnType<typeof setTimeout> | 0,
    settleTimer: 0 as ReturnType<typeof setTimeout> | 0,
    settling: false,
    wanted: null as { layerId: GibsLayerId; date: string } | null,
  });

  const heatLayerRef = useRef(heatLayer);
  heatLayerRef.current = heatLayer;
  const heatGridRef = useRef(heatGrid);
  heatGridRef.current = heatGrid;
  const heatFrameRef = useRef(heatFrame);
  heatFrameRef.current = heatFrame;
  const heatRef = useRef({
    front: 0,
    data: [EMPTY_GEOJSON, EMPTY_GEOJSON] as GeoJsonData[],
    color: [heatColorExpression(HEATMAP_LAYERS.temp.colors), heatColorExpression(HEATMAP_LAYERS.temp.colors)],
    visible: false,
    cells: EMPTY_GEOJSON,
    cellColor: cellColorExpression(HEATMAP_LAYERS.temp.colors),
    pending: null as { layer: number; duration: number } | null,
    lastChange: 0,
    fadeTimer: 0 as ReturnType<typeof setTimeout> | 0,
    layerId: '',
    shown: new Map<string, number>(),
    raf: 0,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const prevBasemapRef = useRef<BasemapMode>(basemap);

  const onSelectRef = useRef(onSelectCoordinates);
  const onConfirmFieldRef = useRef(onConfirmDrawnField);
  const isDrawingRef = useRef(isDrawingField);
  const draftVerticesRef = useRef(draftVertices);

  onSelectRef.current = onSelectCoordinates;
  onConfirmFieldRef.current = onConfirmDrawnField;
  isDrawingRef.current = isDrawingField;
  draftVerticesRef.current = draftVertices;

  const stateRef = useRef({
    lat,
    lon,
    regionName,
    drawnField,
    draftVertices,
    cursorCoord,
  });

  stateRef.current = {
    lat,
    lon,
    regionName,
    drawnField,
    draftVertices,
    cursorCoord,
  };

  const finishDrawing = (rawVertices: Array<[number, number]>) => {
    const cleaned = dedupeVertices(rawVertices);
    if (cleaned.length < 3) return;
    const polygon = buildDrawnFieldPolygon(cleaned);
    setIsDrawingField(false);
    setDraftVertices([]);
    setCursorCoord(null);
    onConfirmFieldRef.current(polygon);
  };

  const syncMapboxLayers = (map: mapboxgl.Map) => {
    const {
      lat: curLat,
      lon: curLon,
      regionName: curLabel,
      drawnField: curField,
      draftVertices: curDraft,
      cursorCoord: curCursor,
    } = stateRef.current;

    const beforeSymbolId = getFirstBasemapSymbolId(map);
    const beforeId =
      beforeSymbolId && map.getLayer(beforeSymbolId) ? beforeSymbolId : undefined;

    // 2. Confirmed drawn field polygon highlight
    const drawnData = buildDrawnFieldGeoJson(curField);
    const drawnSource = map.getSource('drawn-field-source') as
      | mapboxgl.GeoJSONSource
      | undefined;
    if (!drawnSource) {
      map.addSource('drawn-field-source', {
        type: 'geojson',
        data: drawnData,
      });
    } else {
      drawnSource.setData(drawnData);
    }

    if (!map.getLayer('drawn-field-fill')) {
      map.addLayer(
        {
          id: 'drawn-field-fill',
          type: 'fill',
          source: 'drawn-field-source',
          paint: {
            'fill-color': '#10b981',
            'fill-opacity': 0.2,
          },
        },
        beforeId
      );
    }

    if (!map.getLayer('drawn-field-outline')) {
      map.addLayer(
        {
          id: 'drawn-field-outline',
          type: 'line',
          source: 'drawn-field-source',
          paint: {
            'line-color': '#34d399',
            'line-width': 2.5,
            'line-opacity': 0.95,
          },
        },
        beforeId
      );
    }

    // 3. Live draft polygon preview while drawing corners
    const draftGeo = buildDraftFieldGeoJson(curDraft, curCursor);
    const draftShapeSrc = map.getSource('draft-field-shape-source') as
      | mapboxgl.GeoJSONSource
      | undefined;
    if (!draftShapeSrc) {
      map.addSource('draft-field-shape-source', {
        type: 'geojson',
        data: draftGeo.shapes,
      });
    } else {
      draftShapeSrc.setData(draftGeo.shapes);
    }

    if (!map.getLayer('draft-field-fill')) {
      map.addLayer({
        id: 'draft-field-fill',
        type: 'fill',
        source: 'draft-field-shape-source',
        paint: {
          'fill-color': '#10b981',
          'fill-opacity': 0.18,
        },
      });
    }

    if (!map.getLayer('draft-field-line')) {
      map.addLayer({
        id: 'draft-field-line',
        type: 'line',
        source: 'draft-field-shape-source',
        paint: {
          'line-color': '#ECEEF0',
          'line-width': 2,
          'line-dasharray': [3, 2],
        },
      });
    }

    const draftHandleSrc = map.getSource('draft-field-handle-source') as
      | mapboxgl.GeoJSONSource
      | undefined;
    if (!draftHandleSrc) {
      map.addSource('draft-field-handle-source', {
        type: 'geojson',
        data: draftGeo.handles,
      });
    } else {
      draftHandleSrc.setData(draftGeo.handles);
    }

    if (!map.getLayer('draft-field-handles')) {
      map.addLayer({
        id: 'draft-field-handles',
        type: 'circle',
        source: 'draft-field-handle-source',
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['get', 'canClose'], false],
            7,
            4.5,
          ],
          'circle-color': [
            'case',
            ['boolean', ['get', 'canClose'], false],
            '#f59e0b',
            '#10b981',
          ],
          'circle-stroke-color': '#ECEEF0',
          'circle-stroke-width': 1.5,
        },
      });
    }

    // 4. Precision Site / Field Centroid Marker + Label
    const pointData = buildSitePointGeoJson(curLat, curLon, curLabel, curField);
    const pointSource = map.getSource('site-point-source') as mapboxgl.GeoJSONSource | undefined;
    if (!pointSource) {
      map.addSource('site-point-source', {
        type: 'geojson',
        data: pointData,
      });
    } else {
      pointSource.setData(pointData);
    }

    if (!map.getLayer('site-point-ring')) {
      map.addLayer({
        id: 'site-point-ring',
        type: 'circle',
        source: 'site-point-source',
        paint: {
          'circle-radius': 8,
          'circle-color': 'rgba(17, 19, 22, 0.25)',
          'circle-stroke-color': '#ECEEF0',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.95,
        },
      });
    }

    if (!map.getLayer('site-point-core')) {
      map.addLayer({
        id: 'site-point-core',
        type: 'circle',
        source: 'site-point-source',
        paint: {
          'circle-radius': 3.5,
          'circle-color': '#10b981',
          'circle-stroke-color': '#111316',
          'circle-stroke-width': 1.5,
        },
      });
    }

    if (!map.getLayer('site-point-label')) {
      map.addLayer({
        id: 'site-point-label',
        type: 'symbol',
        source: 'site-point-source',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-max-width': 18,
        },
        paint: {
          'text-color': '#ECEEF0',
          'text-halo-color': '#111316',
          'text-halo-width': 1.6,
        },
      });
    }
  };

  /** (Re-)creates both heatmap layers, e.g. after a basemap switch wiped the style. */
  const ensureHeatLayers = (map: mapboxgl.Map) => {
    const h = heatRef.current;
    const kernel = heatKernel(stateRef.current.lat);
    const beforeId = map.getLayer('satellite-labels')
      ? 'satellite-labels'
      : getFirstBasemapSymbolId(map);
    HEAT_SOURCE_IDS.forEach((sourceId, i) => {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: h.data[i] });
      }
      if (!map.getLayer(HEAT_LAYER_IDS[i])) {
        map.addLayer(
          {
            id: HEAT_LAYER_IDS[i],
            type: 'heatmap',
            source: sourceId,
            maxzoom: HEAT_MAX_ZOOM,
            paint: {
              'heatmap-weight': ['get', 'w'],
              'heatmap-intensity': kernel.intensity,
              'heatmap-radius': kernel.radius,
              'heatmap-color': h.color[i],
              'heatmap-opacity': h.visible && i === h.front ? HEAT_OPACITY : 0,
              'heatmap-opacity-transition': { duration: 500, delay: 0 },
            },
          },
          beforeId && map.getLayer(beforeId) ? beforeId : undefined
        );
      } else {
        map.setPaintProperty(HEAT_LAYER_IDS[i], 'heatmap-intensity', kernel.intensity);
        map.setPaintProperty(HEAT_LAYER_IDS[i], 'heatmap-radius', kernel.radius);
      }
    });
    if (!map.getSource('heat-cells-source')) {
      map.addSource('heat-cells-source', { type: 'geojson', data: h.cells });
    }
    if (!map.getLayer('heat-cells')) {
      map.addLayer(
        {
          id: 'heat-cells',
          type: 'fill',
          source: 'heat-cells-source',
          minzoom: HEAT_CELL_MIN_ZOOM,
          layout: { visibility: h.visible ? 'visible' : 'none' },
          paint: {
            'fill-color': h.cellColor,
            'fill-antialias': false,
            'fill-opacity': [
              'interpolate', ['linear'], ['zoom'], HEAT_CELL_MIN_ZOOM, 0, HEAT_MAX_ZOOM, HEAT_CELL_OPACITY,
            ],
          },
        },
        beforeId && map.getLayer(beforeId) ? beforeId : undefined
      );
    }
  };

  const runHeatFade = (map: mapboxgl.Map) => {
    const h = heatRef.current;
    const pending = h.pending;
    if (!pending) return;
    h.pending = null;
    clearTimeout(h.fadeTimer);
    h.fadeTimer = 0;
    HEAT_LAYER_IDS.forEach((layerId, i) => {
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, 'heatmap-opacity-transition', { duration: pending.duration, delay: 0 });
      map.setPaintProperty(layerId, 'heatmap-opacity', h.visible && i === pending.layer ? HEAT_OPACITY : 0);
    });
    h.front = pending.layer;
  };

  const heatWeightMap = (data: GeoJsonData) =>
    new Map(
      (data as { features: Array<{ geometry: { coordinates: number[] }; properties: { w: number } }> }).features.map(
        (f) => [f.geometry.coordinates.join(','), f.properties.w] as [string, number]
      )
    );

  /** Glides every grid point's weight from what is shown now to the new frame (no cut, no dip). */
  const tweenHeatFrame = (map: mapboxgl.Map, data: GeoJsonData) => {
    const h = heatRef.current;
    const now = performance.now();
    const duration = clamp(now - h.lastChange, 400, 1200);
    h.lastChange = now;
    const cells = h.cells;
    const target = heatWeightMap(data);
    h.data[h.front] = data;
    const from = new Map(h.shown);
    const features = (data as { features: Array<{ type: 'Feature'; geometry: unknown; properties: { w: number } }> }).features;
    cancelAnimationFrame(h.raf);
    const step = (t: number) => {
      const k = clamp((t - now) / duration, 0, 1);
      const e = k * k * (3 - 2 * k); // smoothstep
      const shown = new Map<string, number>();
      const frame = features.map((f) => {
        const key = (f.geometry as { coordinates: number[] }).coordinates.join(',');
        const b = target.get(key) ?? 0;
        const w = (from.get(key) ?? b) + (b - (from.get(key) ?? b)) * e;
        shown.set(key, w);
        return { ...f, properties: { w } };
      });
      h.shown = shown;
      // Zoomed in, the heatmap gives way to the coloured grid cells: glide those with the same weights
      const cellFeatures = (cells as { features: Array<{ properties: { w: number } }> }).features;
      (map.getSource('heat-cells-source') as mapboxgl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: cellFeatures.map((c, j) => ({ ...c, properties: { w: frame[j]?.properties.w ?? c.properties.w } })),
      } as GeoJsonData);
      (map.getSource(HEAT_SOURCE_IDS[h.front]) as mapboxgl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: frame,
      } as GeoJsonData);
      if (k < 1) h.raf = requestAnimationFrame(step);
    };
    h.raf = requestAnimationFrame(step);
  };

  /** Loads a frame into the hidden layer, then cross-fades to it once its tiles are ready. */
  const pushHeatFrame = (
    map: mapboxgl.Map,
    data: GeoJsonData,
    color: mapboxgl.ExpressionSpecification,
    layerId: string
  ) => {
    const h = heatRef.current;
    const sameLayer = h.visible && !h.pending && h.layerId === layerId && h.shown.size > 0;
    h.layerId = layerId;
    if (sameLayer) {
      tweenHeatFrame(map, data);
      return;
    }
    cancelAnimationFrame(h.raf);
    h.shown = heatWeightMap(data);
    const back = 1 - h.front;
    const now = performance.now();
    // Fast timeline playback gets short fades; single slider steps get a slow, smooth blend
    const duration = Math.round(clamp((now - h.lastChange) * 0.9, 170, 650));
    h.lastChange = now;
    h.data[back] = data;
    h.color[back] = color;
    h.visible = true;
    (map.getSource('heat-cells-source') as mapboxgl.GeoJSONSource | undefined)?.setData(h.cells);
    if (map.getLayer('heat-cells')) {
      map.setPaintProperty('heat-cells', 'fill-color', h.cellColor);
      map.setLayoutProperty('heat-cells', 'visibility', 'visible');
    }
    const source = map.getSource(HEAT_SOURCE_IDS[back]) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(data);
    map.setPaintProperty(HEAT_LAYER_IDS[back], 'heatmap-color', color);
    h.pending = { layer: back, duration };
    // Throttle, not debounce: a debounce never fires while the timeline plays, so the map froze until the end
    if (!h.fadeTimer) h.fadeTimer = setTimeout(() => runHeatFade(map), 160);
  };

  const hideHeat = (map: mapboxgl.Map) => {
    const h = heatRef.current;
    h.visible = false;
    h.pending = null;
    cancelAnimationFrame(h.raf);
    h.shown = new Map();
    clearTimeout(h.fadeTimer);
    h.fadeTimer = 0;
    if (map.getLayer('heat-cells')) map.setLayoutProperty('heat-cells', 'visibility', 'none');
    HEAT_LAYER_IDS.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, 'heatmap-opacity-transition', { duration: 450, delay: 0 });
      map.setPaintProperty(layerId, 'heatmap-opacity', 0);
    });
  };

  const fadeSat = (map: mapboxgl.Map) => {
    const sat = satRef.current;
    if (sat.pending < 0) return;
    clearTimeout(sat.fadeTimer);
    const next = sat.pending;
    sat.pending = -1;
    // The new frame fades in on top of the old one, which stays fully visible until it is covered:
    // fading both at once would dip to a see-through mix of the two halfway
    const prev = sat.front;
    if (map.getLayer(SAT_IDS[next])) map.setPaintProperty(SAT_IDS[next], 'raster-opacity', SAT_OPACITY);
    sat.front = next;
    // Let the cross-fade finish before the faded-out layer is reused, then go to the newest wanted frame
    sat.settling = true;
    clearTimeout(sat.settleTimer);
    sat.settleTimer = setTimeout(() => {
      sat.settling = false;
      if (map.getLayer(SAT_IDS[prev]) && prev !== sat.front) {
        map.setPaintProperty(SAT_IDS[prev], 'raster-opacity-transition', { duration: 0, delay: 0 });
        map.setPaintProperty(SAT_IDS[prev], 'raster-opacity', 0);
      }
      const w = sat.wanted;
      sat.wanted = null;
      if (w) pushSatFrame(map, w.layerId, w.date);
    }, SAT_FADE_MS + 50);
  };

  /** Loads a GIBS date into the hidden raster, then cross-fades to it. */
  const pushSatFrame = (map: mapboxgl.Map, layerId: GibsLayerId, date: string) => {
    const sat = satRef.current;
    const key = `${layerId}/${date}`;
    const spec = GIBS_LAYERS[layerId];
    if (sat.key === key && map.getLayer(SAT_IDS[sat.front])) {
      sat.wanted = null;
      return;
    }
    // While a frame loads or fades, only remember the newest one: replacing a loading frame during
    // playback would never let any frame finish loading, so the layer froze or vanished
    if ((sat.pending >= 0 || sat.settling) && sat.key.startsWith(`${layerId}/`)) {
      sat.wanted = { layerId, date };
      return;
    }
    sat.wanted = null;
    sat.key = key;
    const back = 1 - sat.front;
    const id = SAT_IDS[back];
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
    map.addSource(id, {
      type: 'raster',
      tiles: [gibsTileUrl(spec, date)],
      tileSize: 256,
      maxzoom: spec.maxzoom,
      attribution: 'NASA GIBS / EOSDIS',
    });
    map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        paint: {
          'raster-opacity': 0,
          'raster-opacity-transition': { duration: SAT_FADE_MS, delay: 0 },
          'raster-resampling': spec.resampling,
          'raster-fade-duration': 0,
        },
      },
      getFirstBasemapSymbolId(map)
    );
    sat.pending = back;
    clearTimeout(sat.fadeTimer);
    sat.fadeTimer = setTimeout(() => fadeSat(map), 1500); // missing tiles never report "loaded"
  };

  const hideSat = (map: mapboxgl.Map) => {
    const sat = satRef.current;
    clearTimeout(sat.fadeTimer);
    clearTimeout(sat.settleTimer);
    sat.pending = -1;
    sat.settling = false;
    sat.wanted = null;
    sat.key = '';
    SAT_IDS.forEach((id) => {
      if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', 0);
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!mapboxgl.supported()) {
      setMapError('WebGL is not supported in this browser.');
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    let map: mapboxgl.Map;

    try {
      map = new mapboxgl.Map({
        container,
        style: MAPBOX_STYLES[prevBasemapRef.current],
        center: [stateRef.current.lon, stateRef.current.lat],
        zoom: 13.2,
        minZoom: 3,
        maxZoom: 18,
        attributionControl: false,
        logoPosition: 'bottom-right', // bottom-left holds the site legend; the logo must stay visible
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : 'WebGL initialization failed.');
      return;
    }

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.getCanvas().style.cursor = 'crosshair';
    if (isDrawingRef.current) {
      map.doubleClickZoom.disable();
    }

    map.on('style.load', () => {
      setMapError(null);
      satRef.current.key = ''; // a new style dropped the rasters
      syncMapboxLayers(map);
      ensureHeatLayers(map);
      setStyleRevision((r) => r + 1);
    });

    map.on('load', () => {
      setMapError(null);
    });

    map.on('sourcedata', (event) => {
      const satPending = satRef.current.pending;
      if (satPending >= 0 && event.sourceId === SAT_IDS[satPending] && map.isSourceLoaded(event.sourceId)) {
        fadeSat(map);
      }
      const pending = heatRef.current.pending;
      if (pending && event.sourceId === HEAT_SOURCE_IDS[pending.layer] && map.isSourceLoaded(event.sourceId)) {
        runHeatFade(map);
      }
    });

    map.on('zoom', () => {
      setHeatTooClose(map.getZoom() >= HEAT_MAX_ZOOM);
    });

    map.on('mousemove', (event) => {
      if (isDrawingRef.current) {
        setCursorCoord([event.lngLat.lng, event.lngLat.lat]);
      }
      const grid = heatGridRef.current;
      const frame = heatFrameRef.current;
      if (heatLayerRef.current && grid && frame) {
        const { lng, lat: cLat } = event.lngLat;
        let best = -1;
        let bestDist = 1; // within one grid cell
        grid.points.forEach(([pLon, pLat], i) => {
          const d = ((pLat - cLat) / GRID_LAT_STEP) ** 2 + ((pLon - lng) / GRID_LON_STEP) ** 2;
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        setHeatCursorValue(best >= 0 && Number.isFinite(frame.values[best]) ? frame.values[best] : null);
      }
    });

    map.on('mouseout', () => setHeatCursorValue(null));

    map.on('click', (event) => {
      if (isDrawingRef.current) {
        const current = draftVerticesRef.current;
        if (current.length >= 3) {
          const firstScreen = map.project(current[0]);
          const clickDist = Math.hypot(
            event.point.x - firstScreen.x,
            event.point.y - firstScreen.y
          );
          if (clickDist <= 14) {
            finishDrawing(current);
            return;
          }
        }
        setDraftVertices((prev) => [...prev, [event.lngLat.lng, event.lngLat.lat]]);
        return;
      }

      onSelectRef.current(event.lngLat.lat, event.lngLat.lng);
    });

    map.on('dblclick', (event) => {
      if (!isDrawingRef.current) return;
      event.preventDefault();
      const current = draftVerticesRef.current;
      if (current.length >= 3) {
        finishDrawing(current);
      }
    });

    map.on('error', (e) => {
      const errEvent = e as { sourceId?: string; error?: { status?: number; message?: string } };
      if (errEvent.sourceId) return;
      const status = errEvent.error?.status;
      if (status === 401 || status === 403) {
        setMapError('Mapbox access token rejected (401/403).');
      } else {
        console.warn('Mapbox notice:', errEvent.error?.message || e);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isDrawingField) {
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = 'crosshair';
    } else {
      map.doubleClickZoom.enable();
      setCursorCoord(null);
    }
  }, [isDrawingField]);

  useEffect(() => {
    if (prevBasemapRef.current === basemap) return;
    prevBasemapRef.current = basemap;
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(MAPBOX_STYLES[basemap]);
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRevision === 0) return;

    // No camera moves here: sites are picked on the map itself, so the view stays where the user put it
    syncMapboxLayers(map);
  }, [lat, lon, regionName, drawnField, styleRevision]);

  const focusDoneRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRevision === 0 || !focusTarget || focusTarget.n === focusDoneRef.current) return;
    focusDoneRef.current = focusTarget.n;
    const pts = focusTarget.coordinates;
    if (pts && pts.length >= 3) {
      setIsDrawingField(false);
      setDraftVertices([]);
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      map.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 80, maxZoom: 16.5, duration: 900, essential: true }
      );
    } else {
      map.flyTo({ center: [focusTarget.lon, focusTarget.lat], zoom: Math.max(map.getZoom(), 13), duration: 900, essential: true });
    }
  }, [focusTarget, styleRevision]);

  // Climate layer on/off. The camera stays put; the cell tint covers close zoom levels.
  const prevHeatActiveRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    const active = heatLayer !== null;
    if (!map || active === prevHeatActiveRef.current) return;
    prevHeatActiveRef.current = active;
    if (active) {
      setSatLayer(null);
      if (isDrawingRef.current && draftVerticesRef.current.length === 0) {
        setIsDrawingField(false); // clicks select sites while a climate layer is shown
      }
    } else {
      hideHeat(map);
      setHeatCursorValue(null);
    }
  }, [heatLayer]);

  // Regional grid for the selected layer (cached per layer and 1° box)
  useEffect(() => {
    if (!heatLayer) {
      setHeatGrid(null);
      setHeatStatus('idle');
      return;
    }
    let cancelled = false;
    setHeatStatus('loading');
    fetchRegionalGrid(heatLayer, lat, lon)
      .then((grid) => {
        if (cancelled) return;
        setHeatGrid(grid);
        setHeatStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Regional climate grid unavailable:', err);
        setHeatStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [heatLayer, lat, lon]);

  // Frame for the timeline's period (month, season or year)
  const heatMonths = activeTimeline?.months ?? [{ year: MEASURED_END_YEAR, month: 7 }];
  const heatPeriodKey = heatMonths.map((m) => m.year * 12 + m.month).join(',');
  const heatSiteValue =
    heatLayer === 'temp'
      ? activeTimeline?.tempC
      : heatLayer === 'precip'
        ? activeTimeline?.precip
        : heatLayer === 'moisture'
          ? activeTimeline?.moisture
          : undefined;

  useEffect(() => {
    if (!heatGrid || heatGrid.layer.id !== heatLayer) {
      setHeatFrame(null);
      return;
    }
    setHeatFrame(gridFrame(heatGrid, heatMonths, { lat, lon, value: heatSiteValue }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- heatPeriodKey stands for heatMonths
  }, [heatGrid, heatLayer, heatPeriodKey, heatSiteValue, lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRevision === 0 || !heatGrid || !heatFrame || !heatLayer) return;
    ensureHeatLayers(map);
    heatRef.current.cells = buildHeatCellGeoJson(heatGrid, heatFrame);
    heatRef.current.cellColor = cellColorExpression(heatGrid.layer.colors);
    pushHeatFrame(map, buildHeatGeoJson(heatGrid, heatFrame), heatColorExpression(heatGrid.layer.colors), heatGrid.layer.id);
  }, [heatFrame, styleRevision]);

  // NASA GIBS image for the middle month of the timeline period (July for a whole year)
  const satMonth = heatMonths[Math.floor(heatMonths.length / 2)];
  const satFrame = satLayer ? gibsFrameFor(GIBS_LAYERS[satLayer], satMonth.year, satMonth.month) : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRevision === 0) return;
    if (!satLayer || !satFrame) hideSat(map);
    else pushSatFrame(map, satLayer, satFrame.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the frame's date is what changes the image
  }, [satLayer, satFrame?.date, styleRevision]);

  const toggleSatLayer = (id: GibsLayerId) => {
    setSatLayer((cur) => (cur === id ? null : id));
    setHeatLayer(null);
    if (isDrawingRef.current && draftVerticesRef.current.length === 0) setIsDrawingField(false);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRevision === 0) return;
    const draftGeo = buildDraftFieldGeoJson(draftVertices, cursorCoord);
    const shapeSrc = map.getSource('draft-field-shape-source') as
      | mapboxgl.GeoJSONSource
      | undefined;
    const handleSrc = map.getSource('draft-field-handle-source') as
      | mapboxgl.GeoJSONSource
      | undefined;
    shapeSrc?.setData(draftGeo.shapes);
    handleSrc?.setData(draftGeo.handles);
  }, [draftVertices, cursorCoord, styleRevision]);

  const draftPreviewMetrics =
    isDrawingField && draftVertices.length >= 3
      ? computePolygonMetrics(draftVertices)
      : null;

  return (
    <div className="flex flex-col bg-panel h-full min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 sm:px-5 py-2.5">
        <h2 className="text-sm font-semibold text-ink">{t.map.title}</h2>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-px bg-line border border-line">
            <button
              type="button"
              onClick={() => setBasemap('dark')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                basemap === 'dark'
                  ? 'bg-raised text-ink font-medium'
                  : 'bg-ground text-ink-2 hover:text-ink'
              }`}
            >
              <Globe className="h-3 w-3" aria-hidden="true" />
              <span>{t.map.darkMap}</span>
            </button>
            <button
              type="button"
              onClick={() => setBasemap('satellite')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                basemap === 'satellite'
                  ? 'bg-raised text-ink font-medium'
                  : 'bg-ground text-ink-2 hover:text-ink'
              }`}
            >
              <Layers className="h-3 w-3" aria-hidden="true" />
              <span>{t.map.satellite}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (isDrawingField) {
                setIsDrawingField(false);
                setDraftVertices([]);
                setCursorCoord(null);
              } else {
                setDraftVertices([]);
                setCursorCoord(null);
                setIsDrawingField(true);
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
              isDrawingField
                ? 'border-crop/55 bg-crop/15 text-crop font-medium'
                : 'border-line bg-ground text-ink hover:border-crop/50 hover:text-crop'
            }`}
          >
            <PenTool className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{drawnField && !isDrawingField ? t.map.newFieldBtn : t.map.drawFieldBtn}</span>
          </button>

          {drawnField && !isDrawingField && (
            <button
              type="button"
              onClick={() => {
                onClearDrawnField();
                setDraftVertices([]);
                setCursorCoord(null);
                setIsDrawingField(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ground px-2.5 py-1 text-xs text-ink-2 hover:border-warn/40 hover:text-warn transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.map.clearField}</span>
            </button>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-[380px] lg:min-h-0 w-full overflow-hidden isolate z-0 bg-ground">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-warn bg-ground/90">
            {mapError}
          </div>
        )}

        {!mapError && (
          <button
            type="button"
            onClick={() => mapRef.current?.easeTo({ center: [lon, lat], duration: 700, essential: true })}
            title={t.map.recenter}
            aria-label={t.map.recenter}
            className="absolute left-[10px] top-[78px] z-10 flex h-[29px] w-[29px] items-center justify-center rounded-md border border-line bg-panel text-ink shadow-[0_1px_2px_rgba(28,38,31,0.12)] hover:bg-raised cursor-pointer"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {/* Top-Right Climate Layer Toggles + Legend */}
        <div className="pointer-events-none absolute top-3 right-3 z-10 flex w-[min(17.5rem,calc(100%-4.5rem))] flex-col items-end gap-2">
          <div className="pointer-events-auto w-full rounded-lg border border-line bg-panel/90 backdrop-blur-md p-1.5 shadow-[0_8px_24px_rgba(28,38,31,0.18)]">
            <div className="flex items-baseline justify-between px-1 pb-1">
              <span className="text-[11px] font-semibold text-ink">{t.map.heatTitle}</span>
              <span className="text-[10px] text-ink-3">NASA POWER</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(Object.keys(HEATMAP_LAYERS) as HeatmapLayerId[]).map((id) => {
                const Icon = HEAT_ICONS[id];
                const active = heatLayer === id;
                const colors = HEATMAP_LAYERS[id].colors;
                const label = id === 'temp' ? t.map.heatTemp : id === 'precip' ? t.map.heatPrecip : t.map.heatMoisture;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setHeatLayer((cur) => (cur === id ? null : id))}
                    className={`group relative flex flex-col items-center gap-1 overflow-hidden rounded-md border px-1 pt-1.5 pb-2 text-[10px] transition-all duration-300 ease-out cursor-pointer ${
                      active
                        ? 'border-line-strong bg-raised text-ink'
                        : 'border-transparent bg-transparent text-ink-2 hover:bg-panel hover:text-ink'
                    }`}
                  >
                    {active && heatStatus === 'loading' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" style={active ? { color: colors[colors.length - 2] } : undefined} />
                    )}
                    <span className="leading-none whitespace-nowrap">{label}</span>
                    <span
                      className={`absolute inset-x-1 bottom-0.5 h-[3px] rounded-full transition-all duration-300 ease-out ${
                        active ? 'opacity-100' : 'opacity-25 group-hover:opacity-60'
                      }`}
                      style={{ background: `linear-gradient(90deg, ${colors.join(', ')})` }}
                    />
                  </button>
                );
              })}
            </div>

            <div className="mt-1.5 flex items-baseline justify-between border-t border-line px-1 pb-1 pt-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink">
                <Satellite className="h-3 w-3" aria-hidden="true" />
                {t.map.satTitle}
              </span>
              <span className="text-[10px] text-ink-3">NASA GIBS</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(Object.keys(GIBS_LAYERS) as GibsLayerId[]).map((id) => {
                const Icon = SAT_ICONS[id];
                const active = satLayer === id;
                const spec = GIBS_LAYERS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleSatLayer(id)}
                    className={`group relative flex flex-col items-center gap-1 overflow-hidden rounded-md border px-1 pt-1.5 pb-2 text-[10px] transition-all duration-300 ease-out cursor-pointer ${
                      active
                        ? 'border-line-strong bg-raised text-ink'
                        : 'border-transparent bg-transparent text-ink-2 hover:bg-panel hover:text-ink'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="leading-none whitespace-nowrap">{t.map.sat[id]}</span>
                    <span
                      className={`absolute inset-x-1 bottom-0.5 h-[3px] rounded-full transition-all duration-300 ease-out ${
                        active ? 'opacity-100' : 'opacity-25 group-hover:opacity-60'
                      }`}
                      style={{ background: gibsGradient(spec) }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {satLayer && (() => {
            const spec = GIBS_LAYERS[satLayer];
            const fmtDay = (d: string) =>
              new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
            const fmtMonth = (d: string) =>
              new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
            const when = !satFrame
              ? null
              : spec.cadence === 'monthly'
                ? fmtMonth(satFrame.date)
                : spec.cadence === 'p16d'
                  ? `${fmtDay(satFrame.date)} – ${fmtDay(satFrame.until)}`
                  : fmtDay(satFrame.date);
            const lo = spec.stops[0][0];
            const hi = spec.stops[spec.stops.length - 1][0];
            return (
              <div key={satLayer} className="pointer-events-auto w-full rounded-lg border border-line bg-panel/90 backdrop-blur-md px-3 py-2.5 shadow-[0_8px_24px_rgba(28,38,31,0.18)] heat-legend-enter">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{t.map.satLong[satLayer]}</span>
                  <span className="text-[10px] text-ink-3 whitespace-nowrap">{spec.resolution}</span>
                </div>
                {when ? (
                  <>
                    <div key={satFrame?.date} className="mt-0.5 text-[11px] tabular-nums text-crop heat-month-tick">{when}</div>
                    <div className="mt-2 h-2.5 w-full rounded-[2px] ring-1 ring-black/10" style={{ background: gibsGradient(spec) }} />
                    <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-3">
                      <span>{lo} {spec.unit}</span>
                      <span>{hi} {spec.unit}</span>
                    </div>
                    {satFrame?.match === 'latest' && <p className="mt-1.5 text-[10px] leading-snug text-warn">{t.map.satLatest}</p>}
                    {satFrame?.match === 'nearest' && <p className="mt-1.5 text-[10px] leading-snug text-ink-3">{t.map.satNearest}</p>}
                  </>
                ) : (
                  <p className="mt-1.5 text-[11px] leading-snug text-warn">
                    {t.map.satBefore.replace('{date}', fmtMonth(spec.first))}
                  </p>
                )}
                <p className="mt-1.5 border-t border-line pt-1.5 text-[10px] leading-snug text-ink-3">
                  {spec.product} · NASA GIBS / EOSDIS
                </p>
              </div>
            );
          })()}

          {heatLayer && (() => {
            const spec = HEATMAP_LAYERS[heatLayer];
            const range = heatGrid?.layer.id === heatLayer && heatFrame ? heatFrame.range : null;
            const fmt = (v: number) => `${v.toFixed(spec.decimals)}${spec.unit === 'GWET' ? '' : ` ${spec.unit}`}`;
            const pos = (v: number | null | undefined) =>
              range && v !== null && v !== undefined && Number.isFinite(v)
                ? `${Math.max(0, Math.min(1, (v - range[0]) / (range[1] - range[0]))) * 100}%`
                : null;
            const sitePos = pos(heatSiteValue);
            const cursorPos = pos(heatCursorValue);
            const kindLabel =
              heatFrame?.kind === 'forecast' ? t.map.heatForecast : heatFrame?.kind === 'normal' ? t.map.heatNormal : t.map.heatMeasured;
            return (
              <div className="pointer-events-auto w-full border border-line bg-ground/85 backdrop-blur-md px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.35)] heat-legend-enter">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">
                    {heatLayer === 'temp' ? t.map.heatTemp : heatLayer === 'precip' ? t.map.heatPrecip : t.map.heatMoisture}
                  </span>
                  <span key={heatPeriodKey} className="font-mono text-[11px] tabular-nums text-crop heat-month-tick whitespace-nowrap">
                    {activeTimeline ? `${heatMonths.length > 1 ? 'Ø ' : ''}${activeTimeline.periodLabel}` : ''}
                  </span>
                </div>

                {heatStatus === 'error' ? (
                  <p className="mt-2 text-[11px] text-warn">{t.map.heatError}</p>
                ) : !range ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-2">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    {t.map.heatLoading}
                  </p>
                ) : (
                  <>
                    <div className="relative mt-2.5 mb-1">
                      <div
                        className="h-2.5 w-full rounded-md ring-1 ring-white/10"
                        style={{ background: `linear-gradient(90deg, ${spec.colors.join(', ')})` }}
                      />
                      {sitePos && (
                        <div
                          className="absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_#111316,0_0_10px_rgba(255,255,255,0.6)] transition-[left] duration-500 ease-out"
                          style={{ left: sitePos }}
                          title={t.map.heatSite}
                        />
                      )}
                      {cursorPos && (
                        <div
                          className="absolute -top-0.5 h-[14px] w-[2px] -translate-x-1/2 rounded-full bg-crop/90 transition-[left] duration-150 ease-out"
                          style={{ left: cursorPos }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between font-mono text-[10px] tabular-nums text-ink-3">
                      <span>{fmt(range[0])}</span>
                      <span>{fmt(range[1])}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums">
                      {heatSiteValue !== undefined && Number.isFinite(heatSiteValue) && (
                        <span className="text-ink">
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-white align-middle" />
                          {t.map.heatSite} {fmt(heatSiteValue)}
                        </span>
                      )}
                      {heatCursorValue !== null && (
                        <span className="text-crop">
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-crop align-middle" />
                          {t.map.heatCursor} {fmt(heatCursorValue)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 border-t border-line pt-1.5 text-[10px] leading-snug text-ink-3">
                      {kindLabel}
                    </p>
                  </>
                )}
              </div>
            );
          })()}

          {heatLayer && heatTooClose && (
            <button
              type="button"
              onClick={() => {
                const box = regionalBox(lat, lon);
                mapRef.current?.fitBounds([[box.lonMin, box.latMin], [box.lonMax, box.latMax]], { duration: 1200, essential: true });
              }}
              className="pointer-events-auto border border-line bg-ground/85 backdrop-blur-md px-2.5 py-1 text-[10px] text-ink-2 hover:text-ink transition-colors cursor-pointer"
            >
              {t.map.heatZoomHint}
            </button>
          )}
        </div>

        {/* Drawing toolbar floats over the map so the map keeps its height */}
        {isDrawingField && (
          <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs shadow-[0_8px_24px_rgba(28,38,31,0.18)] backdrop-blur-md heat-legend-enter">
            <div className="flex items-center gap-2 text-ink-2">
              <span className="h-2 w-2 rounded-full bg-crop shrink-0" />
              <span>{t.map.drawingHint}</span>
              {draftPreviewMetrics && (
                <span className="font-mono text-crop tabular-nums">
                  · {draftPreviewMetrics.areaHectares.toFixed(2)} ha
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setDraftVertices((prev) => prev.slice(0, -1))}
                disabled={draftVertices.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-ink hover:border-line-strong disabled:opacity-40 transition-colors duration-200 ease-out cursor-pointer"
              >
                <Undo2 className="h-3 w-3" aria-hidden="true" />
                <span>{t.map.drawUndo}</span>
              </button>

              <button
                type="button"
                onClick={() => finishDrawing(draftVertices)}
                disabled={draftVertices.length < 3}
                className="inline-flex items-center gap-1 rounded-md bg-crop px-2.5 py-1 text-xs font-medium text-ground hover:bg-crop/90 disabled:opacity-40 transition-colors duration-200 ease-out cursor-pointer"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                <span>
                  {t.map.drawFinish}
                  {draftPreviewMetrics
                    ? ` (${draftPreviewMetrics.areaHectares.toFixed(1)} ha)`
                    : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsDrawingField(false);
                  setDraftVertices([]);
                  setCursorCoord(null);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-ink-2 hover:text-ink transition-colors duration-200 ease-out cursor-pointer"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                <span>{t.map.drawCancel}</span>
              </button>
            </div>
          </div>
        )}

        {/* Bottom-Left Site / Field Coordinates & Scale Legend */}
        {!isDrawingField && (
        <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[calc(100%-5rem)] sm:max-w-[78%] rounded-md border border-line bg-panel/95 px-2.5 py-1.5 space-y-1 shadow-[0_1px_3px_rgba(28,38,31,0.12)]">
          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums tracking-tight text-ink">
            {drawnField ? (
              <>
                <span className="text-crop shrink-0">{t.map.fieldLabel}:</span>
                <span className="shrink-0">{drawnField.areaHectares.toFixed(2)} ha</span>
                <span aria-hidden="true" className="text-ink-3 shrink-0">
                  ·
                </span>
                <span className="text-ink-2 shrink-0">
                  Ø {drawnField.samplePointsCount} {t.map.samplesSuffix}
                </span>
                <span aria-hidden="true" className="text-ink-3 shrink-0 hidden sm:inline">
                  ·
                </span>
                <span className="text-ink-3 hidden sm:inline truncate">
                  {lat.toFixed(4)}, {lon.toFixed(4)}
                </span>
              </>
            ) : (
              <>
                <span className="text-crop shrink-0">{t.map.pinLabel}:</span>
                <span className="shrink-0">
                  {lat.toFixed(4)}, {lon.toFixed(4)}
                </span>
                <span aria-hidden="true" className="text-ink-3 shrink-0">
                  ·
                </span>
                <span className="text-ink-2 truncate">{regionName}</span>
              </>
            )}
          </div>

          {!drawnField && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-ink-3">
              <span className="inline-block h-2 w-2 border border-crop bg-crop/20 shrink-0" />
              <span>{t.map.gridLegend}</span>
            </div>
          )}

          {activeTimeline && activeTimeline.tempC !== undefined && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t border-line pt-1 font-mono text-[10px] tabular-nums text-ink-2">
              <span className="text-crop font-semibold">
                {activeTimeline.months.length > 1 ? 'Ø ' : ''}
                {activeTimeline.periodLabel}
              </span>
              <span>{activeTimeline.tempC.toFixed(1)} °C</span>
              {activeTimeline.precip !== undefined && (
                <span>{activeTimeline.precip.toFixed(2)} mm/d</span>
              )}
              {activeTimeline.moisture !== undefined && (
                <span>GWET {activeTimeline.moisture.toFixed(3)}</span>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
