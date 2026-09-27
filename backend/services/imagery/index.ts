/**
 * Production wiring of the imagery feature: Earth Search STAC, remote COGs, Redis caches and the
 * render/scene-check concurrency limits.
 *
 * Caches: STAC item by id — 30 days (`cached()`); incident scene selection with indices — 24 h, keyed
 * by last_seen (`cached()`: a STAC/network error throws and is never stored as a good value);
 * rendered PNG — 1 day in Redis (long-term storage is the browser and the Beget CDN); NDVI series —
 * per year (365 days past, 7 days current) plus the whole series 24 h (ndviSeries.ts).
 */
import { getRedis } from '../../config/redis';
import { cached } from '../../utils/cache';
import { createLimiter, withTimeout } from '../../utils/limiter';
import { openRemoteCog } from './cog';
import { INCIDENT_GEO_SQL, incidentGeoFromRow } from './incident';
import { createNdviSeries, type YearStore } from './ndviSeries';
import { incidentImageryKey, pngKey, sceneItemKey, type ImageRequest } from './request';
import {
  getIncidentImagery, renderScenePng, sceneCovers, type ImageryDeps, type IncidentGeo, type IncidentImagery,
} from './service';
import { computeSeriesYear, type SeriesYear } from './series';
import { createStacClient, type S2Scene } from './stac';
import type { ImageRouteDeps, IncidentImageryDeps, NdviSeriesRouteDeps, PngStore } from '../../routes/imagery';

const DAY_SEC = 24 * 60 * 60;
export const ITEM_TTL_SEC = 30 * DAY_SEC;
export const SELECTION_TTL_SEC = DAY_SEC;
export const PNG_TTL_SEC = DAY_SEC;
/** At most 2 renders at a time; a few more may wait, the rest get 503. */
export const MAX_RENDERS = 2;
export const MAX_RENDER_QUEUE = 16;
/** A render that hangs past this frees its slot (the HTTP request gives up after 25 s). */
export const RENDER_HARD_TIMEOUT_MS = 60_000;

const stac = createStacClient();
const renderLimiter = createLimiter(MAX_RENDERS, MAX_RENDER_QUEUE);
// Scene checks (SCL reads) have their own limit so they do not wait behind renders
const sceneCheckLimiter = createLimiter(2, 32);

const imageryDeps: ImageryDeps = {
  stac,
  openCog: openRemoteCog,
  schedule: task => sceneCheckLimiter.run(() => withTimeout(task(), RENDER_HARD_TIMEOUT_MS, 'scene check')),
};

export const redisPngStore: PngStore = {
  async get(key) {
    try {
      return (await getRedis()?.getBuffer(key)) ?? null;
    } catch (err: any) {
      console.warn(`imagery png read ${key} failed:`, err.message);
      return null;
    }
  },
  async set(key, png) {
    try {
      await getRedis()?.set(key, png, 'EX', PNG_TTL_SEC);
    } catch (err: any) {
      console.warn(`imagery png write ${key} failed:`, err.message);
    }
  },
};

/** Runs `fn` once per key at a time; concurrent callers share the promise. */
export function createInFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, fn: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = fn().finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}

/** PNG from the store, else rendered behind the limiter and stored; one render per key at a time. */
export function createPngRenderer(
  store: PngStore,
  render: (scene: S2Scene, request: ImageRequest, signal: AbortSignal) => Promise<Buffer>,
  limiter = renderLimiter,
  hardTimeoutMs = RENDER_HARD_TIMEOUT_MS,
) {
  const inFlight = createInFlight<Buffer>();
  return (scene: S2Scene, request: ImageRequest): Promise<Buffer> => {
    const key = pngKey(request);
    return inFlight(key, async () => {
      const hit = await store.get(key);
      if (hit) return hit;
      const png = await limiter.run(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), hardTimeoutMs);
        return withTimeout(render(scene, request, controller.signal), hardTimeoutMs, 'render')
          .finally(() => clearTimeout(timer));
      });
      await store.set(key, png);
      return png;
    });
  };
}

async function getScene(sceneId: string): Promise<S2Scene | null> {
  // A missing scene is not cached (cached() only stores values), so a typo costs one lookup each time
  const scene = await cached(sceneItemKey(sceneId), ITEM_TTL_SEC, async () => {
    const item = await stac.getItem(sceneId);
    if (!item) throw new SceneNotFound(sceneId);
    return item;
  }).catch(err => {
    if (err instanceof SceneNotFound) return null;
    throw err;
  });
  return scene;
}

class SceneNotFound extends Error {
  constructor(id: string) {
    super(`scene ${id} not found`);
    this.name = 'SceneNotFound';
  }
}

export const imageRouteDeps: ImageRouteDeps = {
  getScene,
  renderPng: createPngRenderer(redisPngStore, (scene, request, signal) =>
    renderScenePng(scene, request.render, request.bbox, imageryDeps, signal)),
  sceneCovers: (scene, request) => sceneCovers(scene, request.bbox),
};

export const redisYearStore: YearStore = {
  async get(key) {
    try {
      const raw = await getRedis()?.get(key);
      return raw ? (JSON.parse(raw) as SeriesYear) : null;
    } catch (err: any) {
      console.warn(`ndvi year read ${key} failed:`, err.message);
      return null;
    }
  },
  async set(key, value, ttlSec) {
    try {
      await getRedis()?.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (err: any) {
      console.warn(`ndvi year write ${key} failed:`, err.message);
    }
  },
};

const ndviSeries = createNdviSeries({
  store: redisYearStore,
  computeYear: (target, year) => computeSeriesYear(target, year, imageryDeps),
  cachedSeries: (key, ttl, fetcher) => cached(key, ttl, fetcher),
});

export interface QueryPool {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const incidentLoader = (pool: QueryPool) => async (id: number): Promise<IncidentGeo | 'no-geometry' | null> => {
  const { rows } = await pool.query(INCIDENT_GEO_SQL, [id]);
  return rows[0] ? incidentGeoFromRow(rows[0]) : null;
};

export function createNdviSeriesDeps(pool: QueryPool): NdviSeriesRouteDeps {
  return {
    loadIncident: incidentLoader(pool),
    getSeries: incident => ndviSeries.get(incident.id, incident.bbox),
  };
}

export function createIncidentImageryDeps(pool: QueryPool): IncidentImageryDeps {
  return {
    loadIncident: incidentLoader(pool),
    getImagery(incident: IncidentGeo): Promise<IncidentImagery> {
      return cached(incidentImageryKey(incident.id, incident.lastSeen), SELECTION_TTL_SEC,
        () => getIncidentImagery(incident, imageryDeps));
    },
  };
}
