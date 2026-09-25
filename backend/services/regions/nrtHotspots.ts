/**
 * Current-season NRT hotspot counts per region, from the site's own history (gis.fire_hotspots,
 * written by the FIRMS history job since 2026-09-25). The database pre-aggregates detections on a
 * 0.01° grid so the query result stays small in a heavy season; cell centers are then assigned to
 * regions here (a cell straddling a border goes to one side — ~1 km, negligible at region scale).
 */
import { findRegion, type RegionShape } from '../firmsHistory/regions';
import { HOTSPOT_SOURCE } from '../firmsHistory/hotspotRows';

/** First day of the NRT history (the history job went live on 2026-09-25). */
export const NRT_HISTORY_SINCE = '2026-09-25';

export interface NrtCell {
  lat: number;
  lon: number;
  count: number;
  /** Newest acquisition date in the cell, YYYY-MM-DD. */
  lastDate: string;
}

export const NRT_CELLS_SQL = `SELECT round(latitude::numeric, 2)::float8 AS lat, round(longitude::numeric, 2)::float8 AS lon,`
  + ` count(*)::int AS n, to_char(max(acquisition_date), 'YYYY-MM-DD') AS last_date`
  + ` FROM gis.fire_hotspots WHERE source = $1 AND acquisition_date >= $2::date`
  + ` GROUP BY 1, 2`;

export interface QueryableLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export async function loadNrtCells(db: QueryableLike, since: string): Promise<NrtCell[]> {
  const { rows } = await db.query(NRT_CELLS_SQL, [HOTSPOT_SOURCE, since]);
  return rows.map(r => ({ lat: Number(r.lat), lon: Number(r.lon), count: Number(r.n), lastDate: String(r.last_date) }));
}

/** Sums cell counts per region ISO; every region is present (0 = none detected). */
export function countNrtByRegion(cells: NrtCell[], regions: RegionShape[]): { counts: Record<string, number>; lastDate: string | null } {
  const counts: Record<string, number> = Object.fromEntries(regions.map(r => [r.iso, 0]));
  let lastDate: string | null = null;
  for (const cell of cells) {
    const region = findRegion(cell.lat, cell.lon, regions);
    if (!region) continue;
    counts[region.iso] += cell.count;
    if (!lastDate || cell.lastDate > lastDate) lastDate = cell.lastDate;
  }
  return { counts, lastDate };
}
