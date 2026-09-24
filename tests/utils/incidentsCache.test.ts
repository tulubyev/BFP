import { createIncidentsCache } from '../../backend/utils/incidentsCache';
import type { CacheClient } from '../../backend/utils/cache';

class FakeRedis implements CacheClient {
  store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, value);
    return 'OK';
  }
}

describe('incidentsCache', () => {
  let redis: FakeRedis;
  let cache: ReturnType<typeof createIncidentsCache>;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = createIncidentsCache(() => redis);
  });

  it('returns null on a miss', async () => {
    await expect(cache.get('k')).resolves.toBeNull();
  });

  it('round-trips data with an explicit fetched_at', async () => {
    await cache.set('k', { total: 3 }, '2026-09-24T10:00:00.000Z');
    await expect(cache.get('k')).resolves.toEqual({ data: { total: 3 }, fetched_at: '2026-09-24T10:00:00.000Z' });
  });

  it('defaults fetched_at to now when not given', async () => {
    const before = Date.now();
    await cache.set('k', { total: 1 });
    const entry = await cache.get<{ total: number }>('k');
    expect(entry).not.toBeNull();
    expect(new Date(entry!.fetched_at).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('is a no-op without a client', async () => {
    const noRedis = createIncidentsCache(() => null);
    await expect(noRedis.set('k', { a: 1 })).resolves.toBeUndefined();
    await expect(noRedis.get('k')).resolves.toBeNull();
  });

  it('treats a read/write failure as a miss instead of throwing', async () => {
    const failing: CacheClient = {
      get: async () => { throw new Error('redis down'); },
      set: async () => { throw new Error('redis down'); },
    };
    const cacheWithFailingClient = createIncidentsCache(() => failing);
    await expect(cacheWithFailingClient.set('k', { a: 1 })).resolves.toBeUndefined();
    await expect(cacheWithFailingClient.get('k')).resolves.toBeNull();
  });
});
