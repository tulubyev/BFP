/**
 * CSV serialization for the data exports: UTF-8 with a BOM (so Excel detects the encoding),
 * comma separator, CRLF line endings and RFC 4180 quoting. Pure, no I/O.
 *
 * CSV injection: a text cell starting with = + - @ tab or CR can be run as a formula by a
 * spreadsheet, so it gets a leading apostrophe. Only strings are escaped — numbers are written as
 * numbers (a negative deviation stays -12.5, not '-12.5).
 */

export const CSV_BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvValue = string | number | boolean | null | undefined;

/** One cell: null/undefined/NaN → empty cell (never 0), strings escaped and quoted as needed. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: CsvValue[]): string {
  return values.map(csvCell).join(',');
}

/** Full file: BOM, header row, one line per row (columns in `columns` order), CRLF endings. */
export function toCsv<K extends string>(columns: readonly K[], rows: Partial<Record<K, CsvValue>>[]): string {
  const lines = [csvLine(columns as readonly string[] as string[]), ...rows.map(row => csvLine(columns.map(c => row[c])))];
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}
