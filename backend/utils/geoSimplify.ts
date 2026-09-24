/**
 * Simplifies OOPT polygons for the browser: Douglas-Peucker via @turf/turf, then a hard
 * per-ring vertex cap (so one huge, jagged reserve can't blow the payload budget on its own)
 * and 5-decimal coordinate truncation (~1.1 m — plenty for a map at these zoom levels, and
 * shorter numbers compress better).
 */
// Individual @turf/* packages, not the `@turf/turf` bundle: that bundle re-exports @turf/convex,
// which requires the ESM-only `concaveman` — it crashes Node's CJS require (and ts-jest) as soon
// as anything imports `@turf/turf`. simplify/truncate don't pull it in.
import simplify from '@turf/simplify';
import truncate from '@turf/truncate';

type PolyGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

const START_TOLERANCE_DEG = 0.002; // ~150-220 m depending on latitude
const MAX_TOLERANCE_DEG = 0.05;
const COORDINATE_PRECISION = 5;
const MIN_RING_VERTICES = 4; // GeoJSON minimum for a closed ring

function rings(geometry: PolyGeometry): GeoJSON.Position[][] {
  return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
}

/** Total vertex count across all rings — the number that actually drives payload size. */
export function countVertices(geometry: PolyGeometry): number {
  return rings(geometry).reduce((sum, ring) => sum + ring.length, 0);
}

function maxRingLength(geometry: PolyGeometry): number {
  return rings(geometry).reduce((max, ring) => Math.max(max, ring.length), 0);
}

function minRingLength(geometry: PolyGeometry): number {
  return rings(geometry).reduce((min, ring) => Math.min(min, ring.length), Infinity);
}

/** Evenly-spaced index decimation. Keeps the ring closed: index 0 and the last point survive. */
function decimateRing(ring: GeoJSON.Position[], maxPoints: number): GeoJSON.Position[] {
  if (ring.length <= maxPoints) return ring;
  const step = (ring.length - 1) / (maxPoints - 1);
  const out: GeoJSON.Position[] = [];
  for (let i = 0; i < maxPoints - 1; i++) out.push(ring[Math.round(i * step)]);
  out.push(ring[ring.length - 1]);
  return out;
}

function decimateGeometry(geometry: PolyGeometry, maxVerticesPerRing: number): PolyGeometry {
  const cap = Math.max(MIN_RING_VERTICES, maxVerticesPerRing);
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(r => decimateRing(r, cap)) };
  }
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(poly => poly.map(r => decimateRing(r, cap))) };
}

function simplifyOnce(geometry: PolyGeometry, tolerance: number): PolyGeometry {
  const feature = simplify({ type: 'Feature', properties: {}, geometry }, { tolerance, highQuality: false, mutate: false });
  return feature.geometry as PolyGeometry;
}

/**
 * Simplifies a polygon so every ring has at most `maxVerticesPerRing` points.
 * Doubles the Douglas-Peucker tolerance until the cap is met or a fallback decimation kicks in;
 * a simplification pass that would leave a ring with fewer than 4 points is discarded so the
 * geometry stays valid.
 */
export function simplifyFeatureGeometry(geometry: PolyGeometry, maxVerticesPerRing = 300): PolyGeometry {
  let tolerance = START_TOLERANCE_DEG;
  let result = geometry;

  while (maxRingLength(result) > maxVerticesPerRing && tolerance <= MAX_TOLERANCE_DEG) {
    let candidate: PolyGeometry;
    try {
      candidate = simplifyOnce(result, tolerance);
    } catch {
      break;
    }
    if (minRingLength(candidate) < MIN_RING_VERTICES) break;
    result = candidate;
    tolerance *= 2;
  }

  if (maxRingLength(result) > maxVerticesPerRing) result = decimateGeometry(result, maxVerticesPerRing);

  const truncated = truncate(
    { type: 'Feature', properties: {}, geometry: result },
    { precision: COORDINATE_PRECISION, coordinates: 2, mutate: false },
  );
  return truncated.geometry as PolyGeometry;
}
