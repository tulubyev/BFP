/**
 * Per-region values from raw Rosleshoz CSV rows. Column names differ between datasets (and have
 * changed between publications), so each extractor lists candidate columns; a row whose number is
 * empty or unparsable yields null for that region, never 0.
 */
import { classifyRosleshozName } from './rosleshozNames';

/** "1 234,5" / "1234.5" → number; "", "-", "—", "н/д" → null. */
export function parseRosleshozNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[\s  ]/g, '').replace(',', '.');
  if (!s || /^[-—–]$/.test(s) || !/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface RegionalValue {
  value: number | null;
  /** Data year when the dataset has a year column, else null (period = publication date). */
  year: number | null;
}

export interface RegionalExtraction {
  byIso: Map<string, RegionalValue>;
  /** Subject names that matched neither a region nor an explicit exclusion. */
  unmapped: string[];
}

export interface ExtractSpec {
  nameColumns: string[];
  valueColumns: string[];
  yearColumns?: string[];
}

function pick(row: Record<string, string>, columns: string[]): string | undefined {
  for (const c of columns) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
  }
  return undefined;
}

/**
 * Maps rows to regions. When a year column exists, the newest year with a value wins per region;
 * without one, the first row with a value wins.
 */
export function extractRegional(rows: Record<string, string>[], spec: ExtractSpec): RegionalExtraction {
  const byIso = new Map<string, RegionalValue>();
  const unmapped = new Set<string>();
  for (const row of rows) {
    const name = pick(row, spec.nameColumns);
    if (!name) continue;
    const match = classifyRosleshozName(name);
    if (match.kind === 'unmapped') {
      unmapped.add(name.trim());
      continue;
    }
    if (match.kind !== 'region') continue;
    const value = parseRosleshozNumber(pick(row, spec.valueColumns));
    const yearRaw = spec.yearColumns ? parseRosleshozNumber(pick(row, spec.yearColumns)) : null;
    const year = yearRaw != null && Number.isInteger(yearRaw) ? yearRaw : null;
    const current = byIso.get(match.iso);
    if (!current) {
      byIso.set(match.iso, { value, year });
      continue;
    }
    const better = value != null && (current.value == null || (year != null && (current.year == null || year > current.year)));
    if (better) byIso.set(match.iso, { value, year });
  }
  return { byIso, unmapped: [...unmapped].sort() };
}

/** Column candidates per dataset; the first ones match the names used by rosleskhozService. */
export const ROSLESHOZ_SPECS = {
  forestlandArea: { nameColumns: ['subjects', 'subject', 'region', 'name'], valueColumns: ['area', 'value'], yearColumns: ['year'] },
  forestFundTotal: { nameColumns: ['region', 'subjects', 'subject', 'name'], valueColumns: ['total_materials', 'total', 'value'], yearColumns: ['year'] },
  woodiness: { nameColumns: ['region', 'subjects', 'subject', 'name'], valueColumns: ['woodiness'], yearColumns: ['year'] },
  woodVolume: { nameColumns: ['region', 'subjects', 'subject', 'name'], valueColumns: ['volume', 'value'], yearColumns: ['year'] },
} satisfies Record<string, ExtractSpec>;
