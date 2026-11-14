import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Check,
  Globe,
  Layers,
  PenTool,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import {
  buildDrawnFieldPolygon,
  computePolygonMetrics,
} from '../utils/fieldGeometry';
import type { DrawnFieldPolygon } from '../types/terrashift';

interface MapTimelineTelemetry {
  year: number;
  month: number;
  monthLabel: string;
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const prevBasemapRef = useRef<BasemapMode>(basemap);
  const lastFlyCoordsRef = useRef<{ lat: number; lon: number }>({ lat, lon });

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
      setStyleRevision((r) => r + 1);
    });

    map.on('load', () => {
      setMapError(null);
    });

    map.on('mousemove', (event) => {
      if (isDrawingRef.current) {
        setCursorCoord([event.lngLat.lng, event.lngLat.lat]);
      }
    });

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

    syncMapboxLayers(map);

    const coordsChanged =
      Math.abs(lastFlyCoordsRef.current.lat - lat) > 0.0002 ||
      Math.abs(lastFlyCoordsRef.current.lon - lon) > 0.0002;

    if (coordsChanged) {
      lastFlyCoordsRef.current = { lat, lon };
      map.flyTo({
        center: [lon, lat],
        zoom: Math.max(map.getZoom(), 13.2),
        duration: 500,
        essential: true,
      });
    }
  }, [lat, lon, regionName, drawnField, styleRevision]);

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
                {activeTimeline.monthLabel} {activeTimeline.year}
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
