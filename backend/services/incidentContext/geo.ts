/**
 * Spherical geometry for the incident context (nearest road / settlement). Pure.
 *
 * Distances are great-circle distances on a sphere of the mean Earth radius (haversine). The
 * distance to a road is measured to its segments, not to its vertices: a straight forest road can
 * run 300 m from a point whose nearest vertex is 4 km away. Segments are treated as great-circle
 * arcs (at OSM segment lengths, tens to hundreds of metres, the difference from a rhumb line is
 * negligible).
 */

export const EARTH_RADIUS_KM = 6371.0088;

export interface LatLon {
  lat: number;
  lon: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Central angle between two points, radians (haversine; stable for small distances). */
function centralAngle(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

export function haversineKm(a: LatLon, b: LatLon): number {
  return centralAngle(a, b) * EARTH_RADIUS_KM;
}

/** Initial bearing from `a` to `b`, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** The point `distKm` from `start` along the great circle with initial bearing `bearing` (degrees). */
export function destination(start: LatLon, bearing: number, distKm: number): LatLon {
  const δ = distKm / EARTH_RADIUS_KM;
  const θ = bearing * RAD;
  const φ1 = start.lat * RAD;
  const λ1 = start.lon * RAD;
  const φ2 = Math.asin(clamp(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ), -1, 1));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * DEG, lon: ((λ2 * DEG + 540) % 360) - 180 };
}

export interface NearestOnLine {
  /** Great-circle distance from the point to the line, km. */
  km: number;
  /** The closest point of the line. */
  nearest: LatLon;
}

/**
 * Distance from `p` to the great-circle segment a–b: the cross-track distance when the foot of
 * the perpendicular falls inside the segment, otherwise the distance to the nearer end.
 */
export function pointToSegment(p: LatLon, a: LatLon, b: LatLon): NearestOnLine {
  const δ12 = centralAngle(a, b);
  const δ13 = centralAngle(a, p);
  if (δ12 < 1e-12 || δ13 < 1e-12) return { km: δ13 * EARTH_RADIUS_KM, nearest: a };
  const Δθ = (bearingDeg(a, p) - bearingDeg(a, b)) * RAD;
  const δxt = Math.asin(clamp(Math.sin(δ13) * Math.sin(Δθ), -1, 1));
  // Along-track distance from a to the foot of the perpendicular; negative = behind a.
  const δat = Math.acos(clamp(Math.cos(δ13) / Math.cos(δxt), -1, 1)) * Math.sign(Math.cos(Δθ) || 1);
  if (δat <= 0) return { km: δ13 * EARTH_RADIUS_KM, nearest: a };
  if (δat >= δ12) return { km: haversineKm(p, b), nearest: b };
  const foot = destination(a, bearingDeg(a, b), δat * EARTH_RADIUS_KM);
  return { km: Math.abs(δxt) * EARTH_RADIUS_KM, nearest: foot };
}

/** Distance from `p` to a polyline (a single vertex counts as a point); null for no valid vertices. */
export function pointToPolyline(p: LatLon, line: LatLon[]): NearestOnLine | null {
  const pts = line.filter(isValidLatLon);
  if (!pts.length) return null;
  if (pts.length === 1) return { km: haversineKm(p, pts[0]), nearest: pts[0] };
  let best: NearestOnLine | null = null;
  for (let i = 1; i < pts.length; i++) {
    const d = pointToSegment(p, pts[i - 1], pts[i]);
    if (!best || d.km < best.km) best = d;
  }
  return best;
}

export function isValidLatLon(p: unknown): p is LatLon {
  const q = p as LatLon | null;
  return !!q && typeof q.lat === 'number' && typeof q.lon === 'number'
    && Number.isFinite(q.lat) && Number.isFinite(q.lon)
    && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180;
}

const COMPASS = [
  'на север', 'на северо-восток', 'на восток', 'на юго-восток',
  'на юг', 'на юго-запад', 'на запад', 'на северо-запад',
] as const;

/** Bearing → one of 8 directions in words, «на северо-восток» (45° sectors centred on each). */
export function compassWords(bearing: number): string {
  const b = ((bearing % 360) + 360) % 360;
  return COMPASS[Math.round(b / 45) % 8];
}
