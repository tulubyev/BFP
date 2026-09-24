import type { Incident } from '../api/incidents';

export function parseIncidentId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function serializeIncident(incident: Incident): string {
  return JSON.stringify(incident, null, 2);
}
/**
 * Start of the "recent events" window (YYYY-MM-DD, UTC). The home page asks only for this
 * window, so old seed/demo records never show up there as if they were fresh events.
 */
export function recentStartDate(now: Date = new Date(), days = 90): string {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

/** Parses the `page` URL param: any non-positive or non-numeric value clamps to page 1. */
export function parsePage(value: string | null): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Banner shown on the incidents page when the API served a last-good copy instead of live data. */
export function formatCacheBanner(fetchedAt: string): string {
  const date = new Date(fetchedAt);
  const when = Number.isNaN(date.getTime())
    ? fetchedAt
    : date.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
  return `База данных недоступна — показаны данные на ${when}`;
}
