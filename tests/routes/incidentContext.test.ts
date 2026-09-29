/**
 * GET /api/monitoring/forest-changes/:id/context: statuses and caching with fake deps, then once
 * through the real router and production wiring (pg pool mocked, axios.post spied; no Redis in
 * tests, so cached() calls the fetcher directly).
 */
const mockQuery = jest.fn();
jest.mock('../../backend/config/database', () => ({ __esModule: true, default: { query: mockQuery } }));

import axios from 'axios';
import express from 'express';
import type { AddressInfo } from 'net';
import fixture from '../fixtures/overpass/incident-context.json';
import monitoringRoutes from '../../backend/routes/monitoring';
import { createIncidentContextHandler, contextErrorMessage, type IncidentContextDeps } from '../../backend/routes/incidentContext';
import { INCIDENT_FOR_HOTSPOTS_SQL, type HotspotIncident } from '../../backend/services/incidentHotspots';
import {
  CONTEXT_TTL_SEC, buildContext, parseContextAnswer, type IncidentContext,
} from '../../backend/services/incidentContext/context';
import { OVERPASS_ENDPOINT } from '../../backend/services/incidentContext/overpass';
import { QueueFullError, TimeoutError } from '../../backend/utils/limiter';
import { createCache, type CacheClient } from '../../backend/utils/cache';

async function withApp(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const firms: HotspotIncident = {
  id: 42, isFirms: true, center: { lat: 52.30004, lon: 104.19996 },
  bbox: null, firstSeen: '2026-09-24T18:40:00Z', lastSeen: '2026-09-25T05:12:00Z',
};
const context: IncidentContext = buildContext({ lat: 52.3, lon: 104.2 }, parseContextAnswer(fixture), '2026-09-29T10:00:00.000Z');

/** In-memory Redis stand-in that records every SET. */
function memoryClient() {
  const store = new Map<string, string>();
  const sets: { key: string; args: unknown[] }[] = [];
  const client: CacheClient = {
    async get(key) { return store.get(key) ?? null; },
    async set(key, value, ...args) { store.set(key, value); sets.push({ key, args }); return 'OK'; },
  };
  return { client, store, sets };
}

function appWith(deps: Partial<IncidentContextDeps>) {
  const full: IncidentContextDeps = {
    loadIncident: async () => firms,
    fetchContext: async () => context,
    cached: (_key, _ttl, fetcher) => fetcher(),
    ...deps,
  };
  const app = express();
  app.get('/c/:id', createIncidentContextHandler(full));
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('handler statuses', () => {
  it('200 with the nearest objects, measured from the centre rounded to 3 decimals', async () => {
    const fetchContext = jest.fn(async () => context);
    await withApp(appWith({ fetchContext }), async base => {
      const res = await fetch(`${base}/c/42`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      const body = await res.json();
      expect(body).toMatchObject({ success: true, incident_id: 42, radius_km: 15, point: { lat: 52.3, lon: 104.2 } });
      expect(body.nearest_road).toMatchObject({ osm_id: 1001, direction: 'на восток' });
      expect(body.nearest_settlement).toMatchObject({ name: 'Ключи', direction: 'на северо-восток' });
      expect(body.license).toMatch(/ODbL/);
    });
    expect(fetchContext).toHaveBeenCalledWith({ lat: 52.3, lon: 104.2 });
  });

  it('400 for a bad id, before any lookup', async () => {
    const loadIncident = jest.fn();
    await withApp(appWith({ loadIncident }), async base => {
      for (const id of ['abc', '0', '99999999999', encodeURIComponent("1' OR '1'='1")]) {
        expect((await fetch(`${base}/c/${id}`)).status).toBe(400);
      }
    });
    expect(loadIncident).not.toHaveBeenCalled();
  });

  it('404 unknown, 422 not FIRMS or no centre, 503 database down', async () => {
    const cases: [IncidentContextDeps['loadIncident'], number, RegExp][] = [
      [async () => null, 404, /не найдено/],
      [async () => ({ ...firms, isFirms: false }), 422, /NASA FIRMS/],
      [async () => ({ ...firms, center: null }), 422, /координат/],
      [async () => { throw new Error('ECONNREFUSED'); }, 503, /База данных/],
    ];
    for (const [loadIncident, status, message] of cases) {
      const fetchContext = jest.fn(async () => context);
      await withApp(appWith({ loadIncident, fetchContext }), async base => {
        const res = await fetch(`${base}/c/42`);
        expect(res.status).toBe(status);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error).toMatch(message);
      });
      expect(fetchContext).not.toHaveBeenCalled();
    }
  });

  it('503 with the reason when Overpass fails — no numbers in the answer', async () => {
    for (const [err, message] of [
      [new Error('Request failed with status code 504'), /временно недоступны/],
      [new QueueFullError(), /перегружен/],
      [new TimeoutError('Overpass context', 180000), /не ответил вовремя/],
    ] as const) {
      await withApp(appWith({ fetchContext: async () => { throw err; } }), async base => {
        const res = await fetch(`${base}/c/42`);
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body).toEqual({ success: false, error: expect.stringMatching(message) });
      });
    }
    expect(contextErrorMessage('x')).toBe('Данные OpenStreetMap временно недоступны');
  });
});

describe('caching', () => {
  it('stores a good answer for 7 days under the rounded-centre key; the next card does not call Overpass', async () => {
    const { client, sets } = memoryClient();
    const cached = createCache(() => client);
    const fetchContext = jest.fn(async () => context);
    await withApp(appWith({ fetchContext, cached }), async base => {
      expect((await fetch(`${base}/c/42`)).status).toBe(200);
      expect((await fetch(`${base}/c/42`)).status).toBe(200);
    });
    expect(fetchContext).toHaveBeenCalledTimes(1);
    expect(sets[0]).toEqual({ key: 'incident:context:v1:15:52.300:104.200', args: ['EX', CONTEXT_TTL_SEC] });
  });

  it('never stores a failure: the next request asks Overpass again', async () => {
    const { client, sets } = memoryClient();
    const cached = createCache(() => client);
    const fetchContext = jest.fn()
      .mockRejectedValueOnce(new Error('Request failed with status code 504'))
      .mockResolvedValueOnce(context);
    await withApp(appWith({ fetchContext, cached }), async base => {
      expect((await fetch(`${base}/c/42`)).status).toBe(503);
      expect(sets).toEqual([]);
      expect((await fetch(`${base}/c/42`)).status).toBe(200);
    });
    expect(fetchContext).toHaveBeenCalledTimes(2);
  });

  it('serves the last good answer (with its own data date) when Overpass fails after the TTL', async () => {
    const { client, store } = memoryClient();
    const cached = createCache(() => client);
    const fetchContext = jest.fn().mockResolvedValueOnce(context).mockRejectedValue(new Error('504'));
    await withApp(appWith({ fetchContext, cached }), async base => {
      await fetch(`${base}/c/42`);
      store.delete('incident:context:v1:15:52.300:104.200'); // expired
      const res = await fetch(`${base}/c/42`);
      expect(res.status).toBe(200);
      expect((await res.json()).data_date).toBe('2026-09-28T21:14:03Z');
    });
  });
});

describe('through the monitoring router (production wiring)', () => {
  const incidentRow = {
    id: 42, center_lat: 52.30004, center_lng: 104.19996,
    bbox_min_lat: 52.29, bbox_min_lng: 104.19, bbox_max_lat: 52.31, bbox_max_lng: 104.21,
    metadata: { method: 'firms-cluster-v1', first_seen: '2026-09-24T18:40:00Z', last_seen: '2026-09-25T05:12:00Z' },
  };

  function monitoringApp() {
    const app = express();
    app.use('/api/monitoring', monitoringRoutes);
    return app;
  }

  it('reads the incident with a placeholder and asks Overpass once with a size limit', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql === INCIDENT_FOR_HOTSPOTS_SQL) return { rows: [incidentRow] };
      throw new Error(`unexpected SQL ${sql}`);
    });
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: fixture });
    await withApp(monitoringApp(), async base => {
      const res = await fetch(`${base}/api/monitoring/forest-changes/42/context`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nearest_paved_road).toMatchObject({ osm_id: 1003, paved_by_class: true });
      expect(body.nearest_track).toMatchObject({ osm_id: 1004 });
    });
    expect(mockQuery).toHaveBeenCalledWith(INCIDENT_FOR_HOTSPOTS_SQL, [42]);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, , options] = post.mock.calls[0] as [string, string, Record<string, any>];
    expect(url).toBe(OVERPASS_ENDPOINT);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.maxContentLength).toBeGreaterThan(0);
    expect(options.headers['User-Agent']).toMatch(/forestwatch\.ru/);
  });

  it('422 for an incident that is not a FIRMS cluster, without asking Overpass', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...incidentRow, metadata: { method: 'gfw-integrated' } }] });
    const post = jest.spyOn(axios, 'post');
    await withApp(monitoringApp(), async base => {
      expect((await fetch(`${base}/api/monitoring/forest-changes/42/context`)).status).toBe(422);
    });
    expect(post).not.toHaveBeenCalled();
  });
});
