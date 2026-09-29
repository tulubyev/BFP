/**
 * Quality gate for Rosleshoz open-data CSV (future.md §5, pattern: firmsCsv.ts).
 *
 * Every dataset: the body must be CSV text (not an HTML page), with a header of ≥ 2 columns and at
 * least one data row; a row with more fields than the header (broken quoting) is dropped.
 * Datasets the app reads by column (SCHEMAS) also get:
 * - the header must still contain the columns we read (each group lists accepted alternatives —
 *   the same candidates as regions/rosleshozRegional.ts); a missing group rejects the dataset;
 * - numbers in value columns must parse, be ≥ 0 and in a plausible range for their unit
 *   (thousand ha, thousand m³, %); a row that fails is dropped with a count;
 * - per-region datasets must list a plausible number of distinct subjects (85 regions + federal
 *   districts + totals ≈ 98 names; far fewer or far more means a different table).
 * A dataset where more than MAX_BAD_ROW_SHARE of rows are dropped is a format change and is
 * rejected as a whole. Rejection throws (in the service) so `rosleshoz:*:last-good` stays.
 */
import { parseRosleshozNumber } from '../regions/rosleshozRegional';
import { excerpt, failed, looksLikeMarkup, passed, type QualityResult } from './result';

export const SOURCE = 'rosleshoz';

/** Distinct subject names a per-region table must have (≈ 98 in the 2026 publications). */
export const MIN_SUBJECTS = 75;
export const MAX_SUBJECTS = 150;
/** Like firmsCsv.ts: small files are not judged by ratio. */
export const MIN_ROWS_FOR_RATIO = 20;
export const MAX_BAD_ROW_SHARE = 0.1;

/** Russia's land area is ≈ 1 712 500 thousand ha: no forest area can exceed it. */
const MAX_THOUSAND_HA = 1_800_000;

interface NumericRule {
  /** Accepted column names (checked where present). */
  columns: string[];
  min: number;
  max: number;
  label: string;
}

interface DatasetSchema {
  /** Column groups that must be present; each group lists accepted alternatives. */
  required: string[][];
  numeric: NumericRule[];
  /** Name columns of a per-region table; triggers the subject count check. */
  subjectColumns?: string[];
}

const NAME_COLUMNS = ['region', 'subjects', 'subject', 'name'];

/**
 * Datasets whose columns the app reads. Others (frozen 2024 fire tables, checks, sanitation…) are
 * passed to the API as raw rows and only get the generic checks — their headers were never pinned.
 */
export const SCHEMAS: Record<string, DatasetSchema> = {
  woodVolume: {
    required: [NAME_COLUMNS, ['volume', 'value']],
    numeric: [{ columns: ['volume', 'value'], min: 0, max: 1_000_000, label: 'thousand m³' }],
    subjectColumns: NAME_COLUMNS,
  },
  forestlandArea: {
    required: [NAME_COLUMNS, ['area', 'value']],
    numeric: [{ columns: ['area', 'value'], min: 0, max: MAX_THOUSAND_HA, label: 'thousand ha' }],
    subjectColumns: NAME_COLUMNS,
  },
  forestFund: {
    required: [NAME_COLUMNS, ['total_materials', 'total', 'value'], ['woodiness']],
    numeric: [
      { columns: ['total_materials', 'total', 'value', 'operational', 'protective', 'protected'], min: 0, max: MAX_THOUSAND_HA, label: 'thousand ha' },
      { columns: ['woodiness'], min: 0, max: 100, label: '%' },
    ],
    subjectColumns: NAME_COLUMNS,
  },
  // Only Russia-wide totals by year: no subject count (soft check, spec Q)
  reforestationArea: {
    required: [['year'], ['area']],
    numeric: [
      { columns: ['area'], min: 0, max: 100_000, label: 'thousand ha' },
      { columns: ['year'], min: 1990, max: new Date().getUTCFullYear() + 1, label: 'year' },
    ],
  },
};

/** Placeholders Rosleshoz uses for «no value»; they stay empty (null), they are not errors. */
const EMPTY_RE = /^(|-|—|–|н\/д|нет данных|x|х|\.{1,3})$/i;

/** One CSV line into fields; double quotes group commas ("" inside quotes is kept literally). */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export interface CheckedCsv {
  /** Kept rows (column name → trimmed string); empty when the dataset is rejected. */
  rows: Record<string, string>[];
  result: QualityResult;
}

function rowProblem(row: Record<string, string>, rules: NumericRule[], present: Set<string>): string | null {
  for (const rule of rules) {
    for (const column of rule.columns) {
      if (!present.has(column)) continue;
      const raw = row[column] ?? '';
      if (EMPTY_RE.test(raw.replace(/\s/g, ''))) continue;
      const n = parseRosleshozNumber(raw);
      if (n === null) return `${column}=${JSON.stringify(raw.slice(0, 20))} is not a number`;
      if (n < rule.min) return `${column}=${n} < ${rule.min}`;
      if (n > rule.max) return `${column}=${n} > ${rule.max} ${rule.label}`;
    }
  }
  return null;
}

/** Validates one downloaded dataset. Pure: the caller reports the result and throws on !ok. */
export function checkRosleshozCsv(dataset: string, body: unknown): CheckedCsv {
  const reject = (reason: string, total = 0, rejected = 0): CheckedCsv =>
    ({ rows: [], result: failed(SOURCE, dataset, reason, total, rejected) });

  if (typeof body !== 'string') return reject(`not CSV text: ${excerpt(body)}`);
  const text = body.replace(/^﻿/, '');
  if (!text.trim()) return reject('empty response');
  if (looksLikeMarkup(text)) return reject(`HTML page instead of CSV: ${excerpt(text)}`);

  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  if (headers.length < 2 || headers.some(h => h === '')) return reject(`bad header: ${excerpt(lines[0])}`);
  if (lines.length < 2) return reject('header only, no data rows');

  const schema = SCHEMAS[dataset];
  const present = new Set(headers);
  if (schema) {
    const missing = schema.required.filter(group => !group.some(c => present.has(c)));
    if (missing.length) {
      return reject(`header lacks column(s) ${missing.map(g => g.join('|')).join(', ')} (got: ${headers.join(',').slice(0, 200)})`);
    }
  }

  const rows: Record<string, string>[] = [];
  const problems: string[] = [];
  const dataLines = lines.slice(1);
  for (const line of dataLines) {
    const values = parseCsvLine(line);
    if (values.length > headers.length) {
      problems.push(`${values.length} fields for ${headers.length} columns`);
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim(); });
    const problem = schema ? rowProblem(row, schema.numeric, present) : null;
    if (problem) {
      problems.push(problem);
      continue;
    }
    rows.push(row);
  }

  const total = dataLines.length;
  const rejected = problems.length;
  const sample = problems.length ? ` (e.g. ${problems[0]})` : '';
  if (total >= MIN_ROWS_FOR_RATIO && rejected / total > MAX_BAD_ROW_SHARE) {
    return reject(`${rejected} of ${total} rows are invalid (> ${MAX_BAD_ROW_SHARE * 100}%)${sample} — format changed?`, total, rejected);
  }
  if (rows.length === 0) return reject(`no valid rows of ${total}${sample}`, total, rejected);

  if (schema?.subjectColumns) {
    const nameColumn = schema.subjectColumns.find(c => present.has(c)) as string;
    const subjects = new Set(rows.map(r => r[nameColumn]).filter(Boolean)).size;
    if (subjects < MIN_SUBJECTS || subjects > MAX_SUBJECTS) {
      return reject(`${subjects} distinct subjects in "${nameColumn}", expected ${MIN_SUBJECTS}–${MAX_SUBJECTS} — not the per-region table?`, total, rejected);
    }
  }

  return { rows, result: passed(SOURCE, dataset, total, rejected, rejected ? `dropped${sample}` : undefined) };
}
