/**
 * Quality gate for NASA FIRMS CSV (future.md §5 «Контроль качества»): the header must still have the
 * columns we read, every row must have a valid position and date, and a file where too many rows
 * fail is treated as a changed format and rejected as a whole. A rejected file never replaces the
 * cached snapshot (cached()/warm() keep the last good one) and shows up in the load journal as a
 * failed run with the reason — instead of NaN coordinates silently reaching the map and the DB.
 */
import type { FIRMSHotspot } from './firmsService';

/** Columns every FIRMS VIIRS CSV (NRT global and country archives, area API) has. */
export const REQUIRED_FIRMS_COLUMNS = ['latitude', 'longitude', 'acq_date', 'acq_time', 'frp', 'confidence'] as const;

/** A file with at least this many rows and more than MAX_BAD_ROW_SHARE bad rows is a format change. */
export const MIN_ROWS_FOR_RATIO = 20;
export const MAX_BAD_ROW_SHARE = 0.05;

export class FirmsCsvStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmsCsvStructureError';
  }
}

export interface ParsedFirmsCsv {
  hotspots: FIRMSHotspot[];
  /** Data rows read (blank lines excluded). */
  rows: number;
  /** Rows dropped: bad position, bad date or a wrong number of fields. */
  rejected: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Missing required columns in a header line (lower-cased names), plus a brightness column check. */
export function missingColumns(headers: string[]): string[] {
  const missing: string[] = REQUIRED_FIRMS_COLUMNS.filter(c => !headers.includes(c));
  if (!headers.includes('bright_ti4') && !headers.includes('brightness')) missing.push('bright_ti4|brightness');
  return missing;
}

function finite(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseFirmsCsv(text: string, label = 'FIRMS CSV'): ParsedFirmsCsv {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  if (lines.length === 0) throw new FirmsCsvStructureError(`${label}: empty response`);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const missing = missingColumns(headers);
  if (missing.length) {
    throw new FirmsCsvStructureError(`${label}: header lacks column(s) ${missing.join(', ')} (got: ${headers.join(',').slice(0, 200)})`);
  }
  const col = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;

  const hotspots: FIRMSHotspot[] = [];
  let rejected = 0;
  const dataLines = lines.slice(1);
  for (const line of dataLines) {
    const v = line.split(',').map(x => x.trim());
    const lat = finite(v[col.latitude]);
    const lon = finite(v[col.longitude]);
    const date = v[col.acq_date];
    const bad = v.length < headers.length || lat === null || lon === null
      || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !DATE_RE.test(date ?? '') || !v[col.acq_time];
    if (bad) {
      rejected++;
      continue;
    }
    const at = (name: string) => (name in col ? v[col[name]] : undefined);
    const brightness = finite(at('bright_ti4') ?? at('brightness'));
    const t31 = finite(at('bright_ti5'));
    hotspots.push({
      latitude: lat as number,
      longitude: lon as number,
      brightness: brightness ?? 0,
      bright_t31: t31 ?? undefined,
      frp: finite(at('frp')) ?? 0,
      scan: finite(at('scan')) ?? 0,
      track: finite(at('track')) ?? 0,
      acq_date: date,
      acq_time: v[col.acq_time],
      satellite: at('satellite') || 'VIIRS',
      confidence: at('confidence') || 'nominal',
      version: at('version') || '2.0',
      daynight: at('daynight') || 'D',
    });
  }

  if (dataLines.length >= MIN_ROWS_FOR_RATIO && rejected / dataLines.length > MAX_BAD_ROW_SHARE) {
    throw new FirmsCsvStructureError(
      `${label}: ${rejected} of ${dataLines.length} rows are invalid (> ${MAX_BAD_ROW_SHARE * 100}%) — format changed?`,
    );
  }
  return { hotspots, rows: dataLines.length, rejected };
}
