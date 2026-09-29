/** Pure logic for the "Источники данных" control — no Leaflet import, safe to unit-test directly. */

export type SourceState = 'fresh' | 'stale' | 'failed' | 'unknown';

/** One input to `state` (backend/services/sourceStatus.ts SourceSignal). */
export interface SourceSignal {
  /** 'data' = age of the source's own data, 'access' = whether our downloads/requests reach it. */
  kind: 'data' | 'access';
  state: SourceState;
}

/** On-demand access record: GFW tiles, the Sentinel-2 catalogue. */
export interface SourceAccess {
  state: SourceState;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failingSince: string | null;
  lastError?: string;
  lastSuccessAgeMs: number | null;
}

export interface SourceStatusEntry {
  id: string;
  name: string;
  state: SourceState;
  freshness: { timestamp: string; ageMs: number } | null;
  /** 'annual' sources are labeled with their publication date, not a relative age (see below). */
  cadence?: 'annual' | null;
  signals?: SourceSignal[];
  access?: SourceAccess | null;
  /** Dataset version: "2026-09" (boundaries), "v1.13", "v20260920". */
  version?: string | null;
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

/** A month-granular version ("2026-09"): the version itself says more than an age in days. */
const MONTH_VERSION_RE = /^\d{4}-\d{2}$/;

/**
 * "17.06.2026, годовые данные" for annual-cadence sources (a relative age like "99 дн назад"
 * would read as alarming for data that is normal for up to ~a year), "версия 2026-09" for a
 * monthly-versioned file, "5 мин назад" otherwise (plus the version, when known).
 */
export function formatFreshnessLabel(entry: SourceStatusEntry): string {
  if (!entry.freshness) return 'нет данных';
  if (entry.cadence === 'annual') {
    const d = new Date(entry.freshness.timestamp);
    const date = `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
    return `опубликовано ${date}, годовые данные`;
  }
  if (entry.version && MONTH_VERSION_RE.test(entry.version)) return `версия ${entry.version}`;
  const age = formatRelativeAge(entry.freshness.ageMs);
  return entry.version ? `${age}, версия ${entry.version}` : age;
}

/**
 * Which kind of signal made the state what it is: 'access' when our own requests/downloads are
 * failing («источник недоступен для нас»), 'data' when the source's data is old («данные
 * устарели»). Null for a fresh/unknown state or a response without signals (older backend).
 */
export function stateReason(entry: SourceStatusEntry): 'data' | 'access' | null {
  if (entry.state !== 'stale' && entry.state !== 'failed') return null;
  const signals = entry.signals ?? [];
  if (signals.some(s => s.kind === 'access' && s.state === entry.state)) return 'access';
  if (signals.some(s => s.kind === 'data' && s.state === entry.state)) return 'data';
  return null;
}

/** Fallback wording when the response carries no signals. */
const LEGACY_STATE_TEXT: Record<SourceState, string> = {
  fresh: 'данные актуальны',
  stale: 'данные устарели',
  failed: 'источник недоступен',
  unknown: 'свежесть не отслеживается',
};

/** What the state means for this source, in words. */
export function stateText(entry: SourceStatusEntry): string {
  const signals = entry.signals;
  if (!signals) return LEGACY_STATE_TEXT[entry.state] ?? LEGACY_STATE_TEXT.unknown;
  const hasData = signals.some(s => s.kind === 'data');
  const hasAccess = signals.some(s => s.kind === 'access');
  switch (entry.state) {
    case 'fresh':
      return hasData ? 'данные актуальны' : 'источник доступен';
    case 'stale':
      return stateReason(entry) === 'access' ? 'сбои при обращении к источнику' : 'данные устарели';
    case 'failed':
      return stateReason(entry) === 'access' ? 'источник недоступен для нас' : 'данные давно не обновлялись';
    default:
      return hasAccess && !hasData ? 'обращений к источнику пока не было' : LEGACY_STATE_TEXT.unknown;
  }
}

/** "последний успешный запрос 5 мин назад" / "успешных запросов не было". */
export function accessLabel(access: SourceAccess): string {
  return access.lastSuccessAgeMs !== null
    ? `последний успешный запрос ${formatRelativeAge(access.lastSuccessAgeMs)}`
    : 'успешных запросов не было';
}

/** Details after the state: data date/version and, where it matters, our last successful request. */
export function detailText(entry: SourceStatusEntry): string | null {
  const parts: string[] = [];
  if (entry.freshness) parts.push(formatFreshnessLabel(entry));
  if (entry.access && (!entry.freshness || stateReason(entry) === 'access')) parts.push(accessLabel(entry.access));
  if (!entry.freshness && entry.version) parts.push(`версия ${entry.version}`);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Map control row: the details alone while all is well, the state in words in front of them
 * otherwise, so "stale data" and "we cannot reach the source" never look the same.
 */
export function sourceRowLabel(entry: SourceStatusEntry): string {
  const detail = detailText(entry);
  if (entry.state === 'fresh' && detail) return detail;
  return detail ? `${stateText(entry)}, ${detail}` : stateText(entry);
}
