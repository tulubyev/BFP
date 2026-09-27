/**
 * Pure query building and row mapping for GET /api/monitoring/forest-changes/geojson (the map's
 * «Инциденты» layer). Filters go through the feed's own builder (buildForestChangesQuery), so the
 * map and the feed accept the same parameters and hide static heat sources the same way; only the
 * ordering and the row cap are the layer's own.
 */
import {
  buildForestChangesQuery,
  FOREST_CHANGES_FROM,
  REGION_EXPR,
  type ForestChangesRawQuery,
} from './forestChangesQuery';

/** Row cap of the layer: a month of FIRMS incidents fits well below it. */
export const GEOJSON_LIMIT = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD calendar date (first value of an array), else undefined — junk never reaches SQL. */
export function parseIsoDate(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!ISO_DATE.test(text)) return undefined;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : undefined;
}

export interface BuiltGeojsonQuery {
  sql: string;
  params: any[];
  /** Normalized filters actually applied (as in the feed). */
  filters: Record<string, string>;
}

const GEOJSON_COLUMNS = [
  'fc.id', 'fc.change_type', 'fc.severity', 'fc.detected_date', 'fc.area_ha', 'fc.confidence',
  'fc.source', 'fc.satellite', 'fc.center_lat', 'fc.center_lng',
  'fc.bbox_min_lat', 'fc.bbox_min_lng', 'fc.bbox_max_lat', 'fc.bbox_max_lng', 'fc.geojson',
  "fc.metadata->>'method' AS method",
  "fc.metadata->>'status' AS status",
  "fc.metadata->>'hotspot_count' AS hotspot_count",
  "fc.metadata->>'first_seen' AS first_seen",
  "fc.metadata->>'last_seen' AS last_seen",
].join(', ');

/**
 * change_type, region, start_date, end_date and static_sources (exclude by default) — the feed's
 * filters and parsers; dates must be YYYY-MM-DD or they are dropped.
 */
export function buildForestChangesGeojsonQuery(query: ForestChangesRawQuery): BuiltGeojsonQuery {
  const built = buildForestChangesQuery({
    change_type: query.change_type,
    region: query.region,
    start_date: parseIsoDate(query.start_date),
    end_date: parseIsoDate(query.end_date),
    static_sources: query.static_sources,
  });
  const params = [...built.params, GEOJSON_LIMIT];
  const sql = `SELECT ${GEOJSON_COLUMNS}, ${REGION_EXPR} AS region${FOREST_CHANGES_FROM}${built.where}`
    + ` ORDER BY fc.detected_date DESC, fc.id DESC LIMIT $${params.length}`;
  return { sql, params, filters: built.filters };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** [west, south, east, north] when all four bbox columns are valid numbers, else null. */
export function rowBbox(row: Record<string, any>): [number, number, number, number] | null {
  const box = [num(row.bbox_min_lng), num(row.bbox_min_lat), num(row.bbox_max_lng), num(row.bbox_max_lat)];
  if (box.some(v => v === null)) return null;
  const [w, s, e, n] = box as number[];
  return w <= e && s <= n ? [w, s, e, n] : null;
}

function rowGeometry(row: Record<string, any>): any {
  if (row.geojson) {
    try {
      return JSON.parse(row.geojson);
    } catch {
      // fall through to the centre point
    }
  }
  return { type: 'Point', coordinates: [num(row.center_lng), num(row.center_lat)] };
}

export function toGeojsonFeature(row: Record<string, any>) {
  const hotspots = num(row.hotspot_count);
  return {
    type: 'Feature',
    id: row.id,
    geometry: rowGeometry(row),
    properties: {
      id: row.id,
      change_type: row.change_type,
      severity: row.severity,
      detected_date: row.detected_date,
      area_ha: row.area_ha,
      confidence: row.confidence,
      source: row.source,
      satellite: row.satellite,
      region: row.region ?? null,
      method: row.method ?? null,
      status: row.status ?? null,
      hotspot_count: hotspots,
      first_seen: row.first_seen ?? null,
      last_seen: row.last_seen ?? null,
      bbox: rowBbox(row),
    },
  };
}
