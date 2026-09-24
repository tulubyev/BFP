/**
 * Redis-backed cache for external data sources.
 *
 * Keeps two keys per entry: `key` (expires after ttl) and `key:last-good` (no expiry).
 * When the source fails or returns invalid data, the last good value is served instead.
 * If Redis is unavailable the fetcher is called directly — the cache never breaks a request.
 */
import { getRedis } from '../config/redis';

export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
}

export interface CachedOptions<T> {
  /** Reject results that must not replace a good value (e.g. an empty list). */
  isValid?: (value: T) => boolean;
}

export function createCache(getClient: () => CacheClient | null) {
  const inFlight = new Map<string, Promise<unknown>>();

  async function read<T>(key: string): Promise<T | null> {
    const client = getClient();
    if (!client) return null;
    try {
      const raw = await client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (err: any) {
      console.warn(`cache read ${key} failed:`, err.message);
      return null;
    }
  }

  async function write(key: string, value: unknown, ttlSec: number): Promise<void> {
    const client = getClient();
    if (!client) return;
    const raw = JSON.stringify(value);
    try {
      await client.set(key, raw, 'EX', ttlSec);
      await client.set(`${key}:last-good`, raw);
    } catch (err: any) {
      console.warn(`cache write ${key} failed:`, err.message);
    }
  }

  async function refresh<T>(key: string, ttlSec: number, fetcher: () => Promise<T>, opts: CachedOptions<T>): Promise<T> {
    let failure: Error;
    try {
      const value = await fetcher();
      if (!opts.isValid || opts.isValid(value)) {
        await write(key, value, ttlSec);
        return value;
      }
      failure = new Error(`Invalid data from source for ${key}`);
    } catch (err: any) {
      failure = err;
    }
    const lastGood = await read<T>(`${key}:last-good`);
    if (lastGood !== null) {
      console.warn(`${key}: serving last-good value (${failure.message})`);
      return lastGood;
    }
    throw failure;
  }

  return async function cached<T>(
    key: string,
    ttlSec: number,
    fetcher: () => Promise<T>,
    opts: CachedOptions<T> = {},
  ): Promise<T> {
    const fresh = await read<T>(key);
    if (fresh !== null) return fresh;

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = refresh(key, ttlSec, fetcher, opts).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}

export const cached = createCache(getRedis);
