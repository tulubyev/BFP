/**
 * /api/monitoring after the cleanup (spec 2026-09-27-security-hardening, §2): legacy endpoints
 * without users are gone; what the frontend, scripts and docs use is still there.
 */
const mockQuery = jest.fn();
jest.mock('../../backend/config/database', () => ({ __esModule: true, default: { query: mockQuery } }));

import express from 'express';
import type { AddressInfo } from 'net';
import monitoringRoutes from '../../backend/routes/monitoring';
import { YEAR_MAX } from '../../backend/utils/queryParams';

async function withServer(fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use('/api/monitoring', monitoringRoutes);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/monitoring`);
  } finally {
    server.close();
  }
}

beforeEach(() => mockQuery.mockReset());

describe('removed legacy /api/monitoring endpoints', () => {
  const removed: [string, string][] = [
    ['GET', '/forest-areas'],
    ['GET', '/forest-areas/geojson'],
    ['GET', '/monitoring-zones'],
    ['GET', '/alerts'],
    ['GET', '/statistics'],
    ['GET', '/spectral-indices/info'],
    ['POST', '/spectral-indices/calculate'],
    ['GET', '/external-services/info'],
    ['GET', '/fire-hotspots'],
    ['GET', '/fire-hotspots?days=7'],
    ['GET', '/fire-hotspots/geojson'],
    ['GET', '/gfw/statistics'],
    ['GET', '/lookup/forest_types'],
    ['GET', '/lookup/change_types'],
  ];

  it.each(removed)('%s %s → 404 without touching the database', async (method, p) => {
    await withServer(async base => {
      const res = await fetch(base + p, method === 'POST'
        ? { method, headers: { 'Content-Type': 'application/json' }, body: '{"index":"NDVI","bands":{}}' }
        : undefined);
      expect(res.status).toBe(404);
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('kept /api/monitoring endpoints', () => {
  it('GET /gfw/regions lists regions', async () => {
    await withServer(async base => {
      const res = await fetch(`${base}/gfw/regions`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.find((r: any) => r.code === 'irkutsk')).toMatchObject({ adm1: 27 });
    });
  });

  it('GET /fire-hotspots/stats runs its fixed query', async () => {
    mockQuery.mockResolvedValue({ rows: [{ year: 2026, month: 7, count: '5' }] });
    await withServer(async base => {
      const res = await fetch(`${base}/fire-hotspots/stats`);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toHaveLength(1);
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]).toHaveLength(1);
  });

  it('GET /forest-changes/geojson passes change_type as a placeholder', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await withServer(async base => {
      const res = await fetch(`${base}/forest-changes/geojson?change_type=${encodeURIComponent("fire' OR '1'='1")}`);
      expect(res.status).toBe(200);
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('change_type = $1');
    expect(sql).not.toContain("'1'='1");
    expect(params).toEqual(["fire' OR '1'='1"]);
  });

  it('GET /gfw/tree-cover-loss clamps years instead of looping over them', async () => {
    await withServer(async base => {
      const started = Date.now();
      const res = await fetch(`${base}/gfw/tree-cover-loss?region=all&start_year=0&end_year=999999999999`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((d: any) => d.year >= 2001 && d.year <= YEAR_MAX)).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
    });
  });

  it('GET /gfw/tree-cover-loss falls back to defaults for junk years', async () => {
    await withServer(async base => {
      const res = await fetch(`${base}/gfw/tree-cover-loss?region=all&start_year=abc&end_year=1e12`);
      const years = (await res.json()).data.map((d: any) => d.year);
      expect(years[0]).toBe(2001);
      expect(years[years.length - 1]).toBe(2023);
    });
  });
});
