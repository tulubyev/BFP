/** Production wiring of GET /forest-changes/:id/context: the pg pool, Redis `cached()` and Overpass. */
import { cached } from '../../utils/cache';
import type { QueryablePool } from '../incidentsService';
import { INCIDENT_FOR_HOTSPOTS_SQL, hotspotIncidentFromRow } from '../incidentHotspots';
import type { IncidentContextDeps } from '../../routes/incidentContext';
import { createContextFetcher } from './overpass';

export function createIncidentContextDeps(pool: QueryablePool): IncidentContextDeps {
  return {
    async loadIncident(id) {
      const { rows } = await pool.query(INCIDENT_FOR_HOTSPOTS_SQL, [id]);
      return rows[0] ? hotspotIncidentFromRow(rows[0]) : null;
    },
    fetchContext: createContextFetcher(),
    cached: (key, ttlSec, fetcher) => cached(key, ttlSec, fetcher),
  };
}
