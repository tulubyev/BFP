/**
 * Redis-backed cache for external data sources.
 *
 * Keeps two keys per entry: `key` (expires after ttl) and `key:last-good` (no expiry).
 * When the source fails or returns invalid data, the last good value is served instead.
 * If Redis is unavailable the fetcher is called directly — the cache never breaks a request.
 * `warm()` refreshes an entry ahead of time (background jobs), so readers rarely see a miss.
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

type ClientGetter = () => CacheClient | null;

async function readJson<T>(getClient: ClientGetter, key: string): Promise<T | null> {
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

async function writeJson(getClient: ClientGetter, key: string, value: unknown, ttlSec: number): Promise<void> {
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

/** Runs the fetcher; returns the value only if it is valid, otherwise throws. */
async function fetchValid<T>(key: string, fetcher: () => Promise<T>, opts: CachedOptions<T>): Promise<T> {
  const value = await fetcher();
  if (opts.isValid && !opts.isValid(value)) throw new Error(`Invalid data from source for ${key}`);
  return value;
}

export function createCache(getClient: ClientGetter) {
  const inFlight = new Map<string, Promise<unknown>>();

  async function refresh<T>(key: string, ttlSec: number, fetcher: () => Promise<T>, opts: CachedOptions<T>): Promise<T> {
    try {
      const value = await fetchValid(key, fetcher, opts);
      await writeJson(getClient, key, value, ttlSec);
      return value;
    } catch (failure: any) {
      const lastGood = await readJson<T>(getClient, `${key}:last-good`);
      if (lastGood !== null) {
        console.warn(`${key}: serving last-good value (${failure.message})`);
        return lastGood;
      }
      throw failure;
    }
  }

  return async function cached<T>(
    key: string,
    ttlSec: number,
    fetcher: () => Promise<T>,
    opts: CachedOptions<T> = {},
  ): Promise<T> {
    const fresh = await readJson<T>(getClient, key);
    if (fresh !== null) return fresh;

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = refresh(key, ttlSec, fetcher, opts).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}

export function createWarm(getClient: ClientGetter) {
  /** Fetches and stores a new value even if the current one is fresh. Never throws; false = kept old value. */
  return async function warm<T>(
    key: string,
    ttlSec: number,
    fetcher: () => Promise<T>,
    opts: CachedOptions<T> = {},
  ): Promise<boolean> {
    try {
      const value = await fetchValid(key, fetcher, opts);
      await writeJson(getClient, key, value, ttlSec);
      return true;
    } catch (err: any) {
      console.warn(`warm ${key} failed, keeping cached value:`, err.message);
      return false;
    }
  };
}

export const cached = createCache(getRedis);
export const warm = createWarm(getRedis);
