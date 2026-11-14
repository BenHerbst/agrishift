import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Check,
  CloudRain,
  Droplets,
  Globe,
  Layers,
  Loader2,
  LocateFixed,
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
import type { DrawnFieldPolygon } from '../types/terrashift';

interface MapTimelineTelemetry {
  /** Months of the active timeline period; values below are averages over them. */
  months: Array<{ year: number; month: number }>;
  periodLabel: string;
  tempC?: number;
  precip?: number;
  moisture?: number;
}

interface GeospatialMapProps {
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
  name: 'Terra Tuta Satellite',
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

function metersToLatDeg(meters: number): number {
  return meters / 111320;
}

function metersToLonDeg(meters: number, lat: number): number {
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  return meters / (111320 * cosLat);
}

/**
 * Subtle 5x5 reference parcel grid (250m x 250m = 6.25 ha per cell)
 * to help gauge field scale while drawing.
 */
function buildReferenceGridGeoJson(lat: number, lon: number): GeoJsonData {
  const cellLat = metersToLatDeg(250);
  const cellLon = metersToLonDeg(250, lat);
  const features: Array<{
    type: 'Feature';
    id: number;
    properties: { isActive: boolean };
    geometry: { type: 'Polygon'; coordinates: number[][][] };
  }> = [];

  let id = 1;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const cLat = lat + r * cellLat;
      const cLon = lon + c * cellLon;
      const minLat = clamp(cLat - cellLat / 2, -85, 85);
      const maxLat = clamp(cLat + cellLat / 2, -85, 85);
      const minLon = cLon - cellLon / 2;
      const maxLon = cLon + cellLon / 2;

      features.push({
        type: 'Feature',
        id: id++,
        properties: { isActive: r === 0 && c === 0 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minLon, minLat],
              [maxLon, minLat],
              [maxLon, maxLat],
              [minLon, maxLat],
              [minLon, minLat],
            ],
          ],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
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
const HEAT_CELL_OPACITY = 0.38;
// Mapbox heatmap kernel: weight · intensity · GAUSS_COEF · exp(-4.5 · (d / radius)²)
const GAUSS_COEF = 0.3989422804014327;

const HEAT_ICONS: Record<HeatmapLayerId, typeof Thermometer> = {
  temp: Thermometer,
  precip: CloudRain,
  moisture: Droplets,
};

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
}: GeospatialMapProps) {
  const { t } = useI18n();
  const [basemap, setBasemap] = useState<BasemapMode>('satellite');
  // Field polygon drawing is enabled as the default interaction mode
  const [isDrawingField, setIsDrawingField] = useState<boolean>(true);
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

    // 1. Subtle 250m x 250m scale reference grid when no field polygon is active
    const showGrid = !curField;
    const gridData = buildReferenceGridGeoJson(curLat, curLon);
    const gridSource = map.getSource('site-neighborhood-source') as
      | mapboxgl.GeoJSONSource
      | undefined;
    if (!gridSource) {
      map.addSource('site-neighborhood-source', {
        type: 'geojson',
        data: gridData,
      });
    } else {
      gridSource.setData(gridData);
    }

    if (!map.getLayer('site-neighborhood-outline')) {
      map.addLayer(
        {
          id: 'site-neighborhood-outline',
          type: 'line',
          source: 'site-neighborhood-source',
          layout: {
            visibility: showGrid ? 'visible' : 'none',
          },
          paint: {
            'line-color': [
              'case',
              ['boolean', ['get', 'isActive'], false],
              '#10b981',
              '#CBD5E1',
            ],
            'line-width': [
              'case',
              ['boolean', ['get', 'isActive'], false],
              1.4,
              0.65,
            ],
            'line-opacity': [
              'case',
              ['boolean', ['get', 'isActive'], false],
              0.7,
              0.26,
            ],
          },
        },
        beforeId
      );
    } else {
      map.setLayoutProperty(
        'site-neighborhood-outline',
        'visibility',
        showGrid ? 'visible' : 'none'
      );
    }

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
    HEAT_LAYER_IDS.forEach((layerId, i) => {
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, 'heatmap-opacity-transition', { duration: pending.duration, delay: 0 });
      map.setPaintProperty(layerId, 'heatmap-opacity', h.visible && i === pending.layer ? HEAT_OPACITY : 0);
    });
    h.front = pending.layer;
  };

  /** Loads a frame into the hidden layer, then cross-fades to it once its tiles are ready. */
  const pushHeatFrame = (map: mapboxgl.Map, data: GeoJsonData, color: mapboxgl.ExpressionSpecification) => {
    const h = heatRef.current;
    const back = 1 - h.front;
    const now = performance.now();
    // Fast timeline playback gets short fades; single slider steps get a slow, smooth blend
    const duration = Math.round(clamp((now - h.lastChange) * 0.9, 90, 650));
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
    clearTimeout(h.fadeTimer);
    h.fadeTimer = setTimeout(() => runHeatFade(map), 160);
  };

  const hideHeat = (map: mapboxgl.Map) => {
    const h = heatRef.current;
    h.visible = false;
    h.pending = null;
    clearTimeout(h.fadeTimer);
    if (map.getLayer('heat-cells')) map.setLayoutProperty('heat-cells', 'visibility', 'none');
    HEAT_LAYER_IDS.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, 'heatmap-opacity-transition', { duration: 450, delay: 0 });
      map.setPaintProperty(layerId, 'heatmap-opacity', 0);
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
      syncMapboxLayers(map);
      ensureHeatLayers(map);
      setStyleRevision((r) => r + 1);
    });

    map.on('load', () => {
      setMapError(null);
    });

    map.on('sourcedata', (event) => {
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

  // Climate layer on/off. The camera stays put; the cell tint covers close zoom levels.
  const prevHeatActiveRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    const active = heatLayer !== null;
    if (!map || active === prevHeatActiveRef.current) return;
    prevHeatActiveRef.current = active;
    if (active) {
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
    pushHeatFrame(map, buildHeatGeoJson(heatGrid, heatFrame), heatColorExpression(heatGrid.layer.colors));
  }, [heatFrame, styleRevision]);

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
    <div className="flex flex-col bg-[#171A1F] h-full min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262B33] px-4 sm:px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[#ECEEF0]">{t.map.title}</h2>
          <p className="text-xs text-[#A1A8B3] mt-0.5">{t.map.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-px bg-[#262B33] border border-[#262B33]">
            <button
              type="button"
              onClick={() => setBasemap('dark')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
                basemap === 'dark'
                  ? 'bg-[#222730] text-[#ECEEF0] font-medium'
                  : 'bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
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
                  ? 'bg-[#222730] text-[#ECEEF0] font-medium'
                  : 'bg-[#111316] text-[#A1A8B3] hover:text-[#ECEEF0]'
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
            className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-xs transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer ${
              isDrawingField
                ? 'border-emerald-500/55 bg-emerald-500/15 text-emerald-300 font-medium'
                : 'border-[#262B33] bg-[#111316] text-[#ECEEF0] hover:border-emerald-500/50 hover:text-emerald-300'
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
              className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#262B33] bg-[#111316] px-2.5 py-1 text-xs text-[#A1A8B3] hover:border-amber-500/40 hover:text-amber-300 transition-colors duration-200 ease-out whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.map.clearField}</span>
            </button>
          )}
        </div>
      </div>

      {/* Dedicated Non-Overlapping Drawing Toolbar Strip */}
      {isDrawingField && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262B33] bg-[#111316] px-4 sm:px-5 py-2 text-xs">
          <div className="flex items-center gap-2 text-[#A1A8B3]">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            <span>{t.map.drawingHint}</span>
            {draftPreviewMetrics && (
              <span className="font-mono text-emerald-300 tabular-nums">
                · {draftPreviewMetrics.areaHectares.toFixed(2)} ha
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setDraftVertices((prev) => prev.slice(0, -1))}
              disabled={draftVertices.length === 0}
              className="inline-flex items-center gap-1 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-2.5 py-1 text-xs text-[#ECEEF0] hover:border-[#3A414D] disabled:opacity-40 transition-colors duration-200 ease-out cursor-pointer"
            >
              <Undo2 className="h-3 w-3" aria-hidden="true" />
              <span>{t.map.drawUndo}</span>
            </button>

            <button
              type="button"
              onClick={() => finishDrawing(draftVertices)}
              disabled={draftVertices.length < 3}
              className="inline-flex items-center gap-1 rounded-[2px] bg-emerald-500 px-2.5 py-1 text-xs font-medium text-[#111316] hover:bg-emerald-400 disabled:opacity-40 transition-colors duration-200 ease-out cursor-pointer"
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
              className="inline-flex items-center gap-1 rounded-[2px] border border-[#262B33] bg-[#171A1F] px-2.5 py-1 text-xs text-[#A1A8B3] hover:text-[#ECEEF0] transition-colors duration-200 ease-out cursor-pointer"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              <span>{t.map.drawCancel}</span>
            </button>
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-[380px] lg:min-h-[540px] w-full overflow-hidden isolate z-0 bg-[#111316]">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-amber-300 bg-[#111316]/90">
            {mapError}
          </div>
        )}

        {!mapError && (
          <button
            type="button"
            onClick={() => mapRef.current?.easeTo({ center: [lon, lat], duration: 700, essential: true })}
            title={t.map.recenter}
            aria-label={t.map.recenter}
            className="absolute left-[10px] top-[78px] z-10 flex h-[29px] w-[29px] items-center justify-center rounded-[4px] bg-white text-[#333] shadow-[0_0_0_2px_rgba(0,0,0,0.1)] hover:bg-[#f2f2f2] cursor-pointer"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {/* Top-Right Climate Layer Toggles + Legend */}
        <div className="pointer-events-none absolute top-3 right-3 z-10 flex w-[min(17.5rem,calc(100%-4.5rem))] flex-col items-end gap-2">
          <div className="pointer-events-auto w-full border border-[#262B33] bg-[#111316]/85 backdrop-blur-md p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
            <div className="px-1 pb-1.5 text-[9px] font-mono uppercase tracking-[0.14em] text-[#7C8490]">
              {t.map.heatTitle}
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
                    className={`group relative flex flex-col items-center gap-1 overflow-hidden rounded-[2px] border px-1 pt-1.5 pb-2 text-[10px] transition-all duration-300 ease-out cursor-pointer ${
                      active
                        ? 'border-[#3A414D] bg-[#222730] text-[#ECEEF0]'
                        : 'border-transparent bg-transparent text-[#A1A8B3] hover:bg-[#171A1F] hover:text-[#ECEEF0]'
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
          </div>

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
              <div className="pointer-events-auto w-full border border-[#262B33] bg-[#111316]/85 backdrop-blur-md px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.35)] heat-legend-enter">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-[#ECEEF0]">
                    {heatLayer === 'temp' ? t.map.heatTemp : heatLayer === 'precip' ? t.map.heatPrecip : t.map.heatMoisture}
                  </span>
                  <span key={heatPeriodKey} className="font-mono text-[11px] tabular-nums text-emerald-300 heat-month-tick whitespace-nowrap">
                    {activeTimeline ? `${heatMonths.length > 1 ? 'Ø ' : ''}${activeTimeline.periodLabel}` : ''}
                  </span>
                </div>

                {heatStatus === 'error' ? (
                  <p className="mt-2 text-[11px] text-amber-300">{t.map.heatError}</p>
                ) : !range ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#A1A8B3]">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    {t.map.heatLoading}
                  </p>
                ) : (
                  <>
                    <div className="relative mt-2.5 mb-1">
                      <div
                        className="h-2.5 w-full rounded-[2px] ring-1 ring-white/10"
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
                          className="absolute -top-0.5 h-[14px] w-[2px] -translate-x-1/2 rounded-full bg-emerald-300/90 transition-[left] duration-150 ease-out"
                          style={{ left: cursorPos }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between font-mono text-[10px] tabular-nums text-[#7C8490]">
                      <span>{fmt(range[0])}</span>
                      <span>{fmt(range[1])}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums">
                      {heatSiteValue !== undefined && Number.isFinite(heatSiteValue) && (
                        <span className="text-[#ECEEF0]">
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-white align-middle" />
                          {t.map.heatSite} {fmt(heatSiteValue)}
                        </span>
                      )}
                      {heatCursorValue !== null && (
                        <span className="text-emerald-300">
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-300 align-middle" />
                          {t.map.heatCursor} {fmt(heatCursorValue)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 border-t border-[#262B33] pt-1.5 text-[10px] leading-snug text-[#7C8490]">
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
              className="pointer-events-auto border border-[#262B33] bg-[#111316]/85 backdrop-blur-md px-2.5 py-1 text-[10px] text-[#A1A8B3] hover:text-[#ECEEF0] transition-colors cursor-pointer"
            >
              {t.map.heatZoomHint}
            </button>
          )}
        </div>

        {/* Bottom-Left Site / Field Coordinates & Scale Legend */}
        <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[calc(100%-5rem)] sm:max-w-[78%] border border-[#262B33] bg-[#111316]/95 px-2.5 py-1.5 space-y-1">
          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums tracking-tight text-[#ECEEF0]">
            {drawnField ? (
              <>
                <span className="text-emerald-400 shrink-0">{t.map.fieldLabel}:</span>
                <span className="shrink-0">{drawnField.areaHectares.toFixed(2)} ha</span>
                <span aria-hidden="true" className="text-[#7C8490] shrink-0">
                  ·
                </span>
                <span className="text-[#A1A8B3] shrink-0">
                  Ø {drawnField.samplePointsCount} {t.map.samplesSuffix}
                </span>
                <span aria-hidden="true" className="text-[#7C8490] shrink-0 hidden sm:inline">
                  ·
                </span>
                <span className="text-[#7C8490] hidden sm:inline truncate">
                  {lat.toFixed(4)}, {lon.toFixed(4)}
                </span>
              </>
            ) : (
              <>
                <span className="text-emerald-400 shrink-0">{t.map.pinLabel}:</span>
                <span className="shrink-0">
                  {lat.toFixed(4)}, {lon.toFixed(4)}
                </span>
                <span aria-hidden="true" className="text-[#7C8490] shrink-0">
                  ·
                </span>
                <span className="text-[#A1A8B3] truncate">{regionName}</span>
              </>
            )}
          </div>

          {!drawnField && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#7C8490]">
              <span className="inline-block h-2 w-2 border border-emerald-400 bg-emerald-500/20 shrink-0" />
              <span>{t.map.gridLegend}</span>
            </div>
          )}

          {activeTimeline && activeTimeline.tempC !== undefined && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t border-[#262B33] pt-1 font-mono text-[10px] tabular-nums text-[#A1A8B3]">
              <span className="text-emerald-300 font-semibold">
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
      </div>
    </div>
  );
}
