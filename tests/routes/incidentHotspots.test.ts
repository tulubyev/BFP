/**
 * GET /api/monitoring/forest-changes/:id/hotspots through the real router and production wiring
 * (pg pool and Overpass mocked; no Redis in tests, so cached() calls the fetchers directly).
 */
const mockQuery = jest.fn();
jest.mock('../../backend/config/database', () => ({ __esModule: true, default: { query: mockQuery } }));
const mockGetOOPT = jest.fn();
jest.mock('../../backend/services/overpassService', () => ({
  ...jest.requireActual('../../backend/services/overpassService'),
  getOOPT: (...args: unknown[]) => mockGetOOPT(...args),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import monitoringRoutes from '../../backend/routes/monitoring';
import { INCIDENT_FOR_HOTSPOTS_SQL, INCIDENT_HOTSPOTS_SQL } from '../../backend/services/incidentHotspots';

async function withServer(fn: (base: string) => Promise<void>) {
  const app = express();
  app.use('/api/monitoring', monitoringRoutes);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/monitoring`);
  } finally {
    server.close();
  }
}

const incidentRow = {
  id: 42, center_lat: 52.3, center_lng: 104.2,
  bbox_min_lat: 52.29, bbox_min_lng: 104.19, bbox_max_lat: 52.31, bbox_max_lng: 104.21,
  metadata: { method: 'firms-cluster-v1', first_seen: '2026-09-24T18:40:00Z', last_seen: '2026-09-25T05:12:00Z' },
};

beforeEach(() => {
  mockQuery.mockReset();
  mockGetOOPT.mockReset();
});

it('runs two parameterized queries and answers with points and the OOPT line', async () => {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql === INCIDENT_FOR_HOTSPOTS_SQL) return { rows: [incidentRow] };
    if (sql === INCIDENT_HOTSPOTS_SQL) return { rows: [{ lat: 52.3, lon: 104.2, satellite: 'N21', acq_date: '2026-09-24', acq_time: '18:40', confidence: 'h', frp: 7.1 }] };
    throw new Error(`unexpected SQL ${sql}`);
  });
  mockGetOOPT.mockResolvedValue({ features: [], source: 'x', fetchedAt: '2026-09-26T03:00:00.000Z' });
  await withServer(async base => {
    const res = await fetch(`${base}/forest-changes/42/hotspots`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hotspots).toEqual([{ lat: 52.3, lon: 104.2, satellite: 'N21', acquired_at: '2026-09-24T18:40:00Z', confidence: 'h', frp: 7.1 }]);
    expect(body.oopt).toMatchObject({ result: { relation: 'none', radius_km: 50 }, data_date: '2026-09-26T03:00:00.000Z' });
  });
  expect(mockQuery.mock.calls[0]).toEqual([INCIDENT_FOR_HOTSPOTS_SQL, [42]]);
  expect(mockQuery.mock.calls[1][1]).toHaveLength(8);
});

it('rejects an id that is not a number before touching the database', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/forest-changes/${encodeURIComponent("1' OR '1'='1")}/hotspots`);
    expect(res.status).toBe(400);
  });
  expect(mockQuery).not.toHaveBeenCalled();
});
