/**
 * Parsing of numeric query parameters that end up in SQL. Values are always clamped numbers and
 * travel as placeholders — never interpolated into the query text.
 */

export const HOTSPOT_DAYS_DEFAULT = 7;
export const HOTSPOT_DAYS_MAX = 30;

/**
 * `?days=` for the hotspot history endpoints: an integer in [1, max]; anything else (missing,
 * non-numeric, arrays, SQL fragments) falls back to the default.
 */
export function parseDays(value: unknown, fallback = HOTSPOT_DAYS_DEFAULT, max = HOTSPOT_DAYS_MAX): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return fallback;
  const text = String(raw).trim();
  if (!/^\d{1,4}$/.test(text)) return fallback;
  const n = Number(text);
  return Math.min(Math.max(n, 1), max);
}

/** Year bounds for `?start_year=` / `?end_year=` (Hansen loss starts in 2001). */
export const YEAR_MIN = 2001;
export const YEAR_MAX = 2100;

/**
 * A year query parameter: a 4-digit integer clamped to [YEAR_MIN, YEAR_MAX]; anything else falls
 * back. Bounds keep year loops short (`end_year=1e12` used to spin the event loop).
 */
export function parseYear(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return fallback;
  const text = String(raw).trim();
  if (!/^\d{4}$/.test(text)) return fallback;
  return Math.min(Math.max(Number(text), YEAR_MIN), YEAR_MAX);
}
