/**
 * Pure mapping of FIRMS hotspots (the Redis snapshot, see firmsService.ts) to gis.fire_hotspots
 * rows, and the batched idempotent INSERT for them. No `pg` here — tests check the SQL directly.
 */
import type { FIRMSHotspot } from '../firmsService';

/** `gis.fire_hotspots.source` for rows written by this job. */
export const HOTSPOT_SOURCE = 'firms_viirs_nrt';

/** Column list of the unique index created by migration 011 (fire_hotspots_observation_uniq). */
export const OBSERVATION_KEY = ['satellite', 'acquisition_date', 'acquisition_time', 'latitude', 'longitude'] as const;

export const HOTSPOT_COLUMNS = [
  'source', 'satellite', 'latitude', 'longitude', 'brightness', 'brightness_t31', 'frp', 'scan', 'track',
  'acquisition_date', 'acquisition_time', 'confidence', 'version', 'daynight',
] as const;

/** SQL types of HOTSPOT_COLUMNS (migration 008), so VALUES rows compare exactly like stored ones. */
export const HOTSPOT_COLUMN_TYPES: Record<(typeof HOTSPOT_COLUMNS)[number], string> = {
  source: 'varchar', satellite: 'varchar', latitude: 'numeric(9,6)', longitude: 'numeric(10,6)',
  brightness: 'numeric', brightness_t31: 'numeric', frp: 'numeric', scan: 'numeric', track: 'numeric',
  acquisition_date: 'date', acquisition_time: 'time', confidence: 'varchar', version: 'varchar', daynight: 'varchar',
};

/** Rows per INSERT: 14 params each keeps a batch far below Postgres' 65535-parameter limit. */
export const INSERT_BATCH_SIZE = 1000;

export type Confidence = 'high' | 'nominal' | 'low';

/** VIIRS CSVs say `h`/`n`/`l`; MODIS and older data use words or 0–100 percentages. */
export function normalizeConfidence(value: string | undefined | null): Confidence | null {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'h' || v === 'high') return 'high';
  if (v === 'n' || v === 'nominal') return 'nominal';
  if (v === 'l' || v === 'low') return 'low';
  if (/^\d+(\.\d+)?$/.test(v)) {
    const pct = Number(v);
    return pct >= 80 ? 'high' : pct >= 30 ? 'nominal' : 'low';
  }
  return null;
}

/** FIRMS `acq_time` (HHMM, sometimes without leading zeros) → `HH:MM:00`; null if malformed. */
export function toSqlTime(acqTime: string | undefined): string | null {
  const t = String(acqTime ?? '').trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const padded = t.padStart(4, '0');
  const hh = Number(padded.slice(0, 2));
  const mm = Number(padded.slice(2, 4));
  if (hh > 23 || mm > 59) return null;
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:00`;
}

const finiteOrNull = (n: number | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

/** Column values in HOTSPOT_COLUMNS order, or null for a hotspot that cannot be stored. */
export function hotspotToRow(h: FIRMSHotspot): unknown[] | null {
  const lat = finiteOrNull(h.latitude);
  const lon = finiteOrNull(h.longitude);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(h.acq_date ?? ''))) return null;
  const time = toSqlTime(h.acq_time);
  if (!time || !h.satellite) return null;
  return [
    HOTSPOT_SOURCE,
    String(h.satellite).slice(0, 20),
    lat,
    lon,
    finiteOrNull(h.brightness),
    finiteOrNull(h.bright_t31),
    finiteOrNull(h.frp),
    finiteOrNull(h.scan),
    finiteOrNull(h.track),
    h.acq_date,
    time,
    normalizeConfidence(h.confidence),
    h.version ? String(h.version).slice(0, 20) : null,
    h.daynight ? String(h.daynight).slice(0, 1) : null,
  ];
}

export interface BuiltInsert {
  text: string;
  params: unknown[];
  rows: number;
}

/**
 * Splits hotspots into parameterized multi-row INSERTs that skip already stored observations.
 *
 * The NOT EXISTS filter drops known observations before they reach the table, so they never draw
 * a value from the SERIAL id sequence (plain ON CONFLICT DO NOTHING would burn one id per skipped
 * row — the whole 24 h snapshot, thousands of rows, every 30 min).
 * `ON CONFLICT (<observation key>)` still guards duplicates inside a batch or a concurrent run, and
 * needs the unique index from migration 011 — without it Postgres rejects the statement
 * (SQLSTATE 42P10), which the store reports as MigrationMissingError.
 */
export function buildHotspotInserts(hotspots: FIRMSHotspot[], batchSize: number = INSERT_BATCH_SIZE): {
  batches: BuiltInsert[];
  rejected: number;
} {
  const rows: unknown[][] = [];
  let rejected = 0;
  for (const h of hotspots) {
    const row = hotspotToRow(h);
    if (row) rows.push(row);
    else rejected++;
  }

  const width = HOTSPOT_COLUMNS.length;
  const columns = HOTSPOT_COLUMNS.join(', ');
  const keyMatch = OBSERVATION_KEY.map(c => `f.${c} = v.${c}`).join(' AND ');
  const batches: BuiltInsert[] = [];
  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize);
    const values = chunk
      .map((_, i) => `(${HOTSPOT_COLUMNS.map((c, j) => `$${i * width + j + 1}::${HOTSPOT_COLUMN_TYPES[c]}`).join(', ')})`)
      .join(', ');
    batches.push({
      text: `INSERT INTO gis.fire_hotspots (${columns})`
        + ` SELECT ${columns} FROM (VALUES ${values}) AS v (${columns})`
        + ` WHERE NOT EXISTS (SELECT 1 FROM gis.fire_hotspots f WHERE ${keyMatch})`
        + ` ON CONFLICT (${OBSERVATION_KEY.join(', ')}) DO NOTHING RETURNING id`,
      params: chunk.flat(),
      rows: chunk.length,
    });
  }
  return { batches, rejected };
}
