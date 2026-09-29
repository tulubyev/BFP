/**
 * Quality gates for Global Forest Watch (future.md §5).
 *
 * - Tree cover loss rows from the Data API: every row needs `year` (integer, 2001..current year)
 *   and `area_ha` (finite, ≥ 0); emissions, when present, finite and ≥ 0. Bad rows are dropped
 *   with a count; an answer without a `data` array or with more than MAX_BAD_ROW_SHARE bad rows
 *   is a format change and is rejected as a whole (the caller falls back to the labelled estimate).
 * - Forest statistics (carbon/cover) from the Data API: every field we show must be present,
 *   finite and ≥ 0 — a missing field is never turned into 0.
 * - Tiles: HTTP 200 must carry a PNG (content type image/png — or application/octet-stream, as S3
 *   serves some — plus the PNG signature and an IHDR chunk, ≥ MIN_PNG_BYTES). An HTML page, an
 *   empty body or JSON instead of a tile is refused (the tile route answers 502, nothing cached).
 * - DIST-ALERT version behind `latest`: `vYYYYMMDD`, a real calendar date, not in the future.
 */
import { excerpt, failed, looksLikeMarkup, passed, type QualityResult } from './result';

export const FIRST_LOSS_YEAR = 2001;
export const MAX_BAD_ROW_SHARE = 0.1;
/** Signature (8) + IHDR chunk (25) + IEND chunk (12): nothing smaller is a PNG. */
export const MIN_PNG_BYTES = 45;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface LossRow {
  year: number;
  area_ha: number;
  emissions_Mg_CO2: number;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Validates a Data API tree cover loss answer (`{ data: [{ year, area_ha, emissions_Mg_CO2 }] }`). */
export function checkGfwLossRows(body: unknown, check: string, now = new Date()): { rows: LossRow[]; result: QualityResult } {
  const source = 'gfw_loss';
  const data = (body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined);
  if (!Array.isArray(data)) {
    const reason = typeof body === 'string' && looksLikeMarkup(body) ? `HTML page instead of JSON: ${excerpt(body)}` : `no "data" array: ${excerpt(body)}`;
    return { rows: [], result: failed(source, check, reason) };
  }
  const maxYear = now.getUTCFullYear();
  const rows: LossRow[] = [];
  const problems: string[] = [];
  for (const raw of data) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const year = num(r.year);
    const area = num(r.area_ha);
    const emissions = r.emissions_Mg_CO2 === undefined || r.emissions_Mg_CO2 === null ? 0 : num(r.emissions_Mg_CO2);
    if (year === null || !Number.isInteger(year) || year < FIRST_LOSS_YEAR || year > maxYear) problems.push(`year=${excerpt(r.year, 12)}`);
    else if (area === null || area < 0) problems.push(`area_ha=${excerpt(r.area_ha, 20)}`);
    else if (emissions === null || emissions < 0) problems.push(`emissions_Mg_CO2=${excerpt(r.emissions_Mg_CO2, 20)}`);
    else rows.push({ year, area_ha: area, emissions_Mg_CO2: emissions });
  }
  const sample = problems.length ? ` (e.g. ${problems[0]})` : '';
  if (data.length > 0 && problems.length / data.length > MAX_BAD_ROW_SHARE) {
    return { rows: [], result: failed(source, check, `${problems.length} of ${data.length} rows are invalid${sample} — format changed?`, data.length, problems.length) };
  }
  return { rows, result: passed(source, check, data.length, problems.length, problems.length ? `dropped${sample}` : undefined) };
}

/** Fields of the forest statistics answer that the API shows. */
export const STATISTICS_FIELDS = [
  'area__ha',
  'umd_tree_cover_extent_2000__ha',
  'umd_tree_cover_loss__ha',
  'umd_tree_cover_gain__ha',
  'umd_tree_cover_loss_from_fires__ha',
  'gfw_forest_carbon_gross_emissions__Mg_CO2e',
] as const;

export type StatisticsRow = Record<(typeof STATISTICS_FIELDS)[number], number>;

/** Validates the first row of a forest statistics answer; any missing/negative field rejects it. */
export function checkGfwStatistics(body: unknown): { row: StatisticsRow | null; result: QualityResult } {
  const source = 'gfw_loss';
  const check = 'data-api-statistics';
  const data = (body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined);
  if (!Array.isArray(data)) return { row: null, result: failed(source, check, `no "data" array: ${excerpt(body)}`) };
  if (data.length === 0) return { row: null, result: failed(source, check, 'no data rows for this geometry') };
  const raw = (data[0] ?? {}) as Record<string, unknown>;
  const row = {} as StatisticsRow;
  const bad: string[] = [];
  for (const field of STATISTICS_FIELDS) {
    const n = num(raw[field]);
    if (n === null || n < 0) bad.push(`${field}=${excerpt(raw[field], 20)}`);
    else row[field] = n;
  }
  if (bad.length) return { row: null, result: failed(source, check, `missing or invalid field(s): ${bad.join(', ')}`, 1, 1) };
  return { row, result: passed(source, check, 1) };
}

/** Why a 200 tile response is not a PNG tile, or null when it is. */
export function tileProblem(contentType: unknown, body: Buffer): string | null {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'image/png' && type !== 'application/octet-stream') {
    return `content type "${type || 'none'}" instead of image/png${body.length ? `: ${excerpt(body, 60)}` : ''}`;
  }
  if (body.length === 0) return 'empty body';
  if (body.length < MIN_PNG_BYTES) return `${body.length} bytes — too small for a PNG`;
  if (!body.subarray(0, 8).equals(PNG_SIGNATURE) || body.toString('latin1', 12, 16) !== 'IHDR') {
    return `not a PNG (${type}): ${excerpt(body, 60)}`;
  }
  return null;
}

const DIST_VERSION_RE = /^v(\d{4})(\d{2})(\d{2})$/;

/** Why a DIST-ALERT version string is unusable, or null for a valid `vYYYYMMDD` not in the future. */
export function distVersionProblem(version: unknown, now = new Date()): string | null {
  const m = typeof version === 'string' ? DIST_VERSION_RE.exec(version) : null;
  if (!m) return `version ${excerpt(version, 40)} is not vYYYYMMDD`;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return `version ${version} is not a real date`;
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return `version ${version} is in the future`;
  if (Number(y) < 2023) return `version ${version} is older than DIST-ALERT itself`;
  return null;
}
