/**
 * Pure helpers for the «Регионы» section of the analytics page: table columns, sorting and value
 * formatting. A null value is shown as «нет данных», never as 0 (future.md §3).
 */
import type { Indicator, IndicatorKind, RegionSummary } from '../api/regions';

export const KIND_LABELS: Record<IndicatorKind, string> = {
  official: 'официально',
  satellite: 'спутник',
  estimate: 'оценка',
};

export const NO_DATA = 'нет данных';

/** Table columns: indicator id + short header. Order = display order. */
export const REGION_COLUMNS: { id: string; header: string }[] = [
  { id: 'forestland_area', header: 'Лесные земли, тыс. га' },
  { id: 'woodiness', header: 'Лесистость, %' },
  { id: 'wood_volume', header: 'Заготовка, тыс. м³' },
  { id: 'hotspots_vegetation', header: 'Термоточки за год' },
  { id: 'hotspots_per_10k_km2', header: 'Термоточки на 10 тыс. км²' },
  { id: 'hotspots_deviation_5y', header: 'Откл. от среднего за 5 лет, %' },
  { id: 'hotspots_nrt_season', header: 'Термоточки сезона (NRT)' },
  { id: 'oopt_share', header: 'Доля ООПТ, %' },
  { id: 'loss_per_100k_ha', header: 'Потери на 100 тыс. га лесфонда' },
];

export function findIndicator(region: Pick<RegionSummary, 'indicators'>, id: string): Indicator | null {
  return region.indicators.find(i => i.id === id) ?? null;
}

/** Localized number (ru-RU, non-breaking group separator), «≈» for approximate values, sign for deviations. */
export function formatIndicatorNumber(indicator: Pick<Indicator, 'value' | 'approximate' | 'id'> | null): string {
  if (!indicator || indicator.value == null) return NO_DATA;
  const v = indicator.value;
  // The backend already rounds each indicator to its meaningful precision
  const text = v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const signed = indicator.id === 'hotspots_deviation_5y' && v > 0 ? `+${text}` : text;
  return indicator.approximate ? `≈ ${signed}` : signed;
}

/** Value with unit, e.g. «69 420 тыс. га»; «нет данных» (plus the reason when known) for null. */
export function formatIndicatorValue(indicator: Indicator | null): string {
  if (!indicator) return NO_DATA;
  if (indicator.value == null) return indicator.reason ? `${NO_DATA}: ${indicator.reason}` : NO_DATA;
  return `${formatIndicatorNumber(indicator)} ${indicator.unit}`;
}

export type SortDir = 'asc' | 'desc';
export interface SortState {
  /** 'name' or an indicator id. */
  key: string;
  dir: SortDir;
}

/**
 * Sorts regions: Baikal regions always stay pinned on top (in their given order), the rest are
 * sorted by name or indicator value; regions without a value always go last, whatever the direction.
 */
export function sortRegionRows<T extends RegionSummary>(regions: T[], sort: SortState): T[] {
  const pinned = regions.filter(r => r.baikal);
  const rest = regions.filter(r => !r.baikal);
  const factor = sort.dir === 'asc' ? 1 : -1;
  const sorted = [...rest].sort((a, b) => {
    if (sort.key === 'name') return factor * a.name.localeCompare(b.name, 'ru');
    const va = findIndicator(a, sort.key)?.value ?? null;
    const vb = findIndicator(b, sort.key)?.value ?? null;
    if (va == null && vb == null) return a.name.localeCompare(b.name, 'ru');
    if (va == null) return 1;
    if (vb == null) return -1;
    return factor * (va - vb) || a.name.localeCompare(b.name, 'ru');
  });
  return [...pinned, ...sorted];
}

/** Next sort after clicking a header: same column flips, a new numeric column starts descending. */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' ? 'asc' : 'desc' };
}

/** Indicators grouped for the region card: official, satellite, estimate. */
export function groupByKind(indicators: Indicator[]): Record<IndicatorKind, Indicator[]> {
  const groups: Record<IndicatorKind, Indicator[]> = { official: [], satellite: [], estimate: [] };
  for (const i of indicators) groups[i.kind].push(i);
  return groups;
}

/** Kind shared by a column across regions (loss can be live → satellite); null when mixed or empty. */
export function columnKind(regions: RegionSummary[], id: string): IndicatorKind | null {
  const kinds = new Set(regions.map(r => findIndicator(r, id)?.kind).filter((k): k is IndicatorKind => !!k));
  return kinds.size === 1 ? [...kinds][0] : null;
}
