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
