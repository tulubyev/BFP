/**
 * Pure planning of FIRMS fire incidents (gis.forest_changes rows) from hotspot clusters:
 * match clusters to active FIRMS incidents, build rows for new ones, merge new points into
 * existing ones, and flip status after 48 h without new points. No I/O — the store applies the plan.
 *
 * Idempotency: each incident remembers the highest gis.fire_hotspots.id it has counted
 * (`metadata.max_hotspot_id`); only points above it are added on a later run, so re-running over
 * the same 72 h window changes nothing.
 */
import {
  bboxDistanceKm, comparePoints, mergeBbox, pixelAreaHa, pixelKey, pointsBbox, qualifies, uniquePixels,
  type Bbox, type ClusterPoint,
} from './clusters';

export const INCIDENT_METHOD = 'firms-cluster-v1';
export const INCIDENT_SOURCE = 'firms';
export const WINDOW_HOURS = 72;
export const INACTIVE_AFTER_HOURS = 48;
export const MATCH_DISTANCE_KM = 2;

const HOUR_MS = 60 * 60 * 1000;

export type IncidentStatus = 'active' | 'inactive';

export interface FirmsIncidentMetadata {
  method: typeof INCIDENT_METHOD;
  cluster_key: string;
  region: string;
  region_iso: string;
  hotspot_count: number;
  /** High-confidence points among hotspot_count (confidence = high_count / hotspot_count). */
  high_count: number;
  /** Distinct 375 m cells; area_ha = pixel_count × 14.06. */
  pixel_count: number;
  frp_max: number | null;
  frp_sum: number;
  first_seen: string;
  last_seen: string;
  status: IncidentStatus;
  /** Highest gis.fire_hotspots.id already counted into this incident. */
  max_hotspot_id: number;
  dataset: string;
  area_method: string;
}

export interface ExistingIncident {
  id: number;
  bbox: Bbox;
  center: { lat: number; lon: number };
  satellite: string | null;
  metadata: Partial<FirmsIncidentMetadata> & Record<string, unknown>;
}

export interface IncidentRow {
  change_type: 'fire';
  source: typeof INCIDENT_SOURCE;
  detected_date: string;
  area_ha: number;
  confidence: number;
  satellite: string;
  center_lat: number;
  center_lng: number;
  bbox_min_lat: number;
  bbox_min_lng: number;
  bbox_max_lat: number;
  bbox_max_lng: number;
  metadata: FirmsIncidentMetadata;
}

export interface IncidentPlan {
  creates: IncidentRow[];
  updates: { id: number; row: IncidentRow }[];
  statusChanges: { id: number; status: IncidentStatus }[];
}

const DATASET = 'NASA FIRMS VIIRS 375 m NRT (Suomi NPP, NOAA-20, NOAA-21)';
const AREA_METHOD = 'upper bound: distinct 375 m VIIRS pixels × 14.06 ha';

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

export function statusAt(lastSeen: string, now: Date): IncidentStatus {
  return now.getTime() - new Date(lastSeen).getTime() > INACTIVE_AFTER_HOURS * HOUR_MS ? 'inactive' : 'active';
}

/** FIRMS incident created by this job (seed/manual rows have no metadata.method and are never touched). */
export function isFirmsIncident(incident: Pick<ExistingIncident, 'metadata'>): boolean {
  return incident.metadata?.method === INCIDENT_METHOD;
}

/** Open for new points: a FIRMS incident whose last point is ≤ 72 h old. */
export function isMatchable(incident: ExistingIncident, now: Date): boolean {
  const last = incident.metadata.last_seen;
  if (!isFirmsIncident(incident) || typeof last !== 'string') return false;
  return now.getTime() - new Date(last).getTime() <= WINDOW_HOURS * HOUR_MS;
}

function satellitesOf(...lists: (string | null | undefined)[]): string {
  const all = new Set<string>();
  for (const list of lists) for (const s of String(list ?? '').split(',')) if (s.trim()) all.add(s.trim());
  return [...all].sort().join(',');
}

const frpValues = (points: ClusterPoint[]) =>
  points.map(p => p.frp).filter((f): f is number => typeof f === 'number' && Number.isFinite(f));

function rowFrom(meta: FirmsIncidentMetadata, bbox: Bbox, center: { lat: number; lon: number }, satellite: string): IncidentRow {
  return {
    change_type: 'fire',
    source: INCIDENT_SOURCE,
    detected_date: meta.first_seen.slice(0, 10),
    area_ha: pixelAreaHa(meta.pixel_count),
    confidence: meta.hotspot_count ? round(meta.high_count / meta.hotspot_count, 2) : 0,
    satellite,
    center_lat: round(center.lat, 6),
    center_lng: round(center.lon, 6),
    bbox_min_lat: bbox.minLat,
    bbox_min_lng: bbox.minLon,
    bbox_max_lat: bbox.maxLat,
    bbox_max_lng: bbox.maxLon,
    metadata: meta,
  };
}

/** Row for a brand-new incident from one cluster (points sorted oldest first). */
export function buildNewIncident(cluster: ClusterPoint[], now: Date): IncidentRow {
  const points = [...cluster].sort(comparePoints);
  const first = points[0];
  const frp = frpValues(points);
  const lastSeen = points[points.length - 1].acquiredAt;
  const meta: FirmsIncidentMetadata = {
    method: INCIDENT_METHOD,
    cluster_key: String(first.id),
    region: first.regionName,
    region_iso: first.regionIso,
    hotspot_count: points.length,
    high_count: points.filter(p => p.confidence === 'high').length,
    pixel_count: uniquePixels(points).size,
    frp_max: frp.length ? Math.max(...frp) : null,
    frp_sum: round(frp.reduce((a, b) => a + b, 0), 2),
    first_seen: first.acquiredAt,
    last_seen: lastSeen,
    status: statusAt(lastSeen, now),
    max_hotspot_id: Math.max(...points.map(p => p.id)),
    dataset: DATASET,
    area_method: AREA_METHOD,
  };
  const center = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
  return rowFrom(meta, pointsBbox(points), center, satellitesOf(...points.map(p => p.satellite)));
}

/**
 * Adds the not-yet-counted points of `points` (the incident's current cluster) to an existing
 * incident; null when there is nothing new. A new point in a cell already seen within the window
 * adds no area.
 */
export function mergeIntoIncident(incident: ExistingIncident, points: ClusterPoint[], now: Date): IncidentRow | null {
  const old = incident.metadata as FirmsIncidentMetadata;
  const watermark = Number(old.max_hotspot_id ?? 0);
  const fresh = points.filter(p => p.id > watermark).sort(comparePoints);
  if (!fresh.length) return null;

  const knownPixels = uniquePixels(points.filter(p => p.id <= watermark));
  const newPixels = new Set(fresh.map(p => pixelKey(p.lat, p.lon)).filter(k => !knownPixels.has(k)));
  const frp = frpValues(fresh);
  const oldCount = Number(old.hotspot_count ?? 0);
  const count = oldCount + fresh.length;
  const firstSeen = [old.first_seen, fresh[0].acquiredAt].filter(Boolean).sort()[0] as string;
  const lastSeen = [old.last_seen, fresh[fresh.length - 1].acquiredAt].filter(Boolean).sort().pop() as string;
  const oldFrpMax = typeof old.frp_max === 'number' ? old.frp_max : null;
  const frpMax = [oldFrpMax, ...frp].filter((f): f is number => f != null);

  const meta: FirmsIncidentMetadata = {
    ...old,
    method: INCIDENT_METHOD,
    hotspot_count: count,
    high_count: Number(old.high_count ?? 0) + fresh.filter(p => p.confidence === 'high').length,
    pixel_count: Number(old.pixel_count ?? 0) + newPixels.size,
    frp_max: frpMax.length ? Math.max(...frpMax) : null,
    frp_sum: round(Number(old.frp_sum ?? 0) + frp.reduce((a, b) => a + b, 0), 2),
    first_seen: firstSeen,
    last_seen: lastSeen,
    status: statusAt(lastSeen, now),
    max_hotspot_id: Math.max(watermark, ...fresh.map(p => p.id)),
    dataset: old.dataset ?? DATASET,
    area_method: old.area_method ?? AREA_METHOD,
  };
  const center = {
    lat: (incident.center.lat * oldCount + fresh.reduce((s, p) => s + p.lat, 0)) / count,
    lon: (incident.center.lon * oldCount + fresh.reduce((s, p) => s + p.lon, 0)) / count,
  };
  return rowFrom(
    meta,
    mergeBbox(incident.bbox, pointsBbox(fresh)),
    center,
    satellitesOf(incident.satellite, ...fresh.map(p => p.satellite)),
  );
}

/**
 * Plans the writes for one run. Each cluster goes to the nearest matchable incident within 2 km
 * (box to box); several clusters near one incident are merged into it. Unmatched clusters that
 * qualify (≥ 2 points or 1 high-confidence point) become new incidents.
 */
export function planIncidents(clusters: ClusterPoint[][], existing: ExistingIncident[], now: Date): IncidentPlan {
  const firms = existing.filter(isFirmsIncident);
  const matchable = firms.filter(i => isMatchable(i, now));
  const assigned = new Map<number, ClusterPoint[]>();
  const creates: IncidentRow[] = [];

  for (const cluster of clusters) {
    if (!cluster.length) continue;
    const box = pointsBbox(cluster);
    let best: { incident: ExistingIncident; distance: number } | null = null;
    for (const incident of matchable) {
      const distance = bboxDistanceKm(box, incident.bbox);
      if (distance <= MATCH_DISTANCE_KM && (!best || distance < best.distance)) best = { incident, distance };
    }
    if (best) {
      assigned.set(best.incident.id, [...(assigned.get(best.incident.id) ?? []), ...cluster]);
    } else if (qualifies(cluster)) {
      creates.push(buildNewIncident(cluster, now));
    }
  }

  const updates: IncidentPlan['updates'] = [];
  const updated = new Set<number>();
  for (const incident of matchable) {
    const points = assigned.get(incident.id);
    if (!points) continue;
    const row = mergeIntoIncident(incident, points, now);
    if (row) {
      updates.push({ id: incident.id, row });
      updated.add(incident.id);
    }
  }

  const statusChanges: IncidentPlan['statusChanges'] = [];
  for (const incident of firms) {
    if (updated.has(incident.id) || typeof incident.metadata.last_seen !== 'string') continue;
    const status = statusAt(incident.metadata.last_seen, now);
    if (status !== incident.metadata.status) statusChanges.push({ id: incident.id, status });
  }

  return { creates, updates, statusChanges };
}
