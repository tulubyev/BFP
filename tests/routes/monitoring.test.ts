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
    expect(params).toEqual(["fire' OR '1'='1", 500]);
  });

  it('GET /forest-changes/geojson applies start_date and static_sources as the feed does', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: 7, change_type: 'fire', detected_date: '2026-09-20', center_lat: '52.2', center_lng: '104.2',
        bbox_min_lat: '52.1', bbox_min_lng: '104.1', bbox_max_lat: '52.3', bbox_max_lng: '104.3',
        method: 'firms-cluster-v1', status: 'inactive', hotspot_count: '3', region: 'Иркутская область',
      }],
    });
    await withServer(async base => {
      const res = await fetch(`${base}/forest-changes/geojson?change_type=fire&start_date=2026-08-28&static_sources=only`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.type).toBe('FeatureCollection');
      expect(body.features[0]).toMatchObject({
        id: 7,
        geometry: { type: 'Point', coordinates: [104.2, 52.2] },
        properties: { status: 'inactive', hotspot_count: 3, bbox: [104.1, 52.1, 104.3, 52.3], region: 'Иркутская область' },
      });
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("fc.metadata->>'status' = 'static_source'");
    expect(sql).toContain('fc.detected_date >= $2');
    expect(params).toEqual(['fire', '2026-08-28', 500]);
  });

  it('GET /forest-changes/geojson hides static sources by default and drops a bad start_date', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await withServer(async base => {
      const res = await fetch(`${base}/forest-changes/geojson?start_date=${encodeURIComponent("1' OR '1'='1")}&static_sources=all`);
      expect(res.status).toBe(200);
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("<> 'static_source'");
    expect(sql).not.toContain('detected_date >=');
    expect(params).toEqual([500]);
  });

  it('GET /forest-changes/geojson answers 500 without data on a database error', async () => {
    mockQuery.mockRejectedValue(new Error('down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await withServer(async base => {
      const res = await fetch(`${base}/forest-changes/geojson`);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Database error' });
    });
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
