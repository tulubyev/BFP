import { fetchForestChanges, createForestChangesHandler, REGIONS_QUERY, QueryablePool, IncidentsCacheLike, ForestChangesResult } from '../../backend/services/incidentsService';
import { forestChangesCacheKey } from '../../backend/services/forestChangesQuery';

function fakePool(overrides: Partial<{ rows: any[]; total: number; regions: string[]; fail: boolean }> = {}): QueryablePool {
  const { rows = [{ id: 1 }], total = 1, regions = ['Иркутская область'], fail = false } = overrides;
  return {
    query: jest.fn(async (text: string) => {
      if (fail) throw new Error('connection refused');
      if (text.includes('COUNT(*)')) return { rows: [{ count: total }] };
      if (text.includes('DISTINCT region')) return { rows: regions.map(region => ({ region })) };
      return { rows };
    }),
  };
}

describe('fetchForestChanges', () => {
  it('returns the page, total and region list from three queries', async () => {
    const pool = fakePool({ rows: [{ id: 1 }, { id: 2 }], total: 42, regions: ['Бурятия', 'Иркутская область'] });
    const result = await fetchForestChanges(pool, { limit: '2' });
    expect(result).toEqual({
      success: true,
      count: 2,
      total: 42,
      limit: 2,
      offset: 0,
      regions: ['Бурятия', 'Иркутская область'],
      data: [{ id: 1 }, { id: 2 }],
    });
  });

  it('rejects when the pool fails', async () => {
    const pool = fakePool({ fail: true });
    await expect(fetchForestChanges(pool, {})).rejects.toThrow('connection refused');
  });
});

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

function fakeCache(initial: Record<string, { data: any; fetched_at: string }> = {}): IncidentsCacheLike & { store: typeof initial } {
  const store = { ...initial };
  return {
    store,
    async get<T>(key: string) {
      return (store[key] as any) ?? null;
    },
    async set<T>(key: string, data: T, fetchedAt = new Date().toISOString()) {
      store[key] = { data, fetched_at: fetchedAt };
    },
  };
}

describe('createForestChangesHandler', () => {
  it('responds mode: live and caches the result on success', async () => {
    const pool = fakePool({ rows: [{ id: 1 }], total: 1 });
    const cache = fakeCache();
    const handler = createForestChangesHandler(pool, cache);
    const req = { query: { change_type: 'fire' } } as any;
    const res = fakeRes();

    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe('live');
    expect(res.body.success).toBe(true);
    expect(Object.keys(cache.store)).toHaveLength(1);
  });

  it('serves the last-good cached result with mode: cache when the DB fails', async () => {
    const pool = fakePool({ fail: true });
    const cachedResult: ForestChangesResult = {
      success: true, count: 1, total: 1, limit: 12, offset: 0, regions: ['Бурятия'], data: [{ id: 9 }],
    };
    const req = { query: { change_type: 'fire' } } as any;
    // Prime the cache using the same key the handler will compute.
    const cache = fakeCache();
    await cache.set(forestChangesCacheKey(req.query), cachedResult, '2026-09-20T08:00:00.000Z');
    const handler = createForestChangesHandler(pool, cache);
    const res = fakeRes();

    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...cachedResult, mode: 'cache', fetched_at: '2026-09-20T08:00:00.000Z' });
  });

  it('does not use a cache entry from a different, non-matching query', async () => {
    const pool = fakePool({ fail: true });
    const cache = fakeCache();
    await cache.set(forestChangesCacheKey({ change_type: 'fire' }), { success: true, count: 1, total: 1, limit: 12, offset: 0, regions: [], data: [{ id: 1 }] }, '2026-09-20T08:00:00.000Z');
    const handler = createForestChangesHandler(pool, cache);
    const req = { query: { change_type: 'logging' } } as any;
    const res = fakeRes();

    await handler(req, res as any);

    expect(res.statusCode).toBe(503);
  });

  it('returns 503 with a clear error when the DB fails and nothing is cached', async () => {
    const pool = fakePool({ fail: true });
    const cache = fakeCache();
    const handler = createForestChangesHandler(pool, cache);
    const req = { query: {} } as any;
    const res = fakeRes();

    await handler(req, res as any);

    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body.mode).toBeUndefined();
  });

  it('never falls back to demo/sample data: an uncached failure never returns a 200 with fabricated rows', async () => {
    const pool = fakePool({ fail: true });
    const cache = fakeCache();
    const handler = createForestChangesHandler(pool, cache);
    const req = { query: {} } as any;
    const res = fakeRes();

    await handler(req, res as any);

    expect(res.statusCode).not.toBe(200);
  });
});

describe('REGIONS_QUERY', () => {
  it('lists forest-area regions and regions stored on incidents (FIRMS)', () => {
    expect(REGIONS_QUERY).toContain('FROM gis.forest_areas');
    expect(REGIONS_QUERY).toContain("metadata->>'region'");
    expect(REGIONS_QUERY).toMatch(/ORDER BY region$/);
  });
});
