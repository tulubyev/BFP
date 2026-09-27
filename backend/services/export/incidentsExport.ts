/**
 * Incidents export (GET /api/export/incidents.csv|.geojson|.json): the same filters as the feed
 * (buildForestChangesQuery), no pagination, at most EXPORT_LIMIT rows. Pure mapping and
 * serialization plus one fetch function that takes the pool — no Express, no cache: an export is
 * always read from the database.
 */
import {
  buildForestChangesQuery, FOREST_CHANGES_FROM, REGION_EXPR, type ForestChangesRawQuery,
} from '../forestChangesQuery';
import { INCIDENT_METHOD, INCIDENT_SOURCE } from '../firmsHistory/incidents';
import type { QueryablePool } from '../incidentsService';
import { getSourceDefinition } from '../sourceRegistry';
import { toCsv } from './csv';
import {
  COVER_LOSS_WARNING, EXPORT_LIMIT, FIRMS_AREA_NOTE, FIRMS_INCIDENTS_WARNING, firmsIncidentMethod, METHODOLOGY_URL,
  SITE_URL, staticMaskMethod, type ExportMetadataBase, type ExportSource,
} from './provenance';

export const INCIDENT_COLUMNS = [
  'id', 'change_type', 'status', 'region', 'region_iso', 'detected_date', 'first_seen', 'last_seen',
  'center_lat', 'center_lon', 'bbox_min_lat', 'bbox_min_lon', 'bbox_max_lat', 'bbox_max_lon',
  'area_ha', 'area_note', 'hotspot_count', 'frp_max', 'satellites', 'severity', 'confidence',
  'source', 'method', 'license', 'url',
] as const;

export type IncidentColumn = (typeof INCIDENT_COLUMNS)[number];
export type IncidentExportRow = Record<IncidentColumn, string | number | null>;

export interface IncidentsExportQuery {
  filters: Record<string, string>;
  /** Data query: filtered, ordered, LIMIT EXPORT_LIMIT + 1 (one extra row tells "too many"). */
  dataQuery: string;
  dataParams: any[];
  countQuery: string;
  params: any[];
}

/** Export query from the feed's query builder: same WHERE, same order, no pagination. */
export function buildIncidentsExportQuery(raw: ForestChangesRawQuery, limit: number = EXPORT_LIMIT): IncidentsExportQuery {
  const built = buildForestChangesQuery(raw);
  const dataParams = [...built.params, limit + 1];
  const dataQuery = `SELECT fc.*, ${REGION_EXPR} AS region, fa.name AS forest_area_name${FOREST_CHANGES_FROM}${built.where}`
    + ` ORDER BY ${built.orderBy}, fc.id DESC LIMIT $${dataParams.length}`;
  return {
    filters: { ...built.filters, sort: built.sort },
    dataQuery,
    dataParams,
    countQuery: built.countQuery,
    params: built.params,
  };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s === '' ? null : s;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** DATE column → YYYY-MM-DD. node-postgres parses DATE as local midnight, so local parts are read. */
export function dateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = text(value);
  return s ? s.slice(0, 10) : null;
}

/** Link that opens the incident: the map centred on it, or the incidents page without a centre. */
export function incidentUrl(id: number, lat: number | null, lon: number | null): string {
  if (lat !== null && lon !== null) return `${SITE_URL}/?lat=${lat}&lng=${lon}&incident=${id}`;
  return `${SITE_URL}/incidents?id=${id}`;
}

/** Flat export record of one gis.forest_changes row (fc.* + region). */
export function toIncidentExportRow(row: any): IncidentExportRow {
  const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
  const isFirms = meta.method === INCIDENT_METHOD;
  const id = Number(row.id);
  const centerLat = num(row.center_lat);
  const centerLon = num(row.center_lng);
  const source = text(row.source);
  const license = source ? getSourceDefinition(source === INCIDENT_SOURCE ? 'firms' : source)?.license.name ?? null : null;
  return {
    id,
    change_type: text(row.change_type),
    status: text(meta.status),
    region: text(row.region),
    region_iso: text(meta.region_iso),
    detected_date: dateOnly(row.detected_date),
    first_seen: text(meta.first_seen),
    last_seen: text(meta.last_seen),
    center_lat: centerLat,
    center_lon: centerLon,
    bbox_min_lat: num(row.bbox_min_lat),
    bbox_min_lon: num(row.bbox_min_lng),
    bbox_max_lat: num(row.bbox_max_lat),
    bbox_max_lon: num(row.bbox_max_lng),
    area_ha: num(row.area_ha),
    area_note: isFirms ? FIRMS_AREA_NOTE : null,
    hotspot_count: num(meta.hotspot_count),
    frp_max: num(meta.frp_max),
    satellites: text(row.satellite),
    severity: text(row.severity),
    confidence: num(row.confidence),
    source,
    method: text(meta.method),
    license,
    url: incidentUrl(id, centerLat, centerLon),
  };
}

export interface IncidentsExportMetadata extends ExportMetadataBase {
  dataset: 'incidents';
  filters: Record<string, string>;
  limit: number;
  methods: {
    firmsIncidents: ReturnType<typeof firmsIncidentMethod>;
    staticMask: ReturnType<typeof staticMaskMethod>;
  };
}

export function buildIncidentsMetadata(args: {
  generatedAt: string;
  filters: Record<string, string>;
  count: number;
  sources: ExportSource[];
  archiveCellsVersion: number | null;
}): IncidentsExportMetadata {
  return {
    title: 'ForestWatch — выгрузка инцидентов',
    dataset: 'incidents',
    generatedAt: args.generatedAt,
    filters: args.filters,
    count: args.count,
    limit: EXPORT_LIMIT,
    sources: args.sources,
    methods: {
      firmsIncidents: firmsIncidentMethod(),
      staticMask: staticMaskMethod(args.archiveCellsVersion),
    },
    methodology: METHODOLOGY_URL,
    warnings: [
      FIRMS_INCIDENTS_WARNING,
      `Площадь инцидентов FIRMS — ${FIRMS_AREA_NOTE}: каждый пиксель с термоточкой считается выгоревшим целиком.`,
      COVER_LOSS_WARNING,
    ],
  };
}

export type IncidentsFetchResult =
  | { ok: true; rows: any[]; filters: Record<string, string> }
  | { ok: false; tooMany: true; total: number; filters: Record<string, string> };

/** Reads the filtered incidents; more than `limit` rows → tooMany with the total (never truncated). */
export async function fetchIncidentsForExport(
  pool: QueryablePool, raw: ForestChangesRawQuery, limit: number = EXPORT_LIMIT,
): Promise<IncidentsFetchResult> {
  const q = buildIncidentsExportQuery(raw, limit);
  const { rows } = await pool.query(q.dataQuery, q.dataParams);
  if (rows.length > limit) {
    const count = await pool.query(q.countQuery, q.params);
    return { ok: false, tooMany: true, total: Number(count.rows[0]?.count ?? rows.length), filters: q.filters };
  }
  return { ok: true, rows, filters: q.filters };
}

// ─── Serialization ──────────────────────────────────────────────────────────

export function incidentsToCsv(rows: IncidentExportRow[]): string {
  return toCsv(INCIDENT_COLUMNS, rows);
}

export function incidentsToJson(metadata: IncidentsExportMetadata, rows: IncidentExportRow[]) {
  return { metadata, data: rows };
}

type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'Point'; coordinates: number[] };

/** bbox polygon when the incident has a bbox with area, else its centre point, else null. */
export function incidentGeometry(row: IncidentExportRow): Geometry | null {
  const [minLat, minLon, maxLat, maxLon] = [row.bbox_min_lat, row.bbox_min_lon, row.bbox_max_lat, row.bbox_max_lon] as (number | null)[];
  if (minLat !== null && minLon !== null && maxLat !== null && maxLon !== null && maxLat > minLat && maxLon > minLon) {
    return {
      type: 'Polygon',
      coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
    };
  }
  const lat = row.center_lat as number | null;
  const lon = row.center_lon as number | null;
  if (lat !== null && lon !== null) return { type: 'Point', coordinates: [lon, lat] };
  return null;
}

/** FeatureCollection with `metadata` as a foreign member (RFC 7946 §6.1). */
export function incidentsToGeoJson(metadata: IncidentsExportMetadata, rows: IncidentExportRow[]) {
  return {
    type: 'FeatureCollection' as const,
    metadata,
    features: rows.map(row => ({
      type: 'Feature' as const,
      id: row.id,
      geometry: incidentGeometry(row),
      properties: row,
    })),
  };
}
