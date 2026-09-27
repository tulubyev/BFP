/**
 * Loading an incident (gis.forest_changes row) for the imagery endpoint.
 * FIRMS incidents carry a bbox and metadata.first_seen / last_seen; other rows fall back to the
 * centre point and detected_date.
 */
import type { Bbox } from './geometry';
import type { IncidentGeo } from './service';

export const INCIDENT_GEO_SQL = `SELECT id,`
  + ` center_lat::float8 AS center_lat, center_lng::float8 AS center_lng,`
  + ` bbox_min_lat::float8 AS bbox_min_lat, bbox_min_lng::float8 AS bbox_min_lng,`
  + ` bbox_max_lat::float8 AS bbox_max_lat, bbox_max_lng::float8 AS bbox_max_lng,`
  + ` to_char(detected_date, 'YYYY-MM-DD') AS detected_date,`
  + ` metadata->>'first_seen' AS first_seen, metadata->>'last_seen' AS last_seen`
  + ` FROM gis.forest_changes WHERE id = $1`;

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const validDate = (v: unknown): string | null =>
  typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null;

/** 'no-geometry' when the row has neither a valid bbox nor a centre, or no usable date. */
export function incidentGeoFromRow(row: Record<string, unknown>): IncidentGeo | 'no-geometry' {
  const minLat = num(row.bbox_min_lat); const minLon = num(row.bbox_min_lng);
  const maxLat = num(row.bbox_max_lat); const maxLon = num(row.bbox_max_lng);
  const lat = num(row.center_lat); const lon = num(row.center_lng);
  let bbox: Bbox | null = null;
  let hasBbox = false;
  if (minLat != null && minLon != null && maxLat != null && maxLon != null && minLat <= maxLat && minLon <= maxLon) {
    bbox = [minLon, minLat, maxLon, maxLat];
    hasBbox = true;
  } else if (lat != null && lon != null) {
    bbox = [lon, lat, lon, lat];
  }
  if (!bbox || bbox.some(n => Math.abs(n) > 180) || Math.abs(bbox[1]) > 90 || Math.abs(bbox[3]) > 90) return 'no-geometry';

  const detected = validDate(row.detected_date);
  const firstSeen = validDate(row.first_seen) ?? detected;
  const lastSeen = validDate(row.last_seen) ?? firstSeen;
  if (!firstSeen || !lastSeen) return 'no-geometry';
  return { id: Number(row.id), bbox, firstSeen, lastSeen, hasBbox };
}
