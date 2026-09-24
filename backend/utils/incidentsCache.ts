/**
 * Last-good cache for the incidents list (GET /api/monitoring/forest-changes).
 *
 * Unlike `cached()` in ./cache.ts, callers here need to know whether a response came from the
 * database just now or from a stored copy, so this stores `{ data, fetched_at }` and never runs
 * the fetcher itself — the route decides live vs. cache and calls `set`/`get` explicitly.
 * No TTL: a stale-but-present copy is what makes degraded mode possible, so it is never expired,
 * only overwritten by the next successful live fetch.
 */
import { getRedis } from '../config/redis';
import type { CacheClient } from './cache';

export interface IncidentsCacheEntry<T> {
  data: T;
  fetched_at: string;
}

type ClientGetter = () => CacheClient | null;

export function createIncidentsCache(getClient: ClientGetter) {
  async function get<T>(key: string): Promise<IncidentsCacheEntry<T> | null> {
    const client = getClient();
    if (!client) return null;
    try {
      const raw = await client.get(key);
      return raw === null ? null : (JSON.parse(raw) as IncidentsCacheEntry<T>);
    } catch (err: any) {
      console.warn(`incidents cache read ${key} failed:`, err.message);
      return null;
    }
  }

  async function set<T>(key: string, data: T, fetchedAt: string = new Date().toISOString()): Promise<void> {
    const client = getClient();
    if (!client) return;
    const entry: IncidentsCacheEntry<T> = { data, fetched_at: fetchedAt };
    try {
      await client.set(key, JSON.stringify(entry));
    } catch (err: any) {
      console.warn(`incidents cache write ${key} failed:`, err.message);
    }
  }

  return { get, set };
}

export const incidentsCache = createIncidentsCache(getRedis);
