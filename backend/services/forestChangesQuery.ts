/**
 * Pure query building for GET /api/monitoring/forest-changes.
 *
 * Kept free of `pg`/Express so it can be unit tested directly: sort is resolved through a
 * fixed whitelist (never interpolated from the request), limit/offset are clamped numbers,
 * and every filter value travels as a parameterized placeholder.
 */

export const FOREST_CHANGES_SORT_COLUMNS: Record<string, string> = {
  date_desc: 'fc.detected_date DESC',
  date_asc: 'fc.detected_date ASC',
  area_desc: 'fc.area_ha DESC NULLS LAST',
  area_asc: 'fc.area_ha ASC NULLS LAST',
};

export const DEFAULT_SORT = 'date_desc';
export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = 100;

export interface ForestChangesRawQuery {
  change_type?: unknown;
  severity?: unknown;
  region?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  limit?: unknown;
  offset?: unknown;
  sort?: unknown;
}

export interface BuiltForestChangesQuery {
  /** Normalized sort key, always one of FOREST_CHANGES_SORT_COLUMNS' keys. */
  sort: string;
  orderBy: string;
  limit: number;
  offset: number;
  /** Normalized filter values actually applied, keyed by field name. */
  filters: Record<string, string>;
  /** " WHERE ..." clause with $1.. placeholders, safe to append to any query sharing `params`. */
  where: string;
  /** Placeholder values for `where`, in order. */
  params: any[];
  /** Full paginated data query; params = [...params, limit, offset]. */
  dataQuery: string;
  dataParams: any[];
  /** Row-count query sharing `where`/`params`. */
  countQuery: string;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function clampLimit(value: unknown): number {
  const n = Number(firstString(value));
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

function clampOffset(value: unknown): number {
  const n = Number(firstString(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

export function buildForestChangesQuery(query: ForestChangesRawQuery): BuiltForestChangesQuery {
  const sortKey = firstString(query.sort);
  const sort = sortKey && sortKey in FOREST_CHANGES_SORT_COLUMNS ? sortKey : DEFAULT_SORT;
  const orderBy = FOREST_CHANGES_SORT_COLUMNS[sort];
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);

  const params: any[] = [];
  const filters: Record<string, string> = {};
  let where = ' WHERE 1=1';

  const changeType = firstString(query.change_type);
  if (changeType !== undefined) {
    filters.change_type = changeType;
    params.push(changeType);
    where += ` AND fc.change_type = $${params.length}`;
  }
  const severity = firstString(query.severity);
  if (severity !== undefined) {
    filters.severity = severity;
    params.push(severity);
    where += ` AND fc.severity = $${params.length}`;
  }
  const region = firstString(query.region);
  if (region !== undefined) {
    filters.region = region;
    params.push(region);
    where += ` AND fa.region = $${params.length}`;
  }
  const startDate = firstString(query.start_date);
  if (startDate !== undefined) {
    filters.start_date = startDate;
    params.push(startDate);
    where += ` AND fc.detected_date >= $${params.length}`;
  }
  const endDate = firstString(query.end_date);
  if (endDate !== undefined) {
    filters.end_date = endDate;
    params.push(endDate);
    where += ` AND fc.detected_date <= $${params.length}`;
  }

  const from = ` FROM gis.forest_changes fc LEFT JOIN gis.forest_areas fa ON fa.id = fc.forest_area_id`;
  const dataParams = [...params, limit, offset];
  const dataQuery = `SELECT fc.*, fa.region, fa.name AS forest_area_name${from}${where}`
    + ` ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const countQuery = `SELECT COUNT(*)::int AS count${from}${where}`;

  return { sort, orderBy, limit, offset, filters, where, params, dataQuery, dataParams, countQuery };
}

/** Stable key for a query's result set, used as the Redis last-good cache key. */
export function forestChangesCacheKey(query: ForestChangesRawQuery): string {
  const built = buildForestChangesQuery(query);
  const filterKey = Object.keys(built.filters)
    .sort()
    .map(name => `${name}=${built.filters[name]}`)
    .join('&');
  return `incidents:forest-changes:sort=${built.sort}&limit=${built.limit}&offset=${built.offset}&${filterKey}`;
}
