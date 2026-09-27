/**
 * Incidents feed state in the page URL (/incidents?…) → API filters. One parser for the feed and
 * its export, so the downloaded file always matches what the page shows. Invalid values are
 * dropped (the API ignores them too).
 */
import type { IncidentFilters, IncidentSort } from '../api/incidents';
import { parsePage, parseStaticSources } from './incidents';

export const SORTS: { value: IncidentSort; label: string }[] = [
  { value: 'date_desc', label: 'Сначала новые' },
  { value: 'date_asc', label: 'Сначала старые' },
  { value: 'area_desc', label: 'По площади: больше' },
  { value: 'area_asc', label: 'По площади: меньше' },
  { value: 'confidence_desc', label: 'По уверенности: выше' },
  { value: 'confidence_asc', label: 'По уверенности: ниже' },
];
export const DEFAULT_SORT: IncidentSort = 'date_desc';

export type Period = '7' | '30' | '90' | 'custom';
export const PERIODS: { value: Period | ''; label: string }[] = [
  { value: '', label: 'За всё время' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: 'custom', label: 'Свой период' },
];

export const STATUSES: { value: 'active' | 'inactive' | ''; label: string }[] = [
  { value: '', label: 'Любой' },
  { value: 'active', label: 'Активен (точки за 48 ч)' },
  { value: 'inactive', label: 'Затих (нет точек 48 ч)' },
];

/** Human names of the `source` values stored in gis.forest_changes; unknown ones are shown as is. */
export const SOURCE_LABELS: Record<string, string> = {
  firms: 'NASA FIRMS (термоточки)',
};

export const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

/** Same shape the API accepts (backend SOURCE_RE). */
const SOURCE_RE = /^[\w.\- ]{1,50}$/;

export function parseSort(value: string | null): IncidentSort {
  return SORTS.some(s => s.value === value) ? (value as IncidentSort) : DEFAULT_SORT;
}

export function parsePeriod(value: string | null): Period | undefined {
  return value === '7' || value === '30' || value === '90' || value === 'custom' ? value : undefined;
}

export function parseStatus(value: string | null): 'active' | 'inactive' | undefined {
  return value === 'active' || value === 'inactive' ? value : undefined;
}

export function parseSource(value: string | null): string | undefined {
  const text = value?.trim();
  return text && SOURCE_RE.test(text) ? text : undefined;
}

/** A real calendar date YYYY-MM-DD, else undefined. */
export function parseDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Date range of a period (UTC dates, inclusive): the last N days end today; `custom` uses the
 * `from`/`to` URL values (a reversed pair is swapped).
 */
export function periodRange(
  period: Period | undefined, from: string | undefined, to: string | undefined, now: Date = new Date(),
): { startDate?: string; endDate?: string } {
  if (!period) return {};
  if (period === 'custom') {
    if (from && to && from > to) return { startDate: to, endDate: from };
    return { startDate: from, endDate: to };
  }
  const days = Number(period);
  return { startDate: new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10) };
}

export interface FeedState {
  type: string;
  region: string;
  sort: IncidentSort;
  period?: Period;
  from?: string;
  to?: string;
  status?: 'active' | 'inactive';
  source?: string;
  staticSources?: 'include' | 'only';
  page: number;
}

export function feedStateFromParams(params: URLSearchParams): FeedState {
  return {
    type: params.get('type') || '',
    region: params.get('region') || '',
    sort: parseSort(params.get('sort')),
    period: parsePeriod(params.get('period')),
    from: parseDate(params.get('from')),
    to: parseDate(params.get('to')),
    status: parseStatus(params.get('status')),
    source: parseSource(params.get('source')),
    staticSources: parseStaticSources(params.get('static')),
    page: parsePage(params.get('page')),
  };
}

/** API filters of a feed state (without page/limit): shared by the feed request and the export URL. */
export function feedFilters(state: FeedState, now: Date = new Date()): IncidentFilters {
  return {
    type: state.type || undefined,
    region: state.region || undefined,
    sort: state.sort,
    status: state.status,
    source: state.source,
    staticSources: state.staticSources,
    ...periodRange(state.period, state.from, state.to, now),
  };
}

/** Any filter set (for «Сбросить фильтры»); sort and page are not filters. */
export function hasActiveFilters(state: FeedState): boolean {
  return Boolean(state.type || state.region || state.period || state.status || state.source || state.staticSources);
}

/**
 * The page URL after changing one value: empty removes it, every change but paging returns to
 * page 1, leaving `custom` drops its dates. Keeps unrelated params (e.g. `id` of an open card).
 */
export function updateFeedParams(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== 'page') next.delete('page');
  if (key === 'period' && value !== 'custom') {
    next.delete('from');
    next.delete('to');
  }
  return next;
}
