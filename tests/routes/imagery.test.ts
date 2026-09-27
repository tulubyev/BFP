import express from 'express';
import type { AddressInfo } from 'net';
import {
  IMAGE_CACHE_CONTROL, createImageryRouter, createIncidentImageryHandler, createNdviSeriesHandler, type ImageRouteDeps,
  type IncidentImageryDeps, type NdviSeriesRouteDeps,
} from '../../backend/routes/imagery';
import { SPA_FALLBACK_RE } from '../../backend/utils/spaFallback';
import { QueueFullError } from '../../backend/utils/limiter';
import { scene } from '../services/imagery/helpers';

const ID = 'S2A_T48UUE_20240714T043045_L2A';
const BBOX = '103.05000,53.60000,103.09000,53.63000';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

async function withApp(setup: (app: express.Express) => void, fn: (base: string) => Promise<void>) {
  const app = express();
  setup(app);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const imageDeps = (overrides: Partial<ImageRouteDeps> = {}): ImageRouteDeps => ({
  getScene: jest.fn(async () => scene()),
  renderPng: jest.fn(async () => PNG),
  sceneCovers: () => true,
  ...overrides,
});

const withImages = (deps: ImageRouteDeps, fn: (base: string) => Promise<void>) =>
  withApp(app => app.use('/imagery', createImageryRouter(deps)), fn);

describe('GET /imagery/s2/v1/:sceneId/:render/:bbox.png', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('serves the PNG with immutable cache headers', async () => {
    const deps = imageDeps();
    await withImages(deps, async base => {
      const res = await fetch(`${base}/imagery/s2/v1/${ID}/swir/${BBOX}.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toBe(IMAGE_CACHE_CONTROL);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
      expect(deps.renderPng).toHaveBeenCalledWith(scene(), expect.objectContaining({ sceneId: ID, render: 'swir', bboxParam: BBOX }));
    });
  });

  it.each([
    ['a bad scene id', `S2A_BAD/swir/${BBOX}.png`],
    ['an unknown render', `${ID}/evi/${BBOX}.png`],
    ['a non-canonical bbox', `${ID}/swir/103.05,53.6,103.09,53.63.png`],
    ['an oversized bbox', `${ID}/swir/103.00000,53.60000,103.50000,53.63000.png`],
  ])('answers 400 for %s, never cacheable', async (_label, path) => {
    const deps = imageDeps();
    await withImages(deps, async base => {
      const res = await fetch(`${base}/imagery/s2/v1/${path}`);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(deps.getScene).not.toHaveBeenCalled();
    });
  });

  it('answers 404 for an unknown scene', async () => {
    await withImages(imageDeps({ getScene: async () => null }), async base => {
      const res = await fetch(`${base}/imagery/s2/v1/${ID}/truecolor/${BBOX}.png`);
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('answers 400 when the bbox is outside the scene footprint', async () => {
    const deps = imageDeps({ sceneCovers: () => false });
    await withImages(deps, async base => {
      expect((await fetch(`${base}/imagery/s2/v1/${ID}/truecolor/${BBOX}.png`)).status).toBe(400);
      expect(deps.renderPng).not.toHaveBeenCalled();
    });
  });

  it('answers 502 when the source fails', async () => {
    await withImages(imageDeps({ renderPng: async () => { throw new Error('COG 503'); } }), async base => {
      const res = await fetch(`${base}/imagery/s2/v1/${ID}/truecolor/${BBOX}.png`);
      expect(res.status).toBe(502);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  it('answers 504 on timeout', async () => {
    await withImages(imageDeps({ renderPng: () => new Promise(() => {}), timeoutMs: 50 }), async base => {
      expect((await fetch(`${base}/imagery/s2/v1/${ID}/truecolor/${BBOX}.png`)).status).toBe(504);
    });
  });

  it('answers 503 when the render queue is full', async () => {
    await withImages(imageDeps({ renderPng: async () => { throw new QueueFullError(); } }), async base => {
      expect((await fetch(`${base}/imagery/s2/v1/${ID}/truecolor/${BBOX}.png`)).status).toBe(503);
    });
  });

  it('unknown paths under /imagery are 404, not the SPA page', async () => {
    await withApp(app => {
      app.use('/imagery', createImageryRouter(imageDeps()));
      app.get(SPA_FALLBACK_RE, (_req, res) => { res.send('<html>'); });
    }, async base => {
      expect((await fetch(`${base}/imagery/s2/v2/${ID}/swir/${BBOX}.png`)).status).toBe(404);
      expect((await fetch(`${base}/incidents`)).status).toBe(200);
    });
  });
});

describe('SPA_FALLBACK_RE', () => {
  it('skips api, tiles and imagery paths', () => {
    expect(SPA_FALLBACK_RE.test('/incidents')).toBe(true);
    expect(SPA_FALLBACK_RE.test('/analytics')).toBe(true);
    expect(SPA_FALLBACK_RE.test('/imagery-help')).toBe(true);
    expect(SPA_FALLBACK_RE.test('/api/sources')).toBe(false);
    expect(SPA_FALLBACK_RE.test('/tiles/gfw/loss/1/1/1.png')).toBe(false);
    expect(SPA_FALLBACK_RE.test(`/imagery/s2/v1/${ID}/swir/${BBOX}.png`)).toBe(false);
  });
});

const imagery = {
  incidentId: 5, aoi: [1, 2, 3, 4], before: { status: 'none', reason: 'x' }, after: { status: 'none', reason: 'y' },
  source: { name: 'n', url: 'u', license: 'l', attribution: 'a' }, generatedAt: '2025-08-01T00:00:00.000Z',
} as any;
const geo = { id: 5, bbox: [103.05, 53.6, 103.09, 53.63], firstSeen: '2025-07-20T05:00:00.000Z', lastSeen: '2025-07-22T18:30:00.000Z' } as any;

const incidentDeps = (overrides: Partial<IncidentImageryDeps> = {}): IncidentImageryDeps => ({
  loadIncident: jest.fn(async () => geo),
  getImagery: jest.fn(async () => imagery),
  ...overrides,
});

const withIncident = (deps: IncidentImageryDeps, fn: (base: string) => Promise<void>) =>
  withApp(app => app.get('/api/monitoring/forest-changes/:id/imagery', createIncidentImageryHandler(deps)), fn);

describe('GET /api/monitoring/forest-changes/:id/imagery', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns the imagery of the incident', async () => {
    const deps = incidentDeps();
    await withIncident(deps, async base => {
      const res = await fetch(`${base}/api/monitoring/forest-changes/5/imagery`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(imagery);
      expect(deps.loadIncident).toHaveBeenCalledWith(5);
      expect(deps.getImagery).toHaveBeenCalledWith(geo);
    });
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])('answers 400 for id %p', async id => {
    await withIncident(incidentDeps(), async base => {
      expect((await fetch(`${base}/api/monitoring/forest-changes/${id}/imagery`)).status).toBe(400);
    });
  });

  it('answers 404 for an unknown incident and 422 without coordinates', async () => {
    await withIncident(incidentDeps({ loadIncident: async () => null }), async base => {
      expect((await fetch(`${base}/api/monitoring/forest-changes/5/imagery`)).status).toBe(404);
    });
    await withIncident(incidentDeps({ loadIncident: async () => 'no-geometry' }), async base => {
      expect((await fetch(`${base}/api/monitoring/forest-changes/5/imagery`)).status).toBe(422);
    });
  });

  it('answers 503 when the database is down', async () => {
    await withIncident(incidentDeps({ loadIncident: async () => { throw new Error('ECONNREFUSED'); } }), async base => {
      expect((await fetch(`${base}/api/monitoring/forest-changes/5/imagery`)).status).toBe(503);
    });
  });

  it('answers 502 when STAC fails and 504 on timeout', async () => {
    await withIncident(incidentDeps({ getImagery: async () => { throw new Error('STAC down'); } }), async base => {
      const res = await fetch(`${base}/api/monitoring/forest-changes/5/imagery`);
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBeTruthy();
    });
    await withIncident(incidentDeps({ getImagery: () => new Promise(() => {}), timeoutMs: 50 }), async base => {
      expect((await fetch(`${base}/api/monitoring/forest-changes/5/imagery`)).status).toBe(504);
    });
  });
});

const series = {
  incidentId: 5, status: 'pending', years: [], progress: { done: 0, total: 10 }, aoi: [1, 2, 3, 4], site: [1, 2, 3, 4],
  window: { start: '07-01', end: '08-31' }, source: { name: 'n', url: 'u', license: 'l', attribution: 'a' },
  generatedAt: '2026-09-27T00:00:00.000Z',
} as any;

const seriesDeps = (overrides: Partial<NdviSeriesRouteDeps> = {}): NdviSeriesRouteDeps => ({
  loadIncident: jest.fn(async () => ({ ...geo, hasBbox: true })),
  getSeries: jest.fn(async () => series),
  ...overrides,
});

const withSeries = (deps: NdviSeriesRouteDeps, fn: (base: string) => Promise<void>) =>
  withApp(app => app.get('/api/monitoring/forest-changes/:id/ndvi-series', createNdviSeriesHandler(deps)), fn);

describe('GET /api/monitoring/forest-changes/:id/ndvi-series', () => {
  const url = (base: string, id: string | number = 5) => `${base}/api/monitoring/forest-changes/${id}/ndvi-series`;
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns the series state (pending or ready), never cached by the browser', async () => {
    const deps = seriesDeps();
    await withSeries(deps, async base => {
      const res = await fetch(url(base));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.json()).toEqual(series);
      expect(deps.getSeries).toHaveBeenCalledWith({ ...geo, hasBbox: true });
    });
  });

  it('422 for an incident without an outline (centre point only)', async () => {
    const deps = seriesDeps({ loadIncident: async () => ({ ...geo, hasBbox: false }) });
    await withSeries(deps, async base => {
      const res = await fetch(url(base));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toContain('только для событий с контуром');
      expect(deps.getSeries).not.toHaveBeenCalled();
    });
  });

  it('400 / 404 / 503 like the imagery endpoint', async () => {
    await withSeries(seriesDeps(), async base => expect((await fetch(url(base, 'x'))).status).toBe(400));
    await withSeries(seriesDeps({ loadIncident: async () => null }), async base => expect((await fetch(url(base))).status).toBe(404));
    await withSeries(seriesDeps({ loadIncident: async () => { throw new Error('db'); } }), async base => {
      expect((await fetch(url(base))).status).toBe(503);
    });
  });

  it('503 «слишком много запросов» when the series queue is full, 502 on other failures', async () => {
    await withSeries(seriesDeps({ getSeries: async () => { throw new QueueFullError(); } }), async base => {
      const res = await fetch(url(base));
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).error).toBe('Слишком много запросов, попробуйте позже');
    });
    await withSeries(seriesDeps({ getSeries: async () => { throw new Error('redis'); } }), async base => {
      expect((await fetch(url(base))).status).toBe(502);
    });
  });
});
