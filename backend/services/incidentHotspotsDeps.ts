/**
 * Production wiring of GET /forest-changes/:id/hotspots: the pg pool, Redis `cached()` and the
 * OOPT list from the Overpass cache. The OOPT list is large, so a parsed copy is kept in memory
 * for OOPT_MEMO_MS instead of reading it from Redis for every card.
 */
import { cached } from '../utils/cache';
import type { QueryablePool } from './incidentsService';
import {
  INCIDENT_FOR_HOTSPOTS_SQL, INCIDENT_HOTSPOTS_SQL, hotspotIncidentFromRow, hotspotQueryParams, toHotspotList,
} from './incidentHotspots';
import { getOOPT, type OOPTResult } from './overpassService';
import { ooptProximity } from './ooptProximity';
import type { IncidentHotspotsDeps } from '../routes/incidentHotspots';

export const OOPT_MEMO_MS = 10 * 60 * 1000;

/** Reuses the last resolved value for `ttlMs`; a rejection is not remembered. */
export function memoizeAsync<T>(fn: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let memo: { value: T; at: number } | null = null;
  let pending: Promise<T> | null = null;
  return async () => {
    if (memo && now() - memo.at < ttlMs) return memo.value;
    if (!pending) {
      pending = fn()
        .then(value => { memo = { value, at: now() }; return value; })
        .finally(() => { pending = null; });
    }
    return pending;
  };
}

const loadOopt = memoizeAsync<OOPTResult>(getOOPT, OOPT_MEMO_MS);

export function createIncidentHotspotsDeps(pool: QueryablePool): IncidentHotspotsDeps {
  return {
    async loadIncident(id) {
      const { rows } = await pool.query(INCIDENT_FOR_HOTSPOTS_SQL, [id]);
      return rows[0] ? hotspotIncidentFromRow(rows[0]) : null;
    },
    async loadHotspots(window) {
      const { rows } = await pool.query(INCIDENT_HOTSPOTS_SQL, hotspotQueryParams(window));
      return toHotspotList(rows, window);
    },
    async ooptFor(point) {
      return ooptProximity(point, await loadOopt());
    },
    cached: (key, ttlSec, fetcher) => cached(key, ttlSec, fetcher),
  };
}
