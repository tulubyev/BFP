/**
 * Postgres access for the FIRMS history job, behind the FirmsHistoryStore interface so the
 * orchestration (ingest.ts) is tested with an in-memory fake.
 */
import { buildHotspotInserts, HOTSPOT_SOURCE } from './hotspotRows';
import {
  INCIDENT_METHOD, STATIC_SOURCE_STATUS, type ActivityStatus, type ExistingIncident, type IncidentRow,
} from './incidents';
import type { LatLonBbox } from './regions';
import { STATIC_CELL_DEG, STATIC_MIN_CELL_DAYS, type HeatCell, type StaticMaskInfo } from './staticSources';
import type { FIRMSHotspot } from '../firmsService';

export interface StoredHotspot {
  id: number;
  lat: number;
  lon: number;
  satellite: string;
  /** YYYY-MM-DD */
  acqDate: string;
  /** HHMM (UTC) */
  acqTime: string | null;
  confidence: string | null;
  frp: number | null;
}

export interface FirmsHistoryTx {
  /** Inserts new observations, skipping stored ones; returns how many rows were written and rejected. */
  insertHotspots(hotspots: FIRMSHotspot[]): Promise<{ written: number; rejected: number }>;
  /** Stored FIRMS hotspots acquired on or after `sinceDate` (YYYY-MM-DD) inside `bbox`. */
  loadHotspots(sinceDate: string, bbox: LatLonBbox): Promise<StoredHotspot[]>;
  /**
   * Per-cell hotspot history since `sinceDate` inside `bbox` for the static source mask: cells of
   * STATIC_CELL_DEG seen on ≥ STATIC_MIN_CELL_DAYS distinct days (see staticSources.ts).
   */
  loadHeatCells(sinceDate: string, bbox: LatLonBbox): Promise<HeatCell[]>;
  /**
   * The stored hotspots an incident was built from: inside its bbox, acquired between its first
   * and last point (dates, UTC), already counted (id ≤ metadata.max_hotspot_id).
   */
  loadIncidentHotspots(incident: ExistingIncident): Promise<StoredHotspot[]>;
  /** FIRMS incidents still marked active or with a point since `lastSeenSince` (ISO). */
  loadFirmsIncidents(lastSeenSince: string): Promise<ExistingIncident[]>;
  insertIncident(row: IncidentRow): Promise<number>;
  updateIncident(id: number, row: IncidentRow): Promise<void>;
  setIncidentStatus(id: number, status: ActivityStatus): Promise<void>;
  /** metadata.status = 'static_source' plus metadata.static_mask; the row is kept. */
  markStaticSource(id: number, info: StaticMaskInfo): Promise<void>;
}

export interface FirmsHistoryStore {
  /** Runs `fn` in one transaction, serialized across app instances; rolls back if it throws. */
  transaction<T>(fn: (tx: FirmsHistoryTx) => Promise<T>): Promise<T>;
}

/** Thrown when the unique index from migration 011 is missing (ON CONFLICT has no matching index). */
export class MigrationMissingError extends Error {
  constructor() {
    super('migration 011 not applied: gis.fire_hotspots has no unique index fire_hotspots_observation_uniq');
    this.name = 'MigrationMissingError';
  }
}

/** SQLSTATE 42P10: "there is no unique or exclusion constraint matching the ON CONFLICT specification". */
export function isMissingConflictTarget(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '42P10';
}

export interface PgClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
}

/** Any fixed number: key of the transaction-level advisory lock that serializes runs. */
export const ADVISORY_LOCK_KEY = 11_011;

const INCIDENT_COLUMNS = [
  'change_type', 'source', 'detected_date', 'area_ha', 'confidence', 'satellite', 'center_lat', 'center_lng',
  'bbox_min_lat', 'bbox_min_lng', 'bbox_max_lat', 'bbox_max_lng', 'metadata',
] as const;

export function incidentValues(row: IncidentRow): unknown[] {
  return INCIDENT_COLUMNS.map(c => (c === 'metadata' ? JSON.stringify(row.metadata) : row[c]));
}

export const INSERT_INCIDENT_SQL = `INSERT INTO gis.forest_changes (${INCIDENT_COLUMNS.join(', ')}) VALUES (`
  + INCIDENT_COLUMNS.map((c, i) => `$${i + 1}${c === 'metadata' ? '::jsonb' : ''}`).join(', ')
  + ') RETURNING id';

// The method guard makes sure seed/manual rows (no metadata.method) are never modified.
export const UPDATE_INCIDENT_SQL = `UPDATE gis.forest_changes SET `
  + INCIDENT_COLUMNS.map((c, i) => `${c} = $${i + 2}${c === 'metadata' ? '::jsonb' : ''}`).join(', ')
  + `, updated_at = NOW() WHERE id = $1 AND metadata->>'method' = '${INCIDENT_METHOD}'`;

export const SET_STATUS_SQL = `UPDATE gis.forest_changes`
  + ` SET metadata = metadata || jsonb_build_object('status', $2::text), updated_at = NOW()`
  + ` WHERE id = $1 AND metadata->>'method' = '${INCIDENT_METHOD}'`;

export const MARK_STATIC_SQL = `UPDATE gis.forest_changes`
  + ` SET metadata = metadata || jsonb_build_object('status', '${STATIC_SOURCE_STATUS}'::text, 'static_mask', $2::jsonb),`
  + ` updated_at = NOW()`
  + ` WHERE id = $1 AND metadata->>'method' = '${INCIDENT_METHOD}'`;

const HOTSPOT_SELECT = `SELECT id, latitude::float8 AS lat, longitude::float8 AS lon, satellite,`
  + ` to_char(acquisition_date, 'YYYY-MM-DD') AS acq_date, to_char(acquisition_time, 'HH24MI') AS acq_time,`
  + ` confidence, frp::float8 AS frp`
  + ` FROM gis.fire_hotspots`;

export const LOAD_HOTSPOTS_SQL = HOTSPOT_SELECT
  + ` WHERE source = $1 AND acquisition_date >= $2::date`
  + ` AND latitude BETWEEN $3 AND $4 AND longitude BETWEEN $5 AND $6`;

export const LOAD_INCIDENT_HOTSPOTS_SQL = HOTSPOT_SELECT
  + ` WHERE source = $1 AND acquisition_date BETWEEN $2::date AND $3::date`
  + ` AND latitude BETWEEN $4 AND $5 AND longitude BETWEEN $6 AND $7 AND id <= $8`;

/**
 * Distinct detection days per grid cell (the static source mask input). Uses the
 * acquisition_date index (migration 011) for the window; one row per cell seen on ≥ $8 days, so
 * the result stays small even in a heavy fire season (most fire pixels burn on one day only).
 * Cell formula = cellOf() in staticSources.ts: row = floor(lat / d), col = floor(lon·cos((row + ½)·d) / d).
 */
export const LOAD_HEAT_CELLS_SQL = `SELECT cell_row, cell_col, avg(lat) AS lat, avg(lon) AS lon,`
  + ` array_agg(DISTINCT day) AS days`
  + ` FROM (SELECT cell_row, floor(lon * cos(radians((cell_row + 0.5) * $2::float8)) / $2::float8)::int AS cell_col,`
  + ` lat, lon, day`
  + ` FROM (SELECT floor(latitude::float8 / $2::float8)::int AS cell_row, latitude::float8 AS lat,`
  + ` longitude::float8 AS lon, to_char(acquisition_date, 'YYYY-MM-DD') AS day`
  + ` FROM gis.fire_hotspots`
  + ` WHERE source = $1 AND acquisition_date >= $3::date`
  + ` AND latitude BETWEEN $4 AND $5 AND longitude BETWEEN $6 AND $7) h) c`
  + ` GROUP BY cell_row, cell_col`
  + ` HAVING count(DISTINCT day) >= $8`;

const toStoredHotspot = (r: any): StoredHotspot => ({
  id: Number(r.id),
  lat: Number(r.lat),
  lon: Number(r.lon),
  satellite: String(r.satellite),
  acqDate: r.acq_date,
  acqTime: r.acq_time ?? null,
  confidence: r.confidence ?? null,
  frp: r.frp == null ? null : Number(r.frp),
});

/** node-postgres returns text[] as a JS array; tolerate the '{a,b}' literal too. */
function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  return [];
}

export const LOAD_INCIDENTS_SQL = `SELECT id, satellite, center_lat::float8 AS center_lat, center_lng::float8 AS center_lng,`
  + ` bbox_min_lat::float8 AS bbox_min_lat, bbox_min_lng::float8 AS bbox_min_lng,`
  + ` bbox_max_lat::float8 AS bbox_max_lat, bbox_max_lng::float8 AS bbox_max_lng, metadata`
  + ` FROM gis.forest_changes`
  + ` WHERE source = 'firms' AND metadata->>'method' = $1`
  + ` AND (metadata->>'status' = 'active' OR metadata->>'last_seen' >= $2)`;

function txFor(client: PgClientLike): FirmsHistoryTx {
  return {
    async insertHotspots(hotspots) {
      const { batches, rejected } = buildHotspotInserts(hotspots);
      let written = 0;
      for (const batch of batches) {
        try {
          written += (await client.query(batch.text, batch.params)).rows.length;
        } catch (err) {
          if (isMissingConflictTarget(err)) throw new MigrationMissingError();
          throw err;
        }
      }
      return { written, rejected };
    },

    async loadHotspots(sinceDate, bbox) {
      const { rows } = await client.query(LOAD_HOTSPOTS_SQL, [
        HOTSPOT_SOURCE, sinceDate, bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon,
      ]);
      return rows.map(toStoredHotspot);
    },

    async loadHeatCells(sinceDate, bbox) {
      const { rows } = await client.query(LOAD_HEAT_CELLS_SQL, [
        HOTSPOT_SOURCE, STATIC_CELL_DEG, sinceDate, bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon, STATIC_MIN_CELL_DAYS,
      ]);
      return rows.map(r => ({
        row: Number(r.cell_row),
        col: Number(r.cell_col),
        lat: Number(r.lat),
        lon: Number(r.lon),
        days: textArray(r.days).sort(),
      }));
    },

    async loadIncidentHotspots(incident) {
      const m = incident.metadata;
      if (typeof m.first_seen !== 'string' || typeof m.last_seen !== 'string') return [];
      const { rows } = await client.query(LOAD_INCIDENT_HOTSPOTS_SQL, [
        HOTSPOT_SOURCE, m.first_seen.slice(0, 10), m.last_seen.slice(0, 10),
        incident.bbox.minLat, incident.bbox.maxLat, incident.bbox.minLon, incident.bbox.maxLon,
        Number(m.max_hotspot_id ?? 0),
      ]);
      return rows.map(toStoredHotspot);
    },

    async loadFirmsIncidents(lastSeenSince) {
      const { rows } = await client.query(LOAD_INCIDENTS_SQL, [INCIDENT_METHOD, lastSeenSince]);
      return rows.map(r => ({
        id: Number(r.id),
        satellite: r.satellite ?? null,
        center: { lat: Number(r.center_lat), lon: Number(r.center_lng) },
        bbox: {
          minLat: Number(r.bbox_min_lat), minLon: Number(r.bbox_min_lng),
          maxLat: Number(r.bbox_max_lat), maxLon: Number(r.bbox_max_lng),
        },
        metadata: r.metadata ?? {},
      }));
    },

    async insertIncident(row) {
      const { rows } = await client.query(INSERT_INCIDENT_SQL, incidentValues(row));
      return Number(rows[0].id);
    },

    async updateIncident(id, row) {
      await client.query(UPDATE_INCIDENT_SQL, [id, ...incidentValues(row)]);
    },

    async setIncidentStatus(id, status) {
      await client.query(SET_STATUS_SQL, [id, status]);
    },

    async markStaticSource(id, info) {
      await client.query(MARK_STATIC_SQL, [id, JSON.stringify(info)]);
    },
  };
}

/** Store over a pg Pool: one client per run, BEGIN + advisory lock so overlapping containers take turns. */
export function createPgFirmsHistoryStore(pool: PgPoolLike): FirmsHistoryStore {
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
        const result = await fn(txFor(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
