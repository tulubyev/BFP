/**
 * Records whether on-demand requests to a source (GFW tiles, the Sentinel-2 catalogue) reach it,
 * for /api/sources/status. Throttled in memory: at most one success and one failure per source
 * every 10 minutes reach Redis, however many tiles the map asks for. The throttle is per outcome,
 * so a failure right after a recorded success (and the recovery after it) is never swallowed.
 */
import { recordAccess } from '../utils/journal';
import type { GfwLayer } from './gfwTileLayers';
import type { SourceId } from './sourceRegistry';

export const ACCESS_RECORD_INTERVAL_MS = 10 * 60 * 1000;

export type AccessOutcome = 'ok' | 'failed';

/** Which registry source a /tiles/gfw layer comes from. */
export const GFW_TILE_SOURCE: Record<GfwLayer, SourceId> = {
  loss: 'gfw_loss',
  cover: 'gfw_cover',
  dist: 'gfw_dist',
};

/** In-memory "may this outcome be written now" gate. Pure apart from its own map. */
export function createAccessThrottle(intervalMs: number = ACCESS_RECORD_INTERVAL_MS) {
  const last = new Map<string, number>();
  return {
    shouldRecord(source: string, outcome: AccessOutcome, nowMs: number): boolean {
      const key = `${source}:${outcome}`;
      const prev = last.get(key);
      if (prev !== undefined && nowMs - prev < intervalMs && nowMs >= prev) return false;
      last.set(key, nowMs);
      return true;
    },
    reset(): void {
      last.clear();
    },
  };
}

const throttle = createAccessThrottle();

/** Test hook: forget what was recorded. */
export function resetAccessThrottle(): void {
  throttle.reset();
}

function errorText(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Fire-and-forget: never throws and never delays the request that triggered it. Returns the write
 * (or a resolved promise when throttled) so tests can await it.
 */
export function recordSourceAccess(source: SourceId, outcome: AccessOutcome, err?: unknown, now: Date = new Date()): Promise<void> {
  if (!throttle.shouldRecord(source, outcome, now.getTime())) return Promise.resolve();
  return recordAccess(source, outcome === 'ok', now, outcome === 'failed' ? errorText(err) : undefined).catch(() => undefined);
}
