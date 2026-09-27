import {
  BUFFER_M, HOTSPOTS_TTL_SEC, INCIDENT_FOR_HOTSPOTS_SQL, INCIDENT_HOTSPOTS_SQL, MAX_HOTSPOTS, hotspotFromRow,
  hotspotIncidentFromRow, hotspotQueryParams, hotspotWindow, hotspotsCacheKey, ooptCacheKey, toHotspotList,
  type HotspotIncident,
} from '../../backend/services/incidentHotspots';
import { HOTSPOT_SOURCE } from '../../backend/services/firmsHistory/hotspotRows';
import { createIncidentHotspotsHandler, parseIncidentId, type IncidentHotspotsDeps } from '../../backend/routes/incidentHotspots';
import { memoizeAsync } from '../../backend/services/incidentHotspotsDeps';
import type { OoptProximity } from '../../backend/services/ooptProximity';

const firmsRow = (over: Record<string, unknown> = {}) => ({
  id: 42,
  center_lat: 52.3, center_lng: 104.2,
  bbox_min_lat: 52.29, bbox_min_lng: 104.19, bbox_max_lat: 52.31, bbox_max_lng: 104.21,
  metadata: { method: 'firms-cluster-v1', first_seen: '2026-09-24T18:40:00.000Z', last_seen: '2026-09-25T05:12:00.000Z', status: 'active' },
  ...over,
});

describe('hotspotIncidentFromRow', () => {
  it('reads bbox, centre and first/last point of a FIRMS incident', () => {
    expect(hotspotIncidentFromRow(firmsRow())).toEqual({
      id: 42,
      isFirms: true,
      center: { lat: 52.3, lon: 104.2 },
      bbox: { minLat: 52.29, minLon: 104.19, maxLat: 52.31, maxLon: 104.21 },
      firstSeen: '2026-09-24T18:40:00.000Z',
      lastSeen: '2026-09-25T05:12:00.000Z',
    });
  });

  it('marks seed/manual rows as not FIRMS and tolerates missing fields', () => {
    const inc = hotspotIncidentFromRow({ id: '7', center_lat: null, center_lng: '104', metadata: null });
    expect(inc).toEqual({ id: 7, isFirms: false, center: null, bbox: null, firstSeen: null, lastSeen: null });
    expect(hotspotIncidentFromRow(firmsRow({ metadata: { method: 'firms-cluster-v1', first_seen: 'garbage' } })).firstSeen).toBeNull();
  });
});

describe('hotspotWindow (bbox + 375 m, first…last point)', () => {
  const inc = hotspotIncidentFromRow(firmsRow());

  it('grows the bbox by one VIIRS pixel on each side and spans the UTC dates', () => {
    const w = hotspotWindow(inc)!;
    expect(w.from).toBe('2026-09-24');
    expect(w.to).toBe('2026-09-25');
    const dLat = BUFFER_M / 111_320;
    expect(w.minLat).toBeCloseTo(52.29 - dLat, 9);
    expect(w.maxLat).toBeCloseTo(52.31 + dLat, 9);
    // a degree of longitude is shorter at 52°N: the buffer in degrees is wider
    const dLon = BUFFER_M / (111_320 * Math.cos((52.3 * Math.PI) / 180));
    expect(w.minLon).toBeCloseTo(104.19 - dLon, 9);
    expect(w.maxLon).toBeCloseTo(104.21 + dLon, 9);
    expect(w.maxLon - 104.21).toBeGreaterThan(w.maxLat - 52.31);
  });

  it('uses UTC dates even for times late in the day', () => {
    const late = hotspotIncidentFromRow(firmsRow({ metadata: { method: 'firms-cluster-v1', first_seen: '2026-09-24T23:59:00Z', last_seen: '2026-09-24T23:59:00Z' } }));
    expect(hotspotWindow(late)).toMatchObject({ from: '2026-09-24', to: '2026-09-24' });
  });

  it('is null without bbox or dates', () => {
    expect(hotspotWindow({ ...inc, bbox: null })).toBeNull();
    expect(hotspotWindow({ ...inc, lastSeen: null })).toBeNull();
  });

  it('becomes placeholders, never SQL text, with one extra row to detect the cut', () => {
    const w = hotspotWindow(inc)!;
    expect(hotspotQueryParams(w)).toEqual([HOTSPOT_SOURCE, '2026-09-24', '2026-09-25', w.minLat, w.maxLat, w.minLon, w.maxLon, MAX_HOTSPOTS + 1]);
    expect(INCIDENT_HOTSPOTS_SQL).toContain('source = $1 AND acquisition_date BETWEEN $2::date AND $3::date');
    expect(INCIDENT_HOTSPOTS_SQL).toContain('latitude BETWEEN $4 AND $5 AND longitude BETWEEN $6 AND $7');
    expect(INCIDENT_HOTSPOTS_SQL).toMatch(/ORDER BY acquisition_date, acquisition_time, id LIMIT \$8$/);
    expect(INCIDENT_FOR_HOTSPOTS_SQL).toMatch(/WHERE id = \$1$/);
  });
});

describe('toHotspotList', () => {
  const w = hotspotWindow(hotspotIncidentFromRow(firmsRow()))!;
  const row = (i: number) => ({ lat: 52.3, lon: 104.2 + i / 1e4, satellite: 'N20', acq_date: '2026-09-24', acq_time: '18:40', confidence: 'h', frp: '12.5' });

  it('maps rows to points with an ISO UTC time', () => {
    expect(hotspotFromRow(row(0))).toEqual({
      lat: 52.3, lon: 104.2, satellite: 'N20', acquired_at: '2026-09-24T18:40:00Z', confidence: 'h', frp: 12.5,
    });
    expect(hotspotFromRow({ ...row(0), acq_time: null, frp: null, confidence: null })).toMatchObject({ acquired_at: '2026-09-24T00:00:00Z', frp: null, confidence: null });
    expect(hotspotFromRow({ lat: 'x', lon: 1, acq_date: '2026-09-24' })).toBeNull();
  });

  it('keeps at most 500 points and flags the cut', () => {
    const exact = toHotspotList(Array.from({ length: MAX_HOTSPOTS }, (_, i) => row(i)), w);
    expect(exact.hotspots).toHaveLength(500);
    expect(exact.truncated).toBe(false);
    const over = toHotspotList(Array.from({ length: MAX_HOTSPOTS + 1 }, (_, i) => row(i)), w);
    expect(over.hotspots).toHaveLength(500);
    expect(over.truncated).toBe(true);
    expect(over.limit).toBe(500);
    expect(toHotspotList([], w)).toEqual({ hotspots: [], truncated: false, limit: 500, window: w });
  });
});

describe('cache keys', () => {
  it('are per id and last_seen, so a grown incident is re-read at once', () => {
    const a = hotspotIncidentFromRow(firmsRow());
    const b = hotspotIncidentFromRow(firmsRow({ metadata: { method: 'firms-cluster-v1', first_seen: '2026-09-24T18:40:00.000Z', last_seen: '2026-09-26T05:00:00.000Z' } }));
    const c = hotspotIncidentFromRow(firmsRow({ id: 43 }));
    expect(hotspotsCacheKey(a)).toBe('incident:hotspots:v1:42:2026-09-25T05:12:00.000Z');
    expect(new Set([a, b, c].map(hotspotsCacheKey)).size).toBe(3);
    expect(new Set([a, b, c].map(ooptCacheKey)).size).toBe(3);
    expect(hotspotsCacheKey(a)).not.toBe(ooptCacheKey(a));
    expect(HOTSPOTS_TTL_SEC).toBe(600);
  });
});

describe('parseIncidentId', () => {
  it('accepts positive int4 ids only', () => {
    expect(parseIncidentId('42')).toBe(42);
    for (const bad of ['0', '-1', '1e3', '42abc', '2147483648', '', undefined]) expect(parseIncidentId(bad)).toBeNull();
  });
});

const oopt: OoptProximity = {
  result: { relation: 'near', distance_km: 3.2, id: 1, name: 'Прибайкальский', osm_url: 'u', protect_class: '2', boundary: 'national_park' },
  data_date: '2026-09-26T03:00:00.000Z', note: 'по границам OSM, приблизительно', source: 'OSM', point: 'center',
};

function fakeRes() {
  return {
    statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    set(name: string, value: string) { this.headers[name] = value; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

function deps(over: Partial<IncidentHotspotsDeps> = {}) {
  const store = new Map<string, unknown>();
  const d: IncidentHotspotsDeps & { store: Map<string, unknown>; ttl: number[] } = {
    store,
    ttl: [],
    loadIncident: jest.fn(async (id: number) => (id === 42 ? hotspotIncidentFromRow(firmsRow()) : null)),
    loadHotspots: jest.fn(async window => toHotspotList([{ lat: 52.3, lon: 104.2, satellite: 'N', acq_date: '2026-09-24', acq_time: '18:40', confidence: 'n', frp: 3 }], window)),
    ooptFor: jest.fn(async () => oopt),
    // in-memory stand-in for cached(): a failure is not stored
    cached: async <T>(key: string, ttl: number, fetcher: () => Promise<T>) => {
      d.ttl.push(ttl);
      if (store.has(key)) return store.get(key) as T;
      const value = await fetcher();
      store.set(key, value);
      return value;
    },
    ...over,
  };
  return d;
}

const call = async (d: IncidentHotspotsDeps, id: string) => {
  const res = fakeRes();
  await createIncidentHotspotsHandler(d)({ params: { id } } as any, res as any);
  return res;
};

describe('GET /forest-changes/:id/hotspots handler', () => {
  it('answers with the hotspots, window, provenance and OOPT relation', async () => {
    const d = deps();
    const res = await call(d, '42');
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.body).toMatchObject({
      success: true, incident_id: 42, count: 1, truncated: false, limit: 500, buffer_m: 375,
      window: { from: '2026-09-24', to: '2026-09-25' },
      source: expect.stringContaining('NASA FIRMS'), license: expect.any(String),
      hotspots: [{ satellite: 'N', acquired_at: '2026-09-24T18:40:00Z' }],
      oopt,
    });
    expect(res.body.oopt_error).toBeUndefined();
    expect(d.ooptFor).toHaveBeenCalledWith({ lat: 52.3, lon: 104.2 });
    expect(d.ttl).toEqual([600, 600]);
  });

  it('caches both parts: a second request does not query again', async () => {
    const d = deps();
    await call(d, '42');
    await call(d, '42');
    expect(d.loadHotspots).toHaveBeenCalledTimes(1);
    expect(d.ooptFor).toHaveBeenCalledTimes(1);
    expect([...d.store.keys()].sort()).toEqual([
      'incident:hotspots:v1:42:2026-09-25T05:12:00.000Z', 'incident:oopt:v1:42:2026-09-25T05:12:00.000Z',
    ]);
  });

  it('rejects bad ids, unknown incidents and non-FIRMS incidents', async () => {
    expect((await call(deps(), 'abc')).statusCode).toBe(400);
    expect((await call(deps(), '1 OR 1=1')).statusCode).toBe(400);
    expect((await call(deps(), '7')).statusCode).toBe(404);
    const seed = deps({ loadIncident: async () => hotspotIncidentFromRow({ id: 5, metadata: {} }) });
    const res = await call(seed, '5');
    expect(res.statusCode).toBe(422);
    expect(seed.loadHotspots).not.toHaveBeenCalled();
    const noBbox = deps({ loadIncident: async () => ({ ...hotspotIncidentFromRow(firmsRow()), bbox: null }) });
    expect((await call(noBbox, '42')).statusCode).toBe(422);
  });

  it('returns 503 when the database is down, never invented points', async () => {
    const down = deps({ loadIncident: async () => { throw new Error('ECONNREFUSED'); } });
    const res = await call(down, '42');
    expect(res.statusCode).toBe(503);
    expect(res.headers['Cache-Control']).toBe('no-store');
    const queryDown = deps({ loadHotspots: async () => { throw new Error('timeout'); } });
    expect((await call(queryDown, '42')).statusCode).toBe(503);
  });

  it('still answers with the hotspots when OOPT data is unavailable, and does not cache the failure', async () => {
    const d = deps({ ooptFor: jest.fn(async () => { throw new Error('Overpass 504'); }) });
    const res = await call(d, '42');
    expect(res.statusCode).toBe(200);
    expect(res.body.oopt).toBeNull();
    expect(res.body.oopt_error).toBe('Данные об ООПТ временно недоступны');
    expect(res.body.count).toBe(1);
    expect([...d.store.keys()].some(k => k.startsWith('incident:oopt'))).toBe(false);
  });

  it('reports a missing centre instead of guessing an OOPT relation', async () => {
    const d = deps({ loadIncident: async () => ({ ...hotspotIncidentFromRow(firmsRow()), center: null }) });
    const res = await call(d, '42');
    expect(res.body.oopt).toBeNull();
    expect(res.body.oopt_error).toBe('У события нет координат центра');
    expect(d.ooptFor).not.toHaveBeenCalled();
  });
});

describe('memoizeAsync (in-memory OOPT copy)', () => {
  it('reuses a value for the TTL, shares one pending call and forgets failures', async () => {
    let t = 0;
    let n = 0;
    let fail = false;
    const fn = jest.fn(async () => { if (fail) throw new Error('down'); return ++n; });
    const memo = memoizeAsync(fn, 1000, () => t);
    expect(await Promise.all([memo(), memo()])).toEqual([1, 1]);
    expect(fn).toHaveBeenCalledTimes(1);
    t = 999;
    expect(await memo()).toBe(1);
    t = 1000;
    fail = true;
    await expect(memo()).rejects.toThrow('down');
    fail = false;
    expect(await memo()).toBe(2);
  });
});
