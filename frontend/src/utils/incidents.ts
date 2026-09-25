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

/** The incidents page `static` URL param; anything else means the API default (hidden). */
export function parseStaticSources(value: string | null): 'include' | 'only' | undefined {
  return value === 'include' || value === 'only' ? value : undefined;
}

/** Banner shown on the incidents page when the API served a last-good copy instead of live data. */
export function formatCacheBanner(fetchedAt: string): string {
  const date = new Date(fetchedAt);
  const when = Number.isNaN(date.getTime())
    ? fetchedAt
    : date.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
  return `База данных недоступна — показаны данные на ${when}`;
}

/** FIRMS-specific fields of an incident created by the backend clustering job (metadata.method). */
export interface FirmsIncidentInfo {
  hotspotCount: number;
  active: boolean;
  /** metadata.status 'static_source': all hotspots at a place that burns day after day (gas flare). */
  staticSource: boolean;
  statusLabel: string;
  firstSeen: string | null;
  lastSeen: string | null;
  frpMax: number | null;
  /** "NASA FIRMS, кластер N термоточек" */
  sourceLabel: string;
}

export const FIRMS_AREA_NOTE = 'оценка по пикселям 375 м, сверху';
export const STATIC_SOURCE_LABEL = 'Постоянный источник тепла (факел/промышленность)';

/** Explains a static-source incident; uses the thresholds stored with it when present. */
export function staticSourceNote(incident: Incident): string {
  const mask = incident.metadata?.static_mask as Record<string, unknown> | undefined;
  const minDays = Number(mask?.min_days);
  const windowDays = Number(mask?.window_days);
  const spanDays = Number(mask?.min_span_days);
  const span = Number.isFinite(spanDays) && spanDays > 0 ? `, разнесённых не менее чем на ${spanDays} дней` : '';
  const rule = Number.isFinite(minDays) && Number.isFinite(windowDays) && minDays > 0 && windowDays > 0
    ? `не менее ${minDays} дней из ${windowDays}${span}`
    : 'изо дня в день';
  return `Термоточки на этом месте фиксируются ${rule} — вероятно, газовый факел или промышленный объект, а не лесной пожар`;
}

/** Russian plural: 1 термоточка, 2 термоточки, 5 термоточек. */
export function pluralHotspots(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'термоточка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'термоточки';
  return 'термоточек';
}

/** Null for anything that is not a FIRMS cluster incident (seed data, other sources). */
export function firmsIncidentInfo(incident: Incident): FirmsIncidentInfo | null {
  const m = incident.metadata;
  if (!m || m.method !== 'firms-cluster-v1') return null;
  const count = Number(m.hotspot_count);
  const hotspotCount = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
  const active = m.status === 'active';
  const staticSource = m.status === 'static_source';
  const frp = Number(m.frp_max);
  return {
    hotspotCount,
    active,
    staticSource,
    statusLabel: staticSource ? STATIC_SOURCE_LABEL : active ? 'Активен' : 'Затих',
    firstSeen: typeof m.first_seen === 'string' ? m.first_seen : null,
    lastSeen: typeof m.last_seen === 'string' ? m.last_seen : null,
    frpMax: m.frp_max != null && Number.isFinite(frp) ? frp : null,
    sourceLabel: `NASA FIRMS, кластер ${hotspotCount} ${pluralHotspots(hotspotCount)}`,
  };
}

/** Date-time in the viewer's locale time zone, or '—' for a missing/invalid value. */
export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * "Обнаружено" date. For FIRMS incidents it is the first hotspot's date in the viewer's time zone,
 * so it matches the first/last hotspot times shown next to it (detected_date is a UTC date).
 */
export function detectedDateLabel(incident: Incident): string {
  const firstSeen = firmsIncidentInfo(incident)?.firstSeen;
  const d = new Date(firstSeen ?? incident.detected_date);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
}
