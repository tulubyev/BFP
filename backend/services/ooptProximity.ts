/**
 * Where an incident lies relative to protected areas (OOPT): inside one, or how far to the nearest
 * boundary within MAX_DISTANCE_KM. Pure — the OOPT list comes from the Overpass cache (getOOPT()).
 *
 * Boundaries are OSM relations simplified for the map (overpassService.ts), so the answer is
 * approximate; the UI says so. Distances use a local equirectangular projection around the point:
 * the error is far below the simplification error at ≤ 50 km.
 */
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { OOPTFeature } from './overpassService';

export const MAX_DISTANCE_KM = 50;
export const OOPT_NOTE = 'по границам OSM, приблизительно';
export const OOPT_SOURCE = 'OpenStreetMap через Overpass API (ODbL 1.0)';

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_KM;

export interface LatLon {
  lat: number;
  lon: number;
}

interface OoptRef {
  id: number;
  name: string;
  osm_url: string;
  protect_class: string | null;
  boundary: string | null;
}

export type OoptRelation =
  | ({ relation: 'inside' } & OoptRef)
  | ({ relation: 'near'; distance_km: number } & OoptRef)
  | { relation: 'none'; radius_km: number };

export interface OoptProximity {
  result: OoptRelation;
  /** When the OOPT list was fetched from Overpass (the data date shown in the card). */
  data_date: string;
  note: string;
  source: string;
  /** The point the answer is about. */
  point: 'center';
}

/** Longitude difference folded into [-180, 180] (the antimeridian crosses Chukotka). */
export function lonDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Projects [lon, lat] to km east/north of `origin`. */
function project(origin: LatLon, lon: number, lat: number, cosLat: number): [number, number] {
  return [lonDelta(lon, origin.lon) * KM_PER_DEG_LAT * cosLat, (lat - origin.lat) * KM_PER_DEG_LAT];
}

/** Distance in km from the origin (0, 0) to segment a–b (projected km). */
function originToSegmentKm(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2));
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}

function ringsOf(geometry: OOPTFeature['geometry']): number[][][] {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

/** Distance from `point` to the nearest boundary (or to the point of a degraded Point geometry). */
export function distanceToBoundaryKm(point: LatLon, geometry: OOPTFeature['geometry']): number {
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  if (geometry.type === 'Point') {
    const [x, y] = project(point, geometry.coordinates[0], geometry.coordinates[1], cosLat);
    return Math.hypot(x, y);
  }
  let best = Infinity;
  for (const ring of ringsOf(geometry)) {
    let prev = ring.length ? project(point, ring[0][0], ring[0][1], cosLat) : null;
    for (let i = 1; i < ring.length && prev; i++) {
      const next = project(point, ring[i][0], ring[i][1], cosLat);
      best = Math.min(best, originToSegmentKm(prev, next));
      prev = next;
    }
    if (ring.length === 1 && prev) best = Math.min(best, Math.hypot(prev[0], prev[1]));
  }
  return best;
}

interface Extent { minLat: number; maxLat: number; minLon: number; maxLon: number }

const extents = new WeakMap<object, Extent | null>();

function extentOf(geometry: OOPTFeature['geometry']): Extent | null {
  if (extents.has(geometry)) return extents.get(geometry)!;
  const coords = geometry.type === 'Point' ? [geometry.coordinates] : ringsOf(geometry).flat();
  let extent: Extent | null = null;
  for (const [lon, lat] of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (!extent) extent = { minLat: lat, maxLat: lat, minLon: lon, maxLon: lon };
    else {
      extent.minLat = Math.min(extent.minLat, lat);
      extent.maxLat = Math.max(extent.maxLat, lat);
      extent.minLon = Math.min(extent.minLon, lon);
      extent.maxLon = Math.max(extent.maxLon, lon);
    }
  }
  extents.set(geometry, extent);
  return extent;
}

/** Cheap reject: the feature's extent is farther than `km` from the point (conservative). */
function farAway(point: LatLon, extent: Extent, km: number): boolean {
  const dLat = km / KM_PER_DEG_LAT;
  if (point.lat < extent.minLat - dLat || point.lat > extent.maxLat + dLat) return true;
  // Wide margin near the poles; features spanning the antimeridian are never rejected here.
  if (extent.maxLon - extent.minLon > 180) return false;
  const cos = Math.max(Math.cos((Math.min(Math.abs(point.lat) + dLat, 89) * Math.PI) / 180), 0.01);
  const dLon = km / (KM_PER_DEG_LAT * cos);
  const center = (extent.minLon + extent.maxLon) / 2;
  const half = (extent.maxLon - extent.minLon) / 2;
  return Math.abs(lonDelta(point.lon, center)) > half + dLon;
}

const ref = (f: OOPTFeature): OoptRef => ({
  id: f.id, name: f.name, osm_url: f.osm_url, protect_class: f.protect_class, boundary: f.boundary,
});

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Inside a protected area (the smallest one if they overlap), else the nearest boundary within
 * `maxKm`, else 'none'.
 */
export function ooptRelation(point: LatLon, features: OOPTFeature[], maxKm = MAX_DISTANCE_KM): OoptRelation {
  let inside: OOPTFeature | null = null;
  let nearest: { feature: OOPTFeature; km: number } | null = null;
  for (const feature of features) {
    const extent = extentOf(feature.geometry);
    if (!extent || farAway(point, extent, maxKm)) continue;
    if (feature.geometry.type !== 'Point' && booleanPointInPolygon([point.lon, point.lat], feature.geometry)) {
      if (!inside || (feature.area_ha ?? Infinity) < (inside.area_ha ?? Infinity)) inside = feature;
      continue;
    }
    const km = distanceToBoundaryKm(point, feature.geometry);
    if (km <= maxKm && (!nearest || km < nearest.km)) nearest = { feature, km };
  }
  if (inside) return { relation: 'inside', ...ref(inside) };
  if (nearest) return { relation: 'near', distance_km: round1(nearest.km), ...ref(nearest.feature) };
  return { relation: 'none', radius_km: maxKm };
}

export function ooptProximity(point: LatLon, oopt: { features: OOPTFeature[]; fetchedAt: string }): OoptProximity {
  return {
    result: ooptRelation(point, oopt.features),
    data_date: oopt.fetchedAt,
    note: OOPT_NOTE,
    source: OOPT_SOURCE,
    point: 'center',
  };
}
