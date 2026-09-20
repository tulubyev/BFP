import type { Incident } from '../api/incidents';

export function parseIncidentId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function serializeIncident(incident: Incident): string {
  return JSON.stringify(incident, null, 2);
}