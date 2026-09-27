import express, { Application } from 'express';
import type { AddressInfo } from 'net';
import {
  API_RATE_LIMIT, EXPENSIVE_API_PATHS, EXPENSIVE_RATE_LIMIT, JSON_BODY_LIMIT, RATE_LIMIT_MESSAGE, RATE_LIMIT_WINDOW_MS,
  TRUST_PROXY_HOPS, applyApiProtection, bodyErrorHandler, jsonBodyParser, type ApiProtectionOptions,
} from '../../backend/middleware/apiProtection';

/** The server.ts middleware order with stub routes for every kind of path. */
function buildApp(options?: ApiProtectionOptions): Application {
  const app = express();
  applyApiProtection(app, options);
  app.use(jsonBodyParser());
  app.use(bodyErrorHandler);
  app.get('/api/ip', (req, res) => { res.json({ ip: req.ip }); });
  app.get('/api/regions', (_req, res) => { res.json({ ok: true }); });
  app.post('/api/echo', (req, res) => { res.json({ size: JSON.stringify(req.body).length }); });
  app.get('/api/export/incidents.csv', (_req, res) => { res.send('csv'); });
  app.get('/api/monitoring/forest-changes', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/monitoring/forest-changes/:id/imagery', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/monitoring/forest-changes/:id/ndvi-series', (_req, res) => { res.json({ ok: true }); });
  for (const p of ['/health', '/tiles/gfw/loss/1/2/3.png', '/imagery/s2/v1/a/b/c.png', '/assets/index-abc.js', '/data/boundaries/ru.geojson', '/']) {
    app.get(p, (_req, res) => { res.send('ok'); });
  }
  return app;
}

async function withServer(app: Application, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const get = (base: string, p: string, ip = '203.0.113.7') => fetch(base + p, { headers: { 'X-Forwarded-For': ip } });

async function hit(base: string, p: string, times: number, ip?: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await get(base, p, ip)).status);
  return statuses;
}

describe('rate limit settings', () => {
  it('matches the spec: 300/min on /api, 20/min on expensive endpoints, one trusted proxy', () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(API_RATE_LIMIT).toBe(300);
    expect(EXPENSIVE_RATE_LIMIT).toBe(20);
    expect(TRUST_PROXY_HOPS).toBe(1);
    expect(JSON_BODY_LIMIT).toBe('100kb');
  });

  it('marks exports, incident imagery and NDVI series as expensive, not the feed or regions', () => {
    const expensive = (p: string) => EXPENSIVE_API_PATHS.some(m => (typeof m === 'string' ? p === m || p.startsWith(`${m}/`) : m.test(p)));
    expect(expensive('/api/export/incidents.csv')).toBe(true);
    expect(expensive('/api/export/regions.json')).toBe(true);
    expect(expensive('/api/monitoring/forest-changes/42/imagery')).toBe(true);
    expect(expensive('/api/monitoring/forest-changes/42/ndvi-series')).toBe(true);
    expect(expensive('/api/monitoring/forest-changes/42/IMAGERY')).toBe(true);
    expect(expensive('/api/monitoring/forest-changes')).toBe(false);
    expect(expensive('/api/monitoring/forest-changes/geojson')).toBe(false);
    expect(expensive('/api/regions/RU-IRK')).toBe(false);
    expect(expensive('/imagery/s2/v1/a/b/c.png')).toBe(false);
  });
});

describe('trust proxy', () => {
  it('takes req.ip from X-Forwarded-For set by Traefik', async () => {
    await withServer(buildApp(), async base => {
      expect(await (await get(base, '/api/ip', '198.51.100.23')).json()).toEqual({ ip: '198.51.100.23' });
    });
  });

  it('trusts only the last hop: a client-supplied X-Forwarded-For cannot pick the address', async () => {
    await withServer(buildApp(), async base => {
      // The client sent "X-Forwarded-For: 1.1.1.1"; Traefik appended the real address
      const res = await get(base, '/api/ip', '1.1.1.1, 198.51.100.23');
      expect(await res.json()).toEqual({ ip: '198.51.100.23' });
    });
  });
});

describe('general /api limit', () => {
  it('answers 429 with a Russian JSON error, RateLimit-* and Retry-After past the limit', async () => {
    await withServer(buildApp({ apiLimit: 3 }), async base => {
      const ok = await get(base, '/api/regions');
      expect(ok.status).toBe(200);
      expect(ok.headers.get('ratelimit-limit')).toBe('3');
      expect(ok.headers.get('ratelimit-remaining')).toBe('2');
      expect(ok.headers.get('x-ratelimit-limit')).toBeNull();

      expect(await hit(base, '/api/regions', 2)).toEqual([200, 200]);
      const limited = await get(base, '/api/regions');
      expect(limited.status).toBe(429);
      expect(limited.headers.get('content-type')).toMatch(/application\/json/);
      expect(await limited.json()).toEqual({ success: false, error: RATE_LIMIT_MESSAGE });
      const retryAfter = Number(limited.headers.get('retry-after'));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(limited.headers.get('ratelimit-reset')).not.toBeNull();
    });
  });

  it('counts each client address separately', async () => {
    await withServer(buildApp({ apiLimit: 2 }), async base => {
      expect(await hit(base, '/api/regions', 3, '198.51.100.1')).toEqual([200, 200, 429]);
      expect(await hit(base, '/api/regions', 2, '198.51.100.2')).toEqual([200, 200]);
    });
  });

  it('never limits /health, tiles, imagery PNGs, assets, data files or pages', async () => {
    await withServer(buildApp({ apiLimit: 1 }), async base => {
      expect(await hit(base, '/api/regions', 2)).toEqual([200, 429]);
      for (const p of ['/health', '/tiles/gfw/loss/1/2/3.png', '/imagery/s2/v1/a/b/c.png', '/assets/index-abc.js', '/data/boundaries/ru.geojson', '/']) {
        const res = await get(base, p);
        expect([p, res.status]).toEqual([p, 200]);
        expect(res.headers.get('ratelimit-limit')).toBeNull();
      }
    });
  });

  it('opens again after the window', async () => {
    await withServer(buildApp({ apiLimit: 1, windowMs: 300 }), async base => {
      expect(await hit(base, '/api/regions', 2)).toEqual([200, 429]);
      await new Promise(r => setTimeout(r, 400));
      expect(await hit(base, '/api/regions', 1)).toEqual([200]);
    });
  });
});

describe('expensive endpoints limit', () => {
  it('limits exports, imagery and NDVI series together, per address, below the general limit', async () => {
    await withServer(buildApp({ apiLimit: 100, expensiveLimit: 2 }), async base => {
      expect(await hit(base, '/api/export/incidents.csv', 1)).toEqual([200]);
      expect(await hit(base, '/api/monitoring/forest-changes/5/imagery', 1)).toEqual([200]);
      const limited = await get(base, '/api/monitoring/forest-changes/5/ndvi-series');
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ success: false, error: RATE_LIMIT_MESSAGE });
      expect(limited.headers.get('retry-after')).not.toBeNull();
      // Cheap endpoints still answer
      expect(await hit(base, '/api/monitoring/forest-changes', 3)).toEqual([200, 200, 200]);
      // Another address has its own budget
      expect(await hit(base, '/api/export/incidents.csv', 1, '198.51.100.9')).toEqual([200]);
    });
  });

  it('expensive requests count toward the general limit too', async () => {
    await withServer(buildApp({ apiLimit: 2, expensiveLimit: 10 }), async base => {
      expect(await hit(base, '/api/export/incidents.csv', 2)).toEqual([200, 200]);
      expect(await hit(base, '/api/regions', 1)).toEqual([429]);
    });
  });
});

describe('JSON body limit', () => {
  const post = (base: string, body: string) =>
    fetch(`${base}/api/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

  it('accepts bodies up to 100 KB', async () => {
    await withServer(buildApp(), async base => {
      const res = await post(base, JSON.stringify({ a: 'x'.repeat(90 * 1024) }));
      expect(res.status).toBe(200);
    });
  });

  it('rejects larger bodies with 413 JSON', async () => {
    await withServer(buildApp(), async base => {
      const res = await post(base, JSON.stringify({ a: 'x'.repeat(101 * 1024) }));
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ success: false, error: expect.stringContaining('100kb') });
    });
  });

  it('answers malformed JSON with 400 JSON, not an HTML stack trace', async () => {
    await withServer(buildApp(), async base => {
      const res = await post(base, '{"a":');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: 'Некорректный JSON в запросе' });
    });
  });
});
