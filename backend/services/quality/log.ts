/**
 * Quality log: the latest result of every gate per source, so a rejection is visible without
 * reading server logs.
 *
 * - In memory: the latest result per check, counters since process start, and the results not yet
 *   written to the load journal (drained by the background job, see jobs/refresh.ts).
 * - In Redis (hash `quality:<source>`, field = check): the latest result and the last rejection,
 *   so /api/sources/status shows them after a restart. Tiles are checked on every request, so a
 *   check is written at most every PERSIST_EVERY_MS unless its ok/failed state flips.
 */
import { getRedis } from '../../config/redis';
import type { QualityResult } from './result';

export interface QualityCheckState {
  check: string;
  last: QualityResult;
  lastRejection: QualityResult | null;
  /** Counters since the app started (null when read back from Redis after a restart). */
  since: string | null;
  checks: number | null;
  rejections: number | null;
}

export interface QualityHashClient {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export const PERSIST_EVERY_MS = 10 * 60 * 1000;
const KEY_TTL_SEC = 60 * 24 * 60 * 60;
const qualityKey = (source: string) => `quality:${source}`;

/** Write when nothing was written yet, when ok ⇄ failed flipped, or when the last write is old. */
export function shouldPersist(prev: { ok: boolean; at: number } | undefined, ok: boolean, now: number): boolean {
  return !prev || prev.ok !== ok || now - prev.at >= PERSIST_EVERY_MS;
}

/** Journal fields for the results of one run: dropped items in total, reasons of rejected inputs. */
export function summarizeForJournal(results: QualityResult[]): { rejected: number; failures: string[] } {
  return {
    rejected: results.reduce((sum, r) => sum + r.rejected, 0),
    failures: results.filter(r => !r.ok).map(r => `${r.check}: ${r.reason ?? 'rejected'}`),
  };
}

export function createQualityLog(getClient: () => QualityHashClient | null, startedAt = new Date()) {
  const states = new Map<string, Map<string, QualityCheckState>>();
  const pending = new Map<string, Map<string, QualityResult>>();
  const persisted = new Map<string, { ok: boolean; at: number }>();

  async function persist(source: string, state: QualityCheckState): Promise<void> {
    const client = getClient();
    if (!client) return;
    try {
      const { last, check } = state;
      // After a restart the stored last rejection must survive the first ok result
      if (!state.lastRejection) {
        const stored = (await client.hgetall(qualityKey(source)))?.[check];
        state.lastRejection = stored ? (JSON.parse(stored) as Pick<QualityCheckState, 'lastRejection'>).lastRejection ?? null : null;
      }
      const { lastRejection } = state;
      await client.hset(qualityKey(source), check, JSON.stringify({ check, last, lastRejection }));
      await client.expire(qualityKey(source), KEY_TTL_SEC);
    } catch (err: any) {
      console.warn(`quality write ${source}/${state.check} failed:`, err.message);
    }
  }

  /** Records one gate result. Never throws; Redis writes are throttled and not awaited by callers. */
  function report(result: QualityResult, now = Date.now()): Promise<void> {
    const bySource = states.get(result.source) ?? new Map<string, QualityCheckState>();
    states.set(result.source, bySource);
    const prev = bySource.get(result.check);
    const state: QualityCheckState = {
      check: result.check,
      last: result,
      lastRejection: result.ok ? prev?.lastRejection ?? null : result,
      since: startedAt.toISOString(),
      checks: (prev?.checks ?? 0) + 1,
      rejections: (prev?.rejections ?? 0) + (result.ok ? 0 : 1),
    };
    bySource.set(result.check, state);

    const queue = pending.get(result.source) ?? new Map<string, QualityResult>();
    pending.set(result.source, queue);
    queue.set(result.check, result);

    if (!result.ok) console.warn(`[quality] ${result.source}/${result.check} rejected: ${result.reason}`);
    else if (result.rejected > 0) console.warn(`[quality] ${result.source}/${result.check}: ${result.rejected} of ${result.total} dropped${result.reason ? ` (${result.reason})` : ''}`);

    const persistKey = `${result.source}/${result.check}`;
    if (!shouldPersist(persisted.get(persistKey), result.ok, now)) return Promise.resolve();
    persisted.set(persistKey, { ok: result.ok, at: now });
    return persist(result.source, state);
  }

  /** Results reported since the previous drain (latest per check), for one journal entry. */
  function drain(source: string): QualityResult[] {
    const queue = pending.get(source);
    pending.delete(source);
    return queue ? [...queue.values()] : [];
  }

  /** Latest state of every check of a source: this process first, Redis for checks not seen yet. */
  async function read(source: string): Promise<QualityCheckState[]> {
    const merged = new Map<string, QualityCheckState>();
    const client = getClient();
    if (client) {
      try {
        const stored = await client.hgetall(qualityKey(source));
        for (const [check, raw] of Object.entries(stored ?? {})) {
          const parsed = JSON.parse(raw) as Pick<QualityCheckState, 'check' | 'last' | 'lastRejection'>;
          merged.set(check, { ...parsed, check, since: null, checks: null, rejections: null });
        }
      } catch (err: any) {
        console.warn(`quality read ${source} failed:`, err.message);
      }
    }
    for (const [check, state] of states.get(source) ?? []) {
      merged.set(check, { ...state, lastRejection: state.lastRejection ?? merged.get(check)?.lastRejection ?? null });
    }
    return [...merged.values()].sort((a, b) => a.check.localeCompare(b.check));
  }

  return { report, drain, read };
}

const log = createQualityLog(() => getRedis());

/** Records a gate result (fire and forget — the Redis write never delays or fails a request). */
export function reportQuality(result: QualityResult): void {
  void log.report(result);
}

export const drainQuality = log.drain;
export const readQuality = log.read;
