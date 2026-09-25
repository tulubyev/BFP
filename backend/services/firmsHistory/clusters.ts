/**
 * Pure clustering of FIRMS hotspots into fire events: single-linkage (points joined by a chain of
 * neighbours ≤ maxKm apart), plus the VIIRS pixel-based area estimate. No I/O.
 */
import type { Confidence } from './hotspotRows';

export const CLUSTER_DISTANCE_KM = 2;
/** Nominal VIIRS I-band pixel: 375 m × 375 m = 14.0625 ha, rounded as in the design (14.06). */
export const VIIRS_PIXEL_KM = 0.375;
export const VIIRS_PIXEL_HA = 14.06;

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEG_LAT = 111.32;

export interface ClusterPoint {
  /** gis.fire_hotspots.id — increasing, used to tell new points from already counted ones. */
  id: number;
  lat: number;
  lon: number;
  satellite: string;
  /** Acquisition time, ISO UTC. */
  acquiredAt: string;
  confidence: Confidence | null;
  frp: number | null;
  regionIso: string;
  regionName: string;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Oldest first; ties by id, so the "first point" of a cluster is deterministic. */
export function comparePoints(a: ClusterPoint, b: ClusterPoint): number {
  return a.acquiredAt < b.acquiredAt ? -1 : a.acquiredAt > b.acquiredAt ? 1 : a.id - b.id;
}

/**
 * Single-linkage clusters: two points share a cluster when a chain of points, each ≤ maxKm from the
 * next, connects them. Sweep over latitude so only nearby pairs are measured. Each cluster is
 * sorted with comparePoints; clusters are ordered by their first point.
 */
export function clusterPoints(points: ClusterPoint[], maxKm: number = CLUSTER_DISTANCE_KM): ClusterPoint[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const order = points.map((_, i) => i).sort((a, b) => points[a].lat - points[b].lat);
  const maxDLat = maxKm / KM_PER_DEG_LAT + 1e-9;
  for (let x = 0; x < order.length; x++) {
    const p = points[order[x]];
    for (let y = x + 1; y < order.length; y++) {
      const q = points[order[y]];
      if (q.lat - p.lat > maxDLat) break;
      if (haversineKm(p.lat, p.lon, q.lat, q.lon) <= maxKm) {
        const ra = find(order[x]);
        const rb = find(order[y]);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }

  const groups = new Map<number, ClusterPoint[]>();
  points.forEach((p, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(p);
    else groups.set(root, [p]);
  });
  return [...groups.values()]
    .map(g => g.sort(comparePoints))
    .sort((a, b) => comparePoints(a[0], b[0]));
}

/** A cluster becomes an incident when it has ≥ 2 points or 1 high-confidence point. */
export function qualifies(cluster: ClusterPoint[]): boolean {
  return cluster.length >= 2 || cluster.some(p => p.confidence === 'high');
}

/**
 * The 375 m grid cell a point falls in. Two detections of the same burning pixel (another pass or
 * satellite) land in the same cell, so counting distinct cells does not double count them.
 */
export function pixelKey(lat: number, lon: number): string {
  const row = Math.floor((lat * KM_PER_DEG_LAT) / VIIRS_PIXEL_KM);
  const rowCenterLat = ((row + 0.5) * VIIRS_PIXEL_KM) / KM_PER_DEG_LAT;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((rowCenterLat * Math.PI) / 180);
  const col = Math.floor((lon * kmPerDegLon) / VIIRS_PIXEL_KM);
  return `${row}:${col}`;
}

export function uniquePixels(points: Pick<ClusterPoint, 'lat' | 'lon'>[]): Set<string> {
  return new Set(points.map(p => pixelKey(p.lat, p.lon)));
}

/** Upper-bound burnt-area estimate: every detected pixel counted as fully burnt. */
export function pixelAreaHa(pixelCount: number): number {
  return Math.round(pixelCount * VIIRS_PIXEL_HA * 100) / 100;
}

export interface Bbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function pointsBbox(points: Pick<ClusterPoint, 'lat' | 'lon'>[]): Bbox {
  return {
    minLat: Math.min(...points.map(p => p.lat)),
    minLon: Math.min(...points.map(p => p.lon)),
    maxLat: Math.max(...points.map(p => p.lat)),
    maxLon: Math.max(...points.map(p => p.lon)),
  };
}

export function mergeBbox(a: Bbox, b: Bbox): Bbox {
  return {
    minLat: Math.min(a.minLat, b.minLat),
    minLon: Math.min(a.minLon, b.minLon),
    maxLat: Math.max(a.maxLat, b.maxLat),
    maxLon: Math.max(a.maxLon, b.maxLon),
  };
}

/** Shortest distance between two boxes in km (0 when they touch or overlap). */
export function bboxDistanceKm(a: Bbox, b: Bbox): number {
  const latGap = a.minLat > b.maxLat ? [b.maxLat, a.minLat] : b.minLat > a.maxLat ? [a.maxLat, b.minLat] : null;
  const lonGap = a.minLon > b.maxLon ? [b.maxLon, a.minLon] : b.minLon > a.maxLon ? [a.maxLon, b.minLon] : null;
  if (!latGap && !lonGap) return 0;
  // Measure the longitude gap at the latitude where the boxes are nearest.
  const nearLat = latGap
    ? (latGap[0] + latGap[1]) / 2
    : (Math.max(a.minLat, b.minLat) + Math.min(a.maxLat, b.maxLat)) / 2;
  const dLatKm = latGap ? haversineKm(latGap[0], 0, latGap[1], 0) : 0;
  const dLonKm = lonGap ? haversineKm(nearLat, lonGap[0], nearLat, lonGap[1]) : 0;
  return Math.sqrt(dLatKm ** 2 + dLonKm ** 2);
}
