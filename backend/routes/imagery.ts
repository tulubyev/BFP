/**
 * Sentinel-2 before/after images.
 *
 * - GET /imagery/s2/v1/<sceneId>/<render>/<bbox>.png — the rendered PNG; immutable for a year
 *   (browser + Beget CDN), since the URL fully determines the picture. Errors are never cacheable.
 * - GET /api/monitoring/forest-changes/:id/imagery — the scenes picked for an incident
 *   (handler built here, mounted in routes/monitoring.ts).
 */
import { Router, type Request, type Response } from 'express';
import type { IncidentGeo, IncidentImagery } from '../services/imagery/service';
import { parseImageRequest, type ImageRequest } from '../services/imagery/request';
import type { S2Scene } from '../services/imagery/stac';
import { QueueFullError, TimeoutError, withTimeout } from '../utils/limiter';

export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const REQUEST_TIMEOUT_MS = 25_000;

export interface PngStore {
  get(key: string): Promise<Buffer | null>;
  set(key: string, png: Buffer): Promise<void>;
}

export interface ImageRouteDeps {
  /** The scene by id (cached); null when it does not exist. */
  getScene(sceneId: string): Promise<S2Scene | null>;
  /** Renders (behind the concurrency limit) and stores the PNG; resolves with it. */
  renderPng(scene: S2Scene, request: ImageRequest): Promise<Buffer>;
  sceneCovers(scene: S2Scene, request: ImageRequest): boolean;
  timeoutMs?: number;
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).set('Cache-Control', 'no-store').json({ success: false, error });
}

/** 504 for a timeout, 503 when the render queue is full, 502 for a failed source. */
function sendFailure(res: Response, err: unknown, what: string): void {
  if (err instanceof TimeoutError) return fail(res, 504, `${what}: превышено время ожидания`);
  if (err instanceof QueueFullError) return fail(res, 503, `${what}: сервер занят, попробуйте позже`);
  console.warn(`${what} failed:`, (err as Error)?.message);
  fail(res, 502, `${what}: источник снимков недоступен`);
}

export function createImageryRouter(deps: ImageRouteDeps): Router {
  const router = Router();
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;

  router.get(/^\/s2\/v1\/([^/]+)\/([^/]+)\/([^/]+)\.png$/, async (req: Request, res: Response) => {
    const params = req.params as unknown as string[];
    const parsed = parseImageRequest(params[0], params[1], params[2]);
    if (!parsed.ok) return fail(res, 400, parsed.error);
    const request = parsed.value;
    try {
      const png = await withTimeout((async () => {
        const scene = await deps.getScene(request.sceneId);
        if (!scene) return 'not-found' as const;
        if (!deps.sceneCovers(scene, request)) return 'outside' as const;
        return deps.renderPng(scene, request);
      })(), timeoutMs, 'image render');
      if (png === 'not-found') return fail(res, 404, 'scene not found');
      if (png === 'outside') return fail(res, 400, 'bbox is outside the scene footprint');
      res.status(200).type('image/png').set('Cache-Control', IMAGE_CACHE_CONTROL).send(png);
    } catch (err) {
      sendFailure(res, err, 'Снимок');
    }
  });

  return router;
}

export interface IncidentImageryDeps {
  /** 'no-geometry' when the incident has no bbox/centre or date. */
  loadIncident(id: number): Promise<IncidentGeo | 'no-geometry' | null>;
  /** Cached scene selection for the incident. */
  getImagery(incident: IncidentGeo): Promise<IncidentImagery>;
  timeoutMs?: number;
}

export function createIncidentImageryHandler(deps: IncidentImageryDeps) {
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return async function incidentImageryHandler(req: Request, res: Response): Promise<void> {
    const raw = req.params.id;
    const id = /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) return fail(res, 400, 'invalid incident id');

    let incident: IncidentGeo | 'no-geometry' | null;
    try {
      incident = await deps.loadIncident(id);
    } catch (err) {
      console.error('imagery: incident lookup failed:', (err as Error)?.message);
      return fail(res, 503, 'База данных недоступна');
    }
    if (!incident) return fail(res, 404, 'Событие не найдено');
    if (incident === 'no-geometry') return fail(res, 422, 'У события нет координат или даты — снимки подобрать нельзя');

    try {
      const imagery = await withTimeout(deps.getImagery(incident), timeoutMs, 'imagery selection');
      res.set('Cache-Control', 'no-cache').json(imagery);
    } catch (err) {
      sendFailure(res, err, 'Подбор снимков');
    }
  };
}
