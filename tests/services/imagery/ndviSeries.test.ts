import {
  FAILURE_COOLDOWN_MS, MAX_SERIES_JOBS, MAX_SERIES_RUNNING, createNdviSeries, type NdviSeriesDeps, type YearStore,
} from '../../../backend/services/imagery/ndviSeries';
import { seriesKey, seriesTarget, yearKey, type SeriesTarget, type SeriesYear } from '../../../backend/services/imagery/series';
import { createCache } from '../../../backend/utils/cache';
import { QueueFullError, createLimiter } from '../../../backend/utils/limiter';
import type { Bbox } from '../../../backend/services/imagery/geometry';

const BBOX: Bbox = [103.05, 53.6, 103.09, 53.63];
const TARGET = seriesTarget(BBOX);
// A short series: 2017–2020, the "current" year 2020 with its window over
const NOW = new Date('2020-09-10T00:00:00Z');
const YEARS = [2017, 2018, 2019, 2020];

const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 20; i++) await tick(); }

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const ok = (year: number, ndvi = 0.7): SeriesYear => ({
  year, status: 'ok', sceneId: `S2A_T48UUE_${year}0715T043045_L2A`, datetime: `${year}-07-15T04:33:00Z`, platform: 'Sentinel-2A',
  clearPct: 99, site: { ndvi, validPct: 100 }, background: { ndvi: 0.75, validPct: 100 },
});

function memoryStore(): YearStore & { map: Map<string, { value: SeriesYear; ttl: number }> } {
  const map = new Map<string, { value: SeriesYear; ttl: number }>();
  return { map, get: async k => map.get(k)?.value ?? null, set: async (k, value, ttl) => { map.set(k, { value, ttl }); } };
}

/** cached() over an in-memory "Redis" (keeps last-good like production). */
function memoryCached() {
  const kv = new Map<string, string>();
  const client = { get: async (k: string) => kv.get(k) ?? null, set: async (k: string, v: string) => { kv.set(k, v); return 'OK'; } };
  return { kv, cached: createCache(() => client) };
}

function setup(overrides: Partial<NdviSeriesDeps> = {}) {
  const store = memoryStore();
  const { kv, cached } = memoryCached();
  let now = NOW;
  const computeYear = jest.fn(async (_t: SeriesTarget, year: number) => ok(year));
  const series = createNdviSeries({
    store, computeYear, cachedSeries: (k, ttl, f) => cached(k, ttl, f), now: () => now, ...overrides,
  });
  return { series, store, kv, computeYear, setNow: (d: Date) => { now = d; } };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('createNdviSeries', () => {
  it('first request answers pending at once and queues the job; later ones are ready', async () => {
    const gate = deferred<void>();
    const { series, computeYear, store, kv } = setup();
    computeYear.mockImplementation(async (_t, year) => { await gate.promise; return ok(year); });

    const first = await series.get(82, BBOX);
    expect(first).toMatchObject({ incidentId: 82, status: 'pending', years: [], progress: { done: 0, total: YEARS.length } });
    expect(first.aoi).toEqual(TARGET.aoi);
    expect(first.site).toEqual(TARGET.site);
    expect(first.window).toEqual({ start: '07-01', end: '08-31' });
    expect(series.jobs).toBe(1);

    // Polling while it runs does not start another job
    expect((await series.get(82, BBOX)).status).toBe('pending');
    expect(series.jobs).toBe(1);

    gate.resolve();
    await settle();
    expect(computeYear).toHaveBeenCalledTimes(YEARS.length);
    expect(series.jobs).toBe(0);

    const ready = await series.get(82, BBOX);
    expect(ready.status).toBe('ready');
    expect(ready.years.map(y => y.year)).toEqual(YEARS);
    expect(ready.progress).toEqual({ done: 4, total: 4 });
    expect(ready.source.attribution).toBe('Contains modified Copernicus Sentinel data 2017, 2018, 2019, 2020');
    // per-year keys with their TTLs; the whole series cached
    expect(store.map.get(yearKey(TARGET, 2017))?.ttl).toBe(365 * 86_400);
    expect(store.map.get(yearKey(TARGET, 2020))?.ttl).toBe(7 * 86_400);
    expect(kv.has(seriesKey(TARGET))).toBe(true);
    // served from the cache: nothing recomputed
    await series.get(82, BBOX);
    expect(computeYear).toHaveBeenCalledTimes(YEARS.length);
  });

  it('reports progress while years finish', async () => {
    const gates = new Map(YEARS.map(y => [y, deferred<void>()]));
    const { series, computeYear } = setup({ yearConcurrency: 1 });
    computeYear.mockImplementation(async (_t, year) => { await gates.get(year)!.promise; return ok(year); });
    await series.get(1, BBOX);
    gates.get(2017)!.resolve();
    await settle();
    const mid = await series.get(1, BBOX);
    expect(mid).toMatchObject({ status: 'pending', progress: { done: 1, total: 4 } });
    expect(mid.years.map(y => y.year)).toEqual([2017]);
    YEARS.forEach(y => gates.get(y)!.resolve());
    await settle();
    expect((await series.get(1, BBOX)).status).toBe('ready');
  });

  it('computes only the years missing from the store', async () => {
    const { series, store, computeYear } = setup();
    const gate = deferred<void>();
    computeYear.mockImplementation(async (_t, year) => { await gate.promise; return ok(year); });
    await store.set(yearKey(TARGET, 2017), ok(2017), 1);
    await store.set(yearKey(TARGET, 2018), { year: 2018, status: 'none', reason: 'нет безоблачных снимков' }, 1);
    const first = await series.get(5, BBOX);
    expect(first.progress).toEqual({ done: 2, total: 4 });
    gate.resolve();
    await settle();
    expect(computeYear.mock.calls.map(c => c[1]).sort()).toEqual([2019, 2020]);
    const ready = await series.get(5, BBOX);
    expect(ready.years.find(y => y.year === 2018)).toEqual({ year: 2018, status: 'none', reason: 'нет безоблачных снимков' });
  });

  it('a failed year is not stored; after the cooldown a request retries only it', async () => {
    const { series, store, computeYear, setNow, kv } = setup();
    computeYear.mockImplementation(async (_t, year) => {
      if (year === 2019) throw new Error('COG 503');
      return ok(year);
    });
    await series.get(9, BBOX);
    await settle();
    expect(store.map.has(yearKey(TARGET, 2019))).toBe(false);

    const partial = await series.get(9, BBOX);
    expect(partial).toMatchObject({ status: 'ready', failedYears: [2019], progress: { done: 3, total: 4 } });
    expect(partial.years.map(y => y.year)).toEqual([2017, 2018, 2020]);
    expect(kv.has(seriesKey(TARGET))).toBe(false); // an incomplete series is never cached
    expect(series.jobs).toBe(0); // no retry storm within the cooldown

    computeYear.mockClear();
    computeYear.mockImplementation(async (_t, year) => ok(year));
    setNow(new Date(NOW.getTime() + FAILURE_COOLDOWN_MS + 1000));
    expect((await series.get(9, BBOX)).status).toBe('pending');
    await settle();
    expect(computeYear.mock.calls.map(c => c[1])).toEqual([2019]);
    expect((await series.get(9, BBOX)).status).toBe('ready');
  });

  it('a hung year times out, is not stored, and frees the slot', async () => {
    const { series, computeYear, store } = setup({ yearTimeoutMs: 20 });
    computeYear.mockImplementation(async (_t, year) => (year === 2018 ? new Promise<SeriesYear>(() => {}) : ok(year)));
    await series.get(3, BBOX);
    await new Promise(r => setTimeout(r, 60));
    await settle();
    expect(series.jobs).toBe(0);
    expect(store.map.has(yearKey(TARGET, 2018))).toBe(false);
    expect((await series.get(3, BBOX)).failedYears).toEqual([2018]);
  });

  it('one series at a time, at most 8 queued or running; the 9th gets QueueFullError', async () => {
    expect(MAX_SERIES_RUNNING).toBe(1);
    expect(MAX_SERIES_JOBS).toBe(8);
    const gate = deferred<void>();
    const limiter = createLimiter(MAX_SERIES_RUNNING);
    const { series, computeYear } = setup({ limiter });
    computeYear.mockImplementation(async (_t, year) => { await gate.promise; return ok(year); });
    const boxes = Array.from({ length: 9 }, (_, i): Bbox => [100 + i, 53.6, 100.04 + i, 53.63]);
    for (const b of boxes.slice(0, 8)) expect((await series.get(1, b)).status).toBe('pending');
    expect(series.jobs).toBe(8);
    expect(limiter.active).toBe(1);
    expect(limiter.queued).toBe(7);
    await expect(series.get(1, boxes[8])).rejects.toBeInstanceOf(QueueFullError);
    gate.resolve();
    await settle();
    expect(series.jobs).toBe(0);
  });

  it('while a newer series is being built, the last complete one is served', async () => {
    const { series, kv, computeYear, store, setNow } = setup();
    await series.get(4, BBOX);
    await settle();
    expect((await series.get(4, BBOX)).status).toBe('ready');
    // Days later: the whole-series key expired and the current year's entry is gone (7-day TTL)
    setNow(new Date(NOW.getTime() + 8 * 86_400_000));
    kv.delete(seriesKey(TARGET));
    store.map.delete(yearKey(TARGET, 2020));
    const gate = deferred<void>();
    computeYear.mockImplementation(async (_t, year) => { await gate.promise; return ok(year, 0.5); });
    const stale = await series.get(4, BBOX);
    expect(stale.status).toBe('ready');
    expect(stale.years).toHaveLength(4);
    expect(series.jobs).toBe(1); // …and the missing year is being recomputed
    gate.resolve();
    await settle();
    expect(computeYear).toHaveBeenLastCalledWith(TARGET, 2020);
  });

  it('completes without Redis (years kept in memory for a while)', async () => {
    const computeYear = jest.fn(async (_t: SeriesTarget, year: number) => ok(year));
    const nothing: YearStore = { get: async () => null, set: async () => {} };
    const series = createNdviSeries({ store: nothing, computeYear, cachedSeries: (_k, _t, f) => f(), now: () => NOW });
    expect((await series.get(2, BBOX)).status).toBe('pending');
    await settle();
    const ready = await series.get(2, BBOX);
    expect(ready.status).toBe('ready');
    expect(ready.years).toHaveLength(4);
    expect(computeYear).toHaveBeenCalledTimes(4);
  });
});
