/**
 * GET /api/monitoring/forest-changes/:id/context — nearest road, nearest paved road, nearest track
 * and nearest settlement around a FIRMS incident's centre, from OpenStreetMap (Overpass), with
 * distance and direction (mounted in routes/monitoring.ts).
 *
 * Cached 7 days per centre rounded to 3 decimals (`cached()`: a failure is never stored, the last
 * good answer is served while Overpass is down). No answer at all → 503 with the reason; the card
 * shows «нет данных», never a guess.
 */
import type { Request, Response } from 'express';
import { QueueFullError, TimeoutError } from '../utils/limiter';
import type { HotspotIncident } from '../services/incidentHotspots';
import {
  CONTEXT_TTL_SEC, contextCacheKey, contextPoint, type IncidentContext,
} from '../services/incidentContext/context';
import type { LatLon } from '../services/incidentContext/geo';
import { parseIncidentId, type CachedFn } from './incidentHotspots';

export interface IncidentContextDeps {
  loadIncident(id: number): Promise<HotspotIncident | null>;
  /** Queries OSM around the point; rejects on any failure. */
  fetchContext(point: LatLon): Promise<IncidentContext>;
  cached: CachedFn;
}

export type IncidentContextResponse = { success: true; incident_id: number } & IncidentContext;

function fail(res: Response, status: number, error: string): void {
  res.status(status).set('Cache-Control', 'no-store').json({ success: false, error });
}

/** The reason shown in the card when there is no answer. */
export function contextErrorMessage(err: unknown): string {
  if (err instanceof QueueFullError) return 'Сервис OpenStreetMap (Overpass) перегружен запросами, попробуйте позже';
  if (err instanceof TimeoutError) return 'Сервис OpenStreetMap (Overpass) не ответил вовремя';
  return 'Данные OpenStreetMap временно недоступны';
}

export function createIncidentContextHandler(deps: IncidentContextDeps) {
  return async function incidentContextHandler(req: Request, res: Response): Promise<void> {
    const id = parseIncidentId(req.params.id);
    if (id === null) return fail(res, 400, 'invalid incident id');

    let incident: HotspotIncident | null;
    try {
      incident = await deps.loadIncident(id);
    } catch (err) {
      console.error('context: incident lookup failed:', (err as Error)?.message);
      return fail(res, 503, 'База данных недоступна');
    }
    if (!incident) return fail(res, 404, 'Событие не найдено');
    if (!incident.isFirms) return fail(res, 422, 'Дороги и населённые пункты показываются только для событий NASA FIRMS');
    if (!incident.center) return fail(res, 422, 'У события нет координат центра');

    const point = contextPoint(incident.center);
    let context: IncidentContext;
    try {
      context = await deps.cached(contextCacheKey(point), CONTEXT_TTL_SEC, () => deps.fetchContext(point));
    } catch (err) {
      console.warn('context: Overpass lookup failed:', (err as Error)?.message);
      return fail(res, 503, contextErrorMessage(err));
    }

    const body: IncidentContextResponse = { success: true, incident_id: incident.id, ...context };
    res.set('Cache-Control', 'no-cache').json(body);
  };
}
