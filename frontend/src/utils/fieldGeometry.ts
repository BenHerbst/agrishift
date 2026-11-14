import type { DrawnFieldPolygon } from '../types/terrashift';

const METERS_PER_DEG_LAT = 111320;

export function isPointInPolygon(
  lon: number,
  lat: number,
  vertices: Array<[number, number]>
): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function computePolygonMetrics(vertices: Array<[number, number]>): {
  areaHectares: number;
  perimeterMeters: number;
  centroidLat: number;
  centroidLon: number;
} {
  if (vertices.length === 0) {
    return { areaHectares: 0, perimeterMeters: 0, centroidLat: 0, centroidLon: 0 };
  }
  if (vertices.length < 3) {
    let sumLon = 0;
    let sumLat = 0;
    for (const [lon, lat] of vertices) {
      sumLon += lon;
      sumLat += lat;
    }
    return {
      areaHectares: 0,
      perimeterMeters: 0,
      centroidLat: sumLat / vertices.length,
      centroidLon: sumLon / vertices.length,
    };
  }

  let refLon = 0;
  let refLat = 0;
  for (const [lon, lat] of vertices) {
    refLon += lon;
    refLat += lat;
  }
  refLon /= vertices.length;
  refLat /= vertices.length;

  const cosLat = Math.max(0.2, Math.cos((refLat * Math.PI) / 180));
  const metersPerDegLon = METERS_PER_DEG_LAT * cosLat;

  const localPts = vertices.map(([lon, lat]) => [
    (lon - refLon) * metersPerDegLon,
    (lat - refLat) * METERS_PER_DEG_LAT,
  ]);

  let signedArea2 = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  let perimeterMeters = 0;

  for (let i = 0; i < localPts.length; i++) {
    const [x0, y0] = localPts[i];
    const [x1, y1] = localPts[(i + 1) % localPts.length];
    const cross = x0 * y1 - x1 * y0;
    signedArea2 += cross;
    cxAcc += (x0 + x1) * cross;
    cyAcc += (y0 + y1) * cross;
    perimeterMeters += Math.hypot(x1 - x0, y1 - y0);
  }

  const areaM2 = Math.abs(signedArea2) / 2;
  const areaHectares = areaM2 / 10000;

  let centroidLon = refLon;
  let centroidLat = refLat;

  if (Math.abs(signedArea2) > 1e-6) {
    const cx = cxAcc / (3 * signedArea2);
    const cy = cyAcc / (3 * signedArea2);
    centroidLon = refLon + cx / metersPerDegLon;
    centroidLat = refLat + cy / METERS_PER_DEG_LAT;
  }

  // If polygon is strongly concave and centroid falls outside, snap to nearest interior midpoint
  if (!isPointInPolygon(centroidLon, centroidLat, vertices)) {
    centroidLon = refLon;
    centroidLat = refLat;
  }

  return {
    areaHectares: Number(areaHectares.toFixed(2)),
    perimeterMeters: Math.round(perimeterMeters),
    centroidLat: Number(centroidLat.toFixed(5)),
    centroidLon: Number(centroidLon.toFixed(5)),
  };
}

export function generateFieldSamplePoints(
  vertices: Array<[number, number]>,
  maxPoints = 5
): Array<{ lat: number; lon: number }> {
  const { centroidLat, centroidLon, areaHectares } = computePolygonMetrics(vertices);
  const points: Array<{ lat: number; lon: number }> = [
    { lat: centroidLat, lon: centroidLon },
  ];

  // For very small plots (< 1.5 ha), a single ISRIC 250m centroid sample suffices
  if (vertices.length < 3 || areaHectares < 1.5) {
    return points;
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of vertices) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  // Try a 3x3 grid inside bounding box, keeping interior points spaced apart from centroid
  const candidateOffsets = [0.25, 0.75];
  for (const fy of candidateOffsets) {
    for (const fx of candidateOffsets) {
      if (points.length >= maxPoints) break;
      const pLon = minLon + (maxLon - minLon) * fx;
      const pLat = minLat + (maxLat - minLat) * fy;
      if (isPointInPolygon(pLon, pLat, vertices)) {
        const tooClose = points.some(
          (existing) =>
            Math.abs(existing.lat - pLat) < 0.0008 &&
            Math.abs(existing.lon - pLon) < 0.0011
        );
        if (!tooClose) {
          points.push({
            lat: Number(pLat.toFixed(5)),
            lon: Number(pLon.toFixed(5)),
          });
        }
      }
    }
  }

  // Fallback: midpoints toward vertices if diagonal shape missed 3x3 sub-points
  if (points.length < Math.min(3, maxPoints)) {
    for (const [vLon, vLat] of vertices) {
      if (points.length >= maxPoints) break;
      const midLon = (centroidLon + vLon) / 2;
      const midLat = (centroidLat + vLat) / 2;
      if (isPointInPolygon(midLon, midLat, vertices)) {
        const tooClose = points.some(
          (existing) =>
            Math.abs(existing.lat - midLat) < 0.0008 &&
            Math.abs(existing.lon - midLon) < 0.0011
        );
        if (!tooClose) {
          points.push({
            lat: Number(midLat.toFixed(5)),
            lon: Number(midLon.toFixed(5)),
          });
        }
      }
    }
  }

  return points;
}

export function buildDrawnFieldPolygon(
  vertices: Array<[number, number]>
): DrawnFieldPolygon {
  const metrics = computePolygonMetrics(vertices);
  const samplePoints = generateFieldSamplePoints(vertices, 5);
  return {
    coordinates: vertices,
    centroidLat: metrics.centroidLat,
    centroidLon: metrics.centroidLon,
    areaHectares: metrics.areaHectares,
    perimeterMeters: metrics.perimeterMeters,
    samplePointsCount: samplePoints.length,
  };
}
