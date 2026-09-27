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
  // Many incidents share a confidence value: newest first among equals keeps pages stable
  confidence_desc: 'fc.confidence DESC NULLS LAST, fc.detected_date DESC',
  confidence_asc: 'fc.confidence ASC NULLS LAST, fc.detected_date DESC',
};

/**
 * Region of an incident: its forest area's region, else the region stored by the job that created
 * it (FIRMS incidents have no forest area — metadata.region comes from point-in-polygon).
 */
export const REGION_EXPR = `COALESCE(fa.region, fc.metadata->>'region')`;

/**
 * FIRMS incidents made only of hotspots at static heat sources (gas flares, industry) carry
 * metadata.status = 'static_source' (firmsHistory/staticSources.ts). Hidden unless asked for:
 * `static_sources=include` shows them with everything else, `static_sources=only` shows only them.
 */
export type StaticSourcesMode = 'exclude' | 'include' | 'only';
export const STATIC_SOURCES_MODES: readonly StaticSourcesMode[] = ['exclude', 'include', 'only'];
export const DEFAULT_STATIC_SOURCES: StaticSourcesMode = 'exclude';

/** SQL condition that drops static-source incidents; `alias` is the forest_changes table alias. */
export function notStaticSourceSql(alias = 'fc'): string {
  return `COALESCE(${alias}.metadata->>'status', '') <> 'static_source'`;
}

/** FROM clause shared by the feed and the export (the region filter needs the forest-area join). */
export const FOREST_CHANGES_FROM = ` FROM gis.forest_changes fc LEFT JOIN gis.forest_areas fa ON fa.id = fc.forest_area_id`;

/**
 * Activity status of FIRMS incidents (metadata.status, firmsHistory/incidents.ts): `active` = a new
 * point within 48 h, `inactive` = none since. Other incidents have no status and drop out when it
 * is set. Static sources are a separate filter (`static_sources`).
 */
export type IncidentActivityStatus = 'active' | 'inactive';
export const INCIDENT_STATUSES: readonly IncidentActivityStatus[] = ['active', 'inactive'];

/**
 * `source` values are free text in the database (the feed lists the actual ones); a value is only
 * accepted in this shape and always travels as a placeholder.
 */
export const SOURCE_RE = /^[\w.\- ]{1,50}$/;

/** gis.forest_changes.id is SERIAL (int4): a larger id would make PostgreSQL fail. */
export const MAX_INT4 = 2_147_483_647;

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
  static_sources?: unknown;
  status?: unknown;
  source?: unknown;
  /** One incident by id (the card opened from a link: /incidents?id=…). */
  id?: unknown;
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

/** A real calendar date as YYYY-MM-DD, else undefined (a malformed date would make PostgreSQL fail). */
export function parseIsoDate(value: unknown): string | undefined {
  const text = firstString(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : undefined;
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
  const staticRaw = firstString(query.static_sources) as StaticSourcesMode | undefined;
  const staticSources = staticRaw && STATIC_SOURCES_MODES.includes(staticRaw) ? staticRaw : DEFAULT_STATIC_SOURCES;
  // Always part of the cache key, so last-good copies cached before the filter existed are not reused.
  const filters: Record<string, string> = { static_sources: staticSources };
  let where = ' WHERE 1=1';
  if (staticSources === 'exclude') where += ` AND ${notStaticSourceSql()}`;
  if (staticSources === 'only') where += ` AND fc.metadata->>'status' = 'static_source'`;

  const idText = firstString(query.id);
  if (idText !== undefined && /^\d{1,10}$/.test(idText) && Number(idText) > 0 && Number(idText) <= MAX_INT4) {
    filters.id = String(Number(idText));
    params.push(Number(idText));
    where += ` AND fc.id = $${params.length}`;
  }
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
    where += ` AND ${REGION_EXPR} = $${params.length}`;
  }
  const statusRaw = firstString(query.status) as IncidentActivityStatus | undefined;
  if (statusRaw !== undefined && INCIDENT_STATUSES.includes(statusRaw)) {
    filters.status = statusRaw;
    params.push(statusRaw);
    where += ` AND fc.metadata->>'status' = $${params.length}`;
  }
  const source = firstString(query.source);
  if (source !== undefined && SOURCE_RE.test(source)) {
    filters.source = source;
    params.push(source);
    where += ` AND fc.source = $${params.length}`;
  }
  const startDate = parseIsoDate(query.start_date);
  if (startDate !== undefined) {
    filters.start_date = startDate;
    params.push(startDate);
    where += ` AND fc.detected_date >= $${params.length}`;
  }
  const endDate = parseIsoDate(query.end_date);
  if (endDate !== undefined) {
    filters.end_date = endDate;
    params.push(endDate);
    where += ` AND fc.detected_date <= $${params.length}`;
  }

  const from = FOREST_CHANGES_FROM;
  const dataParams = [...params, limit, offset];
  const dataQuery = `SELECT fc.*, ${REGION_EXPR} AS region, fa.name AS forest_area_name${from}${where}`
    + ` ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const countQuery = `SELECT COUNT(*)::int AS count${from}${where}`;

  return { sort, orderBy, limit, offset, filters, where, params, dataQuery, dataParams, countQuery };
}

/**
 * Stable key for a query's result set, used as the Redis last-good cache key. Every applied filter
 * is part of it. v2: the cached result gained `sources`.
 */
export function forestChangesCacheKey(query: ForestChangesRawQuery): string {
  const built = buildForestChangesQuery(query);
  const filterKey = Object.keys(built.filters)
    .sort()
    .map(name => `${name}=${built.filters[name]}`)
    .join('&');
  return `incidents:forest-changes:v2:sort=${built.sort}&limit=${built.limit}&offset=${built.offset}&${filterKey}`;
}
