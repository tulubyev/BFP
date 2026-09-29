/**
 * Retention of the FIRMS hotspot history (gis.fire_hotspots): the last HOTSPOT_RETENTION_DAYS days.
 * Deleting goes through gis.purge_old_hotspots() (migration 012, SECURITY DEFINER): the application
 * role has no DELETE right on the table itself.
 *
 * What relies on the window: the static-source mask (14 days), incident clustering (72 h), the
 * regional NRT indicator and the daily chart on the analytics page. Incidents older than the window
 * keep their record but lose their hotspot points (the card says so).
 */
export const HOTSPOT_RETENTION_DAYS = 30;

/** SQLSTATE 42883: the function does not exist (migration 012 not applied). */
export const UNDEFINED_FUNCTION = '42883';

export const PURGE_SQL = 'SELECT gis.purge_old_hotspots() AS deleted';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Oldest acquisition date (YYYY-MM-DD, UTC) still kept; older days are deleted. */
export function retentionCutoff(now: Date, days: number = HOTSPOT_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

export class RetentionMigrationMissingError extends Error {
  constructor() {
    super('migration 012 not applied: function gis.purge_old_hotspots() does not exist');
    this.name = 'RetentionMigrationMissingError';
  }
}

export interface QueryableLike {
  query(text: string): Promise<{ rows: any[] }>;
}

/** Deletes hotspots older than the window; returns how many rows went. */
export async function purgeOldHotspots(db: QueryableLike): Promise<number> {
  try {
    const { rows } = await db.query(PURGE_SQL);
    const deleted = Number(rows[0]?.deleted);
    return Number.isFinite(deleted) ? deleted : 0;
  } catch (err: any) {
    if (err?.code === UNDEFINED_FUNCTION) throw new RetentionMigrationMissingError();
    throw err;
  }
}
