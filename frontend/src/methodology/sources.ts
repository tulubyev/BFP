/** Source registry for the methodology page, from GET /api/sources/status (backend/services/sourceStatus.ts). */
import { formatFreshnessLabel, type SourceState } from '../map/sourcesStatus';

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
}

export const STATE_LABEL: Record<SourceState, string> = {
  fresh: 'данные актуальны',
  stale: 'данные устарели',
  failed: 'источник недоступен',
  unknown: 'свежесть не отслеживается',
};

/** «данные актуальны, 12 мин назад» / «свежесть не отслеживается». */
export function freshnessText(source: MethodologySource): string {
  const label = STATE_LABEL[source.state] ?? STATE_LABEL.unknown;
  return source.freshness ? `${label}, ${formatFreshnessLabel(source)}` : label;
}

export async function fetchMethodologySources(): Promise<MethodologySource[]> {
  const res = await fetch('/api/sources/status');
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success || !Array.isArray(body.sources)) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body.sources as MethodologySource[];
}
