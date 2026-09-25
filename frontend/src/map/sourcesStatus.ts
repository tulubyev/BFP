/** Pure logic for the "Источники данных" control — no Leaflet import, safe to unit-test directly. */

export type SourceState = 'fresh' | 'stale' | 'failed' | 'unknown';

export interface SourceStatusEntry {
  id: string;
  name: string;
  state: SourceState;
  freshness: { timestamp: string; ageMs: number } | null;
  /** 'annual' sources are labeled with their publication date, not a relative age (see below). */
  cadence?: 'annual' | null;
}

export interface SourcesStatusResponse {
  success: boolean;
  sources: SourceStatusEntry[];
}

export const STATE_COLOR: Record<SourceState, string> = {
  fresh: '#22c55e',
  stale: '#f59e0b',
  failed: '#ef4444',
  unknown: '#64748b',
};

/** "5 мин назад" / "3 ч назад" / "2 дн назад" for a freshness age in ms. */
export function formatRelativeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'меньше минуты назад';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

/** Only the sources with a live freshness signal — the point of this widget, not the full registry. */
export function monitoredSources(sources: SourceStatusEntry[]): SourceStatusEntry[] {
  return sources.filter(s => s.freshness !== null || s.state !== 'unknown');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * "17.06.2026, годовые данные" for annual-cadence sources (a relative age like "99 дн назад"
 * would read as alarming for data that is normal for up to ~a year), "5 мин назад" otherwise.
 */
export function formatFreshnessLabel(entry: SourceStatusEntry): string {
  if (!entry.freshness) return 'нет данных';
  if (entry.cadence === 'annual') {
    const d = new Date(entry.freshness.timestamp);
    const date = `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
    return `опубликовано ${date}, годовые данные`;
  }
  return formatRelativeAge(entry.freshness.ageMs);
}
