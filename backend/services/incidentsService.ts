import type { Request, Response } from 'express';
import { buildForestChangesQuery, forestChangesCacheKey, ForestChangesRawQuery } from './forestChangesQuery';

export interface QueryablePool {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

export interface ForestChangesResult {
  success: true;
  count: number;
  total: number;
  limit: number;
  offset: number;
  regions: string[];
  data: any[];
}

export interface IncidentsCacheLike {
  get<T>(key: string): Promise<{ data: T; fetched_at: string } | null>;
  set<T>(key: string, data: T, fetchedAt?: string): Promise<void>;
}

/** Regions for the filter: forest-area regions plus those stored on incidents (FIRMS). */
export const REGIONS_QUERY = `SELECT DISTINCT region FROM (`
  + `SELECT region FROM gis.forest_areas`
  + ` UNION SELECT metadata->>'region' AS region FROM gis.forest_changes WHERE metadata ? 'region'`
  + `) r WHERE region IS NOT NULL ORDER BY region`;

/** Runs the three forest-changes queries (page, total count, region list) against `pool`. */
export async function fetchForestChanges(pool: QueryablePool, rawQuery: ForestChangesRawQuery): Promise<ForestChangesResult> {
  const built = buildForestChangesQuery(rawQuery);

  const [result, totalResult, regionsResult] = await Promise.all([
    pool.query(built.dataQuery, built.dataParams),
    pool.query(built.countQuery, built.params),
    pool.query(REGIONS_QUERY),
  ]);

  return {
    success: true,
    count: result.rows.length,
    total: totalResult.rows[0]?.count || 0,
    limit: built.limit,
    offset: built.offset,
    regions: regionsResult.rows.map(row => row.region),
    data: result.rows,
  };
}

/**
 * Builds the GET /forest-changes handler. On a DB failure it serves the last known-good result
 * for the same normalized query from `cache` (`mode: 'cache'`, with `fetched_at`); with nothing
 * cached for that query it returns 503. A successful live query always refreshes the cache entry
 * before responding, so a later outage has something to fall back to.
 * Never falls back to demo/sample data (project principle in future.md §3).
 */
export function createForestChangesHandler(pool: QueryablePool, cache: IncidentsCacheLike) {
  return async function forestChangesHandler(req: Request, res: Response): Promise<void> {
    const rawQuery = req.query as ForestChangesRawQuery;
    const cacheKey = forestChangesCacheKey(rawQuery);
    try {
      const result = await fetchForestChanges(pool, rawQuery);
      await cache.set(cacheKey, result);
      res.json({ ...result, mode: 'live' });
    } catch (error) {
      console.error('Error fetching forest changes:', error);
      const lastGood = await cache.get<ForestChangesResult>(cacheKey);
      if (lastGood) {
        res.json({ ...lastGood.data, mode: 'cache', fetched_at: lastGood.fetched_at });
      } else {
        res.status(503).json({
          success: false,
          error: 'База данных недоступна, и для этого запроса ещё нет сохранённой копии данных',
        });
      }
    }
  };
}
