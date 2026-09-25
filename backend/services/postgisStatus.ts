/**
 * Live reachability + freshness check for the local PostgreSQL/PostGIS database, used by
 * GET /api/sources/status. Dependency-injected (see sourceStatus.ts) so tests never need a real
 * database — the same pattern as incidentsService.ts's QueryablePool.
 */
import type { QueryablePool } from './incidentsService';

export interface PostgisCheckResult {
  reachable: boolean;
  /** Newest created_at across gis.forest_changes and gis.fire_hotspots, or null if both are empty. */
  newestRecordAt: Date | null;
}

const CHECK_QUERY = `
  SELECT GREATEST(
    (SELECT MAX(created_at) FROM gis.forest_changes),
    (SELECT MAX(created_at) FROM gis.fire_hotspots)
  ) AS newest
`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`PostGIS check timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Cheap live check: a trivial aggregate query proves the DB is reachable; its result also tells
 *  us how recent our own data is. Never throws — an unreachable DB just reports `reachable: false`. */
export async function checkPostgisStatus(pool: QueryablePool, timeoutMs = 2000): Promise<PostgisCheckResult> {
  try {
    const result = await withTimeout(pool.query(CHECK_QUERY), timeoutMs);
    const newest = result.rows[0]?.newest;
    return { reachable: true, newestRecordAt: newest ? new Date(newest) : null };
  } catch (err: any) {
    console.warn('PostGIS status check failed:', err.message);
    return { reachable: false, newestRecordAt: null };
  }
}
