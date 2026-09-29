/**
 * GET /api/monitoring/forest-changes/:id/hotspots — the FIRMS hotspots of one FIRMS incident
 * (≤ 500) and where it lies relative to protected areas (mounted in routes/monitoring.ts).
 *
 * Both parts are cached 10 min by id + last_seen (`cached()`: a failure is never stored). A failed
 * OOPT lookup (Overpass down, nothing cached) does not fail the answer: `oopt` is null and
 * `oopt_error` says why — the card shows «нет данных», never a guess.
 */
import { retentionCutoff } from '../services/hotspotRetention';
import type { Request, Response } from 'express';
import {
  HOTSPOTS_DATASET, HOTSPOTS_LICENSE, HOTSPOTS_TTL_SEC, BUFFER_M, hotspotsCacheKey, hotspotWindow, ooptCacheKey,
  type HotspotIncident, type HotspotWindow, type IncidentHotspotList,
} from '../services/incidentHotspots';
import type { OoptProximity } from '../services/ooptProximity';
import { MAX_INT4 } from '../services/forestChangesQuery';

export type CachedFn = <T>(key: string, ttlSec: number, fetcher: () => Promise<T>) => Promise<T>;

export interface IncidentHotspotsDeps {
  loadIncident(id: number): Promise<HotspotIncident | null>;
  loadHotspots(window: HotspotWindow): Promise<IncidentHotspotList>;
  /** OOPT relation of a point; throws when there is no OOPT data at all. */
  ooptFor(point: { lat: number; lon: number }): Promise<OoptProximity>;
  cached: CachedFn;
}

export interface IncidentHotspotsResponse {
  success: true;
  incident_id: number;
  count: number;
  truncated: boolean;
  limit: number;
  buffer_m: number;
  window: { from: string; to: string };
  /** Hotspots older than this date are no longer stored (retention window). */
  retained_since: string;
  source: string;
  license: string;
  hotspots: IncidentHotspotList['hotspots'];
  oopt: OoptProximity | null;
  oopt_error?: string;
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).set('Cache-Control', 'no-store').json({ success: false, error });
}

export function parseIncidentId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 && id <= MAX_INT4 ? id : null;
}

export function createIncidentHotspotsHandler(deps: IncidentHotspotsDeps) {
  return async function incidentHotspotsHandler(req: Request, res: Response): Promise<void> {
    const id = parseIncidentId(req.params.id);
    if (id === null) return fail(res, 400, 'invalid incident id');

    let incident: HotspotIncident | null;
    try {
      incident = await deps.loadIncident(id);
    } catch (err) {
      console.error('hotspots: incident lookup failed:', (err as Error)?.message);
      return fail(res, 503, 'База данных недоступна');
    }
    if (!incident) return fail(res, 404, 'Событие не найдено');
    if (!incident.isFirms) return fail(res, 422, 'Термоточки показываются только для событий NASA FIRMS');
    const window = hotspotWindow(incident);
    if (!window) return fail(res, 422, 'У события нет контура или дат — термоточки подобрать нельзя');

    let list: IncidentHotspotList;
    try {
      list = await deps.cached(hotspotsCacheKey(incident), HOTSPOTS_TTL_SEC, () => deps.loadHotspots(window));
    } catch (err) {
      console.error('hotspots: query failed:', (err as Error)?.message);
      return fail(res, 503, 'База данных недоступна');
    }

    let oopt: OoptProximity | null = null;
    let ooptError: string | undefined;
    const center = incident.center;
    if (!center) {
      ooptError = 'У события нет координат центра';
    } else {
      try {
        oopt = await deps.cached(ooptCacheKey(incident), HOTSPOTS_TTL_SEC, () => deps.ooptFor(center));
      } catch (err) {
        console.warn('hotspots: OOPT lookup failed:', (err as Error)?.message);
        ooptError = 'Данные об ООПТ временно недоступны';
      }
    }

    const body: IncidentHotspotsResponse = {
      success: true,
      incident_id: incident.id,
      count: list.hotspots.length,
      truncated: list.truncated,
      limit: list.limit,
      buffer_m: BUFFER_M,
      window: { from: list.window.from, to: list.window.to },
      retained_since: retentionCutoff(new Date()),
      source: HOTSPOTS_DATASET,
      license: HOTSPOTS_LICENSE,
      hotspots: list.hotspots,
      oopt,
      ...(ooptError ? { oopt_error: ooptError } : {}),
    };
    res.set('Cache-Control', 'no-cache').json(body);
  };
}
