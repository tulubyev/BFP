/**
 * Pure formatting/selection helpers for the home page's "current situation" stats. No fetch or
 * DOM here — HomePage does the fetching, these only turn API results into display values.
 * future.md §3: a failed request must show «нет данных», never an invented zero.
 */
import type { Incident } from '../api/incidents';
import { firmsIncidentInfo } from './incidents';
import type { SourceStatusEntry } from '../map/sourcesStatus';

export type Stat<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: T };

export const loadingStat: Stat<never> = { status: 'loading' };
export const errorStat: Stat<never> = { status: 'error' };

export function readyStat<T>(value: T): Stat<T> {
  return { status: 'ready', value };
}

/** Active FIRMS fire incidents (clusters whose last point is < 48 h old) among fire-type incidents. */
export function countActiveFirmsIncidents(incidents: Incident[]): number {
  return incidents.filter(incident => firmsIncidentInfo(incident)?.active).length;
}

/** "…" while loading, "нет данных" on a failed request, else the localized number. */
export function formatStatNumber(stat: Stat<number>): string {
  if (stat.status === 'ready') return stat.value.toLocaleString('ru-RU');
  if (stat.status === 'error') return 'нет данных';
  return '…';
}

/** The named entry from a /api/sources/status response, or null when absent. */
export function findSourceStatus(sources: SourceStatusEntry[], id: string): SourceStatusEntry | null {
  return sources.find(source => source.id === id) ?? null;
}
