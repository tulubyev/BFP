/**
 * The FIRMS hotspots of one incident and its position relative to protected areas
 * (GET /api/monitoring/forest-changes/:id/hotspots, handler in routes/incidentHotspots.ts).
 *
 * "Its hotspots" = stored FIRMS observations inside the incident bbox grown by one VIIRS pixel
 * (375 m) and acquired between its first and last point (UTC dates) — the points the clustering job
 * (firmsHistory/) saw, plus neighbours that just missed the cluster. At most MAX_HOTSPOTS points.
 */
import { HOTSPOT_SOURCE } from './firmsHistory/hotspotRows';
import { INCIDENT_METHOD } from './firmsHistory/incidents';
import type { LatLon } from './ooptProximity';

export const MAX_HOTSPOTS = 500;
export const BUFFER_M = 375;
export const HOTSPOTS_TTL_SEC = 10 * 60;
export const HOTSPOTS_DATASET = 'NASA FIRMS VIIRS 375 m NRT (Suomi NPP, NOAA-20, NOAA-21)';
export const HOTSPOTS_LICENSE = 'Открытые данные NASA (без ограничений)';

const M_PER_DEG_LAT = 111_320;

export interface HotspotIncident {
  id: number;
  isFirms: boolean;
  center: LatLon | null;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface HotspotWindow {
  from: string;
  to: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface IncidentHotspot {
  lat: number;
  lon: number;
  satellite: string;
  /** Acquisition time, ISO UTC (minute precision). */
  acquired_at: string;
  confidence: string | null;
  frp: number | null;
}

export const INCIDENT_FOR_HOTSPOTS_SQL = `SELECT id, center_lat::float8 AS center_lat, center_lng::float8 AS center_lng,`
  + ` bbox_min_lat::float8 AS bbox_min_lat, bbox_min_lng::float8 AS bbox_min_lng,`
  + ` bbox_max_lat::float8 AS bbox_max_lat, bbox_max_lng::float8 AS bbox_max_lng, metadata`
  + ` FROM gis.forest_changes WHERE id = $1`;

/** $8 = MAX_HOTSPOTS + 1: one extra row tells that the list was cut. */
export const INCIDENT_HOTSPOTS_SQL = `SELECT latitude::float8 AS lat, longitude::float8 AS lon, satellite,`
  + ` to_char(acquisition_date, 'YYYY-MM-DD') AS acq_date, to_char(acquisition_time, 'HH24:MI') AS acq_time,`
  + ` confidence, frp::float8 AS frp`
  + ` FROM gis.fire_hotspots`
  + ` WHERE source = $1 AND acquisition_date BETWEEN $2::date AND $3::date`
  + ` AND latitude BETWEEN $4 AND $5 AND longitude BETWEEN $6 AND $7`
  + ` ORDER BY acquisition_date, acquisition_time, id LIMIT $8`;

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isoDay = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : null;

export function hotspotIncidentFromRow(row: any): HotspotIncident {
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const lat = finite(row.center_lat);
  const lon = finite(row.center_lng);
  const b = [row.bbox_min_lat, row.bbox_min_lng, row.bbox_max_lat, row.bbox_max_lng].map(finite);
  return {
    id: Number(row.id),
    isFirms: meta.method === INCIDENT_METHOD,
    center: lat !== null && lon !== null ? { lat, lon } : null,
    bbox: b.every(v => v !== null) ? { minLat: b[0]!, minLon: b[1]!, maxLat: b[2]!, maxLon: b[3]! } : null,
    firstSeen: isoDay(meta.first_seen),
    lastSeen: isoDay(meta.last_seen),
  };
}

/**
 * The search window: bbox + `bufferM` on each side, first…last point dates (UTC). Null when the
 * incident has no bbox or no dates.
 */
export function hotspotWindow(incident: HotspotIncident, bufferM = BUFFER_M): HotspotWindow | null {
  const { bbox, firstSeen, lastSeen } = incident;
  if (!bbox || !firstSeen || !lastSeen) return null;
  const dLat = bufferM / M_PER_DEG_LAT;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const dLon = bufferM / (M_PER_DEG_LAT * Math.max(Math.cos((midLat * Math.PI) / 180), 0.01));
  const from = new Date(firstSeen).toISOString().slice(0, 10);
  const to = new Date(lastSeen).toISOString().slice(0, 10);
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    minLat: bbox.minLat - dLat,
    maxLat: bbox.maxLat + dLat,
    minLon: bbox.minLon - dLon,
    maxLon: bbox.maxLon + dLon,
  };
}

export function hotspotQueryParams(window: HotspotWindow, max = MAX_HOTSPOTS): unknown[] {
  return [HOTSPOT_SOURCE, window.from, window.to, window.minLat, window.maxLat, window.minLon, window.maxLon, max + 1];
}

export function hotspotFromRow(row: any): IncidentHotspot | null {
  const lat = finite(row.lat);
  const lon = finite(row.lon);
  if (lat === null || lon === null || typeof row.acq_date !== 'string') return null;
  const time = typeof row.acq_time === 'string' && /^\d{2}:\d{2}$/.test(row.acq_time) ? row.acq_time : '00:00';
  return {
    lat,
    lon,
    satellite: String(row.satellite ?? ''),
    acquired_at: `${row.acq_date}T${time}:00Z`,
    confidence: row.confidence == null ? null : String(row.confidence),
    frp: finite(row.frp),
  };
}

export interface IncidentHotspotList {
  hotspots: IncidentHotspot[];
  /** More than `limit` points matched; `hotspots` holds the first `limit` in time order. */
  truncated: boolean;
  limit: number;
  window: HotspotWindow;
}

/** Rows of INCIDENT_HOTSPOTS_SQL (LIMIT max + 1) → at most `max` points and the truncation flag. */
export function toHotspotList(rows: any[], window: HotspotWindow, max = MAX_HOTSPOTS): IncidentHotspotList {
  const hotspots = rows.slice(0, max).map(hotspotFromRow).filter((h): h is IncidentHotspot => h !== null);
  return { hotspots, truncated: rows.length > max, limit: max, window };
}

/** Redis keys: by id and last_seen, so a grown incident gets a fresh answer at once. */
export function hotspotsCacheKey(incident: HotspotIncident): string {
  return `incident:hotspots:v1:${incident.id}:${incident.lastSeen ?? 'none'}`;
}

export function ooptCacheKey(incident: HotspotIncident): string {
  return `incident:oopt:v1:${incident.id}:${incident.lastSeen ?? 'none'}`;
}
