/**
 * Parsing of numeric query parameters that end up in SQL. Values are always clamped numbers and
 * travel as placeholders — never interpolated into the query text.
 */

export const HOTSPOT_DAYS_DEFAULT = 7;
export const HOTSPOT_DAYS_MAX = 30;
/** Row cap for the raw hotspot GeoJSON (a busy fire day is ~10 000 detections in Russia). */
export const HOTSPOT_GEOJSON_LIMIT = 5000;

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
