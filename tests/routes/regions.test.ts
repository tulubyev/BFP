import express from 'express';
import type { AddressInfo } from 'net';
import path from 'path';
import { createRegionsRouter } from '../../backend/routes/regions';
import { loadRegionRegistry } from '../../backend/services/regions/registry';
import { checkIso } from '../../backend/services/regions/service';

const registry = loadRegionRegistry([path.resolve(__dirname, '../../frontend/public/data/boundaries')]);

async function withServer(service: any, fn: (base: string) => Promise<void>) {
  const app = express();
  app.use('/api/regions', createRegionsRouter(service));
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/regions`);
  } finally {
    server.close();
  }
}

const fakeService = (overrides: any = {}) => ({
  checkIso: (raw: unknown) => checkIso(raw, registry),
  list: jest.fn(async () => ({ regions: [{ iso: 'RU-IRK' }] })),
  detail: jest.fn(async (iso: string) => ({ iso, hotspotSeries: [] })),
  ...overrides,
});

describe('GET /api/regions', () => {
  it('returns the list', async () => {
    await withServer(fakeService(), async base => {
      const res = await fetch(base);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ regions: [{ iso: 'RU-IRK' }] });
    });
  });

  it('answers 503 with a message (not an empty list) when the service fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await withServer(fakeService({ list: async () => { throw new Error('boom'); } }), async base => {
      const res = await fetch(base);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBeTruthy();
    });
  });
});

describe('GET /api/regions/:iso', () => {
  it('returns a known region, normalizing case', async () => {
    const service = fakeService();
    await withServer(service, async base => {
      const res = await fetch(`${base}/ru-irk`);
      expect(res.status).toBe(200);
      expect((await res.json()).iso).toBe('RU-IRK');
      expect(service.detail).toHaveBeenCalledWith('RU-IRK');
    });
  });

  it('rejects malformed codes with 400 without touching the service', async () => {
    const service = fakeService();
    await withServer(service, async base => {
      for (const bad of ['IRK', 'RU-IRKUTSK', '%3Cscript%3E', 'RU-1']) {
        expect((await fetch(`${base}/${bad}`)).status).toBe(400);
      }
      expect(service.detail).not.toHaveBeenCalled();
    });
  });

  it('answers 404 for codes outside the 83 regions (Crimea)', async () => {
    await withServer(fakeService(), async base => {
      const res = await fetch(`${base}/RU-CR`);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/RU-CR/);
    });
  });

  it('answers 503 when the data cannot be built', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await withServer(fakeService({ detail: async () => { throw new Error('boom'); } }), async base => {
      expect((await fetch(`${base}/RU-BU`)).status).toBe(503);
    });
  });
});
