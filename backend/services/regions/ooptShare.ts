/**
 * Approximate area of protected areas (ООПТ) inside each region: area of (union of the simplified
 * OOPT polygons ∩ region polygon), integrated along latitude rows (scanline). On each row, the
 * row's center line is cut by the OOPT polygons and by the region polygons into longitude
 * intervals; OOPT intervals are merged (overlapping OOPTs count once), intersected with each
 * region's intervals, and the overlap length is converted to km² with the row's geodesic width.
 * Error is dominated by polygon simplification, not by the row step — the indicator is labelled
 * approximate.
 */
import type { RegionShape } from '../firmsHistory/regions';

// Same radius as @turf/area, so OOPT area and region area (the share's denominator) agree
const EARTH_RADIUS_KM = 6378.137;
/** Row height in degrees (~2 km). */
export const OOPT_LATTICE_DEG = 0.02;

type PolygonCoords = number[][][];
type Interval = [number, number];

export interface OoptGeometryLike {
  geometry: { type: string; coordinates: any };
}

/** Geodesic area of a lat/lon cell whose southern edge is at `lat0`, in km². */
export function cellAreaKm2(lat0: number, stepDeg: number, widthDeg = stepDeg): number {
  const rad = Math.PI / 180;
  return EARTH_RADIUS_KM ** 2 * widthDeg * rad * Math.abs(Math.sin((lat0 + stepDeg) * rad) - Math.sin(lat0 * rad));
}

function polygonsOf(geometry: OoptGeometryLike['geometry']): PolygonCoords[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** A polygon crossing the antimeridian gets its western-hemisphere longitudes shifted by +360. */
function unwrap(polygons: PolygonCoords[]): PolygonCoords[] {
  let min = Infinity;
  let max = -Infinity;
  for (const poly of polygons) for (const [lon] of poly[0] ?? []) { min = Math.min(min, lon); max = Math.max(max, lon); }
  if (max - min <= 180) return polygons;
  return polygons.map(poly => poly.map(ring => ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat])));
}

/** Even-odd intervals where the horizontal line at `lat` is inside the polygon (holes included). */
export function polygonRowIntervals(polygon: PolygonCoords, lat: number): Interval[] {
  const xs: number[] = [];
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat)) xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
    }
  }
  xs.sort((a, b) => a - b);
  const out: Interval[] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

/** Sorted, non-overlapping union of intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.map(([a, b]): Interval => [a, b]).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Total length of the overlap of two sorted, non-overlapping interval lists. */
function overlapLength(a: Interval[], b: Interval[]): number {
  let total = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) total += hi - lo;
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return total;
}

export interface OoptAreaResult {
  /** km² of OOPT per region ISO; regions without OOPT are present with 0. */
  areaKm2: Record<string, number>;
  /** OOPT features used (polygons only). */
  polygonCount: number;
  /** OOPT features known only as a point (no polygon) — not counted. */
  pointOnlyCount: number;
}

export function ooptAreaByRegion(features: OoptGeometryLike[], regions: RegionShape[], stepDeg = OOPT_LATTICE_DEG): OoptAreaResult {
  const areaKm2: Record<string, number> = Object.fromEntries(regions.map(r => [r.iso, 0]));
  let polygonCount = 0;
  let pointOnlyCount = 0;

  // 1. OOPT intervals per row
  const ooptRows = new Map<number, Interval[]>();
  for (const feature of features) {
    const polygons = unwrap(polygonsOf(feature.geometry));
    if (!polygons.length) {
      pointOnlyCount++;
      continue;
    }
    polygonCount++;
    for (const polygon of polygons) {
      const outer = polygon[0] ?? [];
      if (outer.length < 4) continue;
      let minLat = Infinity;
      let maxLat = -Infinity;
      for (const [, lat] of outer) { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
      for (let row = Math.floor(minLat / stepDeg); row * stepDeg <= maxLat; row++) {
        const intervals = polygonRowIntervals(polygon, (row + 0.5) * stepDeg);
        if (!intervals.length) continue;
        const list = ooptRows.get(row);
        if (list) list.push(...intervals);
        else ooptRows.set(row, intervals);
      }
    }
  }

  // 2. Per row: merged OOPT intervals ∩ each region's intervals
  for (const [row, raw] of ooptRows) {
    const lat = (row + 0.5) * stepDeg;
    const oopt = mergeIntervals(raw);
    const kmPerDeg = cellAreaKm2(row * stepDeg, stepDeg, 1);
    const ooptMin = oopt[0][0];
    const ooptMax = oopt[oopt.length - 1][1];
    for (const region of regions) {
      const b = region.bbox;
      if (lat < b.minLat || lat > b.maxLat) continue;
      const lonHit = (b.maxLon >= ooptMin && b.minLon <= ooptMax) || (b.minLon < 0 && b.maxLon + 360 >= ooptMin && b.minLon + 360 <= ooptMax);
      if (!lonHit) continue;
      const own: Interval[] = [];
      for (const polygon of region.polygons) {
        for (const [a, c] of polygonRowIntervals(polygon, lat)) {
          own.push([a, c]);
          // Chukotka's western part, matched against OOPTs unwrapped past 180°
          if (a < 0) own.push([a + 360, c + 360]);
        }
      }
      if (!own.length) continue;
      const overlap = overlapLength(oopt, mergeIntervals(own));
      if (overlap > 0) areaKm2[region.iso] += overlap * kmPerDeg;
    }
  }
  return { areaKm2, polygonCount, pointOnlyCount };
}
