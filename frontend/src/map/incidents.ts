/**
 * «Инциденты» map layer: FIRMS hotspot-cluster incidents of the last 30 days. Pure helpers shared
 * by the Leaflet layer and tests. An incident is a cluster of satellite hotspots, not a confirmed
 * fire (CLAUDE.md), so the wording stays neutral.
 */

export const INCIDENTS_WINDOW_DAYS = 30;
/** From this zoom the incident's bbox is drawn; below it — a point at its centre. */
export const INCIDENT_BBOX_MIN_ZOOM = 9;
export const FIRMS_INCIDENT_METHOD = 'firms-cluster-v1';

export type IncidentActivity = 'active' | 'inactive';

/** Feature properties from /api/monitoring/forest-changes/geojson. */
export interface IncidentFeatureProps {
  id: number;
  change_type: string;
  detected_date: string;
  source: string | null;
  region: string | null;
  method: string | null;
  status: string | null;
  hotspot_count: number | null;
  first_seen: string | null;
  last_seen: string | null;
  /** [west, south, east, north] */
  bbox: [number, number, number, number] | null;
}

export interface IncidentStyle {
  color: string;
  weight: number;
  opacity: number;
  fillColor: string;
  fillOpacity: number;
  dashArray?: string;
}

export const INCIDENT_COLORS: Record<IncidentActivity, string> = {
  active: '#f97316',
  inactive: '#a1a1aa',
};

/** YYYY-MM-DD (UTC) `days` before `now`. */
export function windowStartDate(now: Date, days = INCIDENTS_WINDOW_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Fires detected since the window start; static heat sources hidden (the API default, made explicit). */
export function incidentsGeojsonUrl(now: Date = new Date(), days = INCIDENTS_WINDOW_DAYS): string {
  const params = new URLSearchParams({ change_type: 'fire', start_date: windowStartDate(now, days), static_sources: 'exclude' });
  return `/api/monitoring/forest-changes/geojson?${params.toString()}`;
}

/** Only FIRMS clusters; static heat sources (gas flares) never reach the layer, even if sent. */
export function isMapIncident(p: Pick<IncidentFeatureProps, 'method' | 'status'>): boolean {
  return p.method === FIRMS_INCIDENT_METHOD && p.status !== 'static_source';
}

export function incidentActivity(p: Pick<IncidentFeatureProps, 'status'>): IncidentActivity {
  return p.status === 'active' ? 'active' : 'inactive';
}

export function incidentStyle(activity: IncidentActivity, selected = false): IncidentStyle {
  const color = INCIDENT_COLORS[activity];
  const base: IncidentStyle = activity === 'active'
    ? { color, weight: 2, opacity: 0.95, fillColor: color, fillOpacity: 0.25 }
    : { color, weight: 1.5, opacity: 0.8, fillColor: color, fillOpacity: 0.12, dashArray: '4 3' };
  return selected ? { ...base, color: '#facc15', weight: base.weight + 1.5, opacity: 1 } : base;
}

/** Circle radius (px) of the centre point: active incidents are larger. */
export function incidentPointRadius(activity: IncidentActivity): number {
  return activity === 'active' ? 6 : 4.5;
}

export function incidentShape(zoom: number): 'bbox' | 'point' {
  return zoom >= INCIDENT_BBOX_MIN_ZOOM ? 'bbox' : 'point';
}

/** Leaflet-order bounds [[south, west], [north, east]], or null for a missing/invalid bbox. */
export function incidentBounds(p: Pick<IncidentFeatureProps, 'bbox'>): [[number, number], [number, number]] | null {
  const b = p.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const [w, s, e, n] = b;
  if (w > e || s > n || s < -90 || n > 90) return null;
  return [[s, w], [n, e]];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "25.09.2026 04:28 UTC"; '—' for a missing or invalid timestamp. */
export function formatUtc(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} `
    + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

export function incidentCardUrl(id: number): string {
  return `/incidents?id=${encodeURIComponent(String(id))}`;
}

export function describeIncident(p: IncidentFeatureProps): {
  title: string;
  rows: Array<[string, string]>;
  link: { href: string; text: string };
} {
  const activity = incidentActivity(p);
  const count = p.hotspot_count !== null && Number.isFinite(p.hotspot_count) ? String(Math.trunc(p.hotspot_count)) : '—';
  return {
    title: `Термоточки NASA FIRMS, инцидент #${p.id}`,
    rows: [
      ['Тип', 'кластер термоточек (вероятно, пожар растительности)'],
      ['Регион', p.region || '—'],
      ['Первая точка', formatUtc(p.first_seen ?? p.detected_date)],
      ['Последняя точка', formatUtc(p.last_seen)],
      ['Число термоточек', count],
      ['Статус', activity === 'active' ? 'активен' : 'затих'],
    ],
    link: { href: incidentCardUrl(p.id), text: 'Открыть карточку →' },
  };
}
