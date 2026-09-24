import { createCache, type CacheClient } from '../../backend/utils/cache';

class FakeRedis implements CacheClient {
  store = new Map<string, string>();
  setCalls: unknown[][] = [];
  failing = false;

  async get(key: string): Promise<string | null> {
    if (this.failing) throw new Error('redis down');
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    if (this.failing) throw new Error('redis down');
    this.setCalls.push([key, value, ...args]);
    this.store.set(key, value);
    return 'OK';
  }
}

describe('cached()', () => {
  let redis: FakeRedis;
  let cached: ReturnType<typeof createCache>;

  beforeEach(() => {
    redis = new FakeRedis();
    cached = createCache(() => redis);
  });

  it('returns a fresh cached value without calling the fetcher', async () => {
    redis.store.set('k', JSON.stringify({ n: 1 }));
    const fetcher = jest.fn();
    await expect(cached('k', 60, fetcher)).resolves.toEqual({ n: 1 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('on a miss stores the value with TTL and as last-good', async () => {
    const value = await cached('k', 60, async () => [1, 2]);
    expect(value).toEqual([1, 2]);
    expect(redis.setCalls).toContainEqual(['k', '[1,2]', 'EX', 60]);
    expect(redis.setCalls).toContainEqual(['k:last-good', '[1,2]']);
  });

  it('falls back to last-good when the fetcher throws', async () => {
    redis.store.set('k:last-good', JSON.stringify(['old']));
    await expect(cached('k', 60, async () => { throw new Error('source down'); })).resolves.toEqual(['old']);
  });

  it('falls back to last-good and keeps it when the result is invalid', async () => {
    redis.store.set('k:last-good', JSON.stringify(['old']));
    const value = await cached('k', 60, async () => [] as string[], { isValid: v => v.length > 0 });
    expect(value).toEqual(['old']);
    expect(redis.store.get('k:last-good')).toBe(JSON.stringify(['old']));
    expect(redis.store.has('k')).toBe(false);
  });

  it('rejects when the fetcher fails and there is no last-good', async () => {
    await expect(cached('k', 60, async () => { throw new Error('source down'); })).rejects.toThrow('source down');
  });

  it('rejects when the result is invalid and there is no last-good', async () => {
    await expect(cached('k', 60, async () => [], { isValid: v => v.length > 0 })).rejects.toThrow(/invalid/i);
  });

  it('still serves fetcher data when redis is failing', async () => {
    redis.failing = true;
    await expect(cached('k', 60, async () => 'fresh')).resolves.toBe('fresh');
  });

  it('works without a redis client', async () => {
    const noRedis = createCache(() => null);
    await expect(noRedis('k', 60, async () => 'fresh')).resolves.toBe('fresh');
  });

  it('runs the fetcher once for concurrent misses on the same key', async () => {
    let release!: (v: string) => void;
    const fetcher = jest.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const a = cached('k', 60, fetcher);
    const b = cached('k', 60, fetcher);
    await new Promise(r => setImmediate(r));
    release('once');
    await expect(Promise.all([a, b])).resolves.toEqual(['once', 'once']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
