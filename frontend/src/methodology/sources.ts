/** Source registry for the methodology page, from GET /api/sources/status (backend/services/sourceStatus.ts). */
import { detailText, stateText, type SourceAccess, type SourceSignal, type SourceState } from '../map/sourcesStatus';

export interface MethodologySource {
  id: string;
  name: string;
  owner: string;
  license: { name: string; url: string };
  homepage: string;
  updateFrequency: string;
  spatialResolution: string;
  coverage: string;
  limitations: string[];
  cadence?: 'annual' | null;
  state: SourceState;
  freshness: { timestamp: string; ageMs: number } | null;
  signals?: SourceSignal[];
  access?: SourceAccess | null;
  version?: string | null;
}

export const STATE_LABEL: Record<SourceState, string> = {
  fresh: 'данные актуальны',
  stale: 'данные устарели',
  failed: 'источник недоступен',
  unknown: 'свежесть не отслеживается',
};

/**
 * «данные актуальны, 12 мин назад» / «источник недоступен для нас, последний успешный запрос
 * 4 дн назад» / «свежесть не отслеживается». Without `signals` (older API) — STATE_LABEL.
 */
export function freshnessText(source: MethodologySource): string {
  const label = source.signals ? stateText(source) : (STATE_LABEL[source.state] ?? STATE_LABEL.unknown);
  const detail = detailText(source);
  return detail ? `${label}, ${detail}` : label;
}

export async function fetchMethodologySources(): Promise<MethodologySource[]> {
  const res = await fetch('/api/sources/status');
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success || !Array.isArray(body.sources)) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body.sources as MethodologySource[];
}
