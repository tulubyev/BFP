/**
 * FIRMS history job, run after each successful FIRMS refresh (jobs/refresh.ts):
 *   1. write the Russia-wide snapshot into gis.fire_hotspots (idempotent);
 *   2. cluster the last 72 h of hotspots in the Baikal regions;
 *   3. create/update FIRMS fire incidents in gis.forest_changes;
 *   4. record the run in the load journal (source `firms_history`).
 * Never throws: failures (e.g. migration 011 not applied) become a 'failed' journal entry.
 */
import { parseAcquisition, type FIRMSHotspot } from '../firmsService';
import type { JournalEntry } from '../../utils/journal';
import { clusterPoints, type ClusterPoint } from './clusters';
import { normalizeConfidence } from './hotspotRows';
import { planIncidents, WINDOW_HOURS } from './incidents';
import { findRegion, unionBbox, type RegionShape } from './regions';
import { MigrationMissingError, type FirmsHistoryStore, type StoredHotspot } from './store';

export const JOURNAL_SOURCE = 'firms_history';

const HOUR_MS = 60 * 60 * 1000;

export interface FirmsHistoryDeps {
  store: FirmsHistoryStore;
  /** The current Russia-wide snapshot (Redis last-good value). */
  loadSnapshot: () => Promise<FIRMSHotspot[] | null>;
  /** Baikal region shapes; may throw if the boundaries file is missing. */
  loadRegions: () => RegionShape[];
  record: (source: string, entry: JournalEntry) => Promise<void>;
  now?: () => Date;
}

export interface FirmsHistorySummary {
  received: number;
  written: number;
  rejected: number;
  clusters: number;
  created: number;
  updated: number;
  deactivated: number;
}

/** Stored hotspots → cluster points: only those acquired since `cutoff` and inside a Baikal region. */
export function toClusterPoints(rows: StoredHotspot[], regions: RegionShape[], cutoff: Date): ClusterPoint[] {
  const points: ClusterPoint[] = [];
  for (const r of rows) {
    const acquired = parseAcquisition(r.acqDate, r.acqTime ?? '0000');
    if (!acquired || acquired < cutoff) continue;
    const region = findRegion(r.lat, r.lon, regions);
    if (!region) continue;
    points.push({
      id: r.id,
      lat: r.lat,
      lon: r.lon,
      satellite: r.satellite,
      acquiredAt: acquired.toISOString(),
      confidence: normalizeConfidence(r.confidence),
      frp: r.frp,
      regionIso: region.iso,
      regionName: region.name,
    });
  }
  return points;
}

export async function runFirmsHistory(deps: FirmsHistoryDeps): Promise<FirmsHistorySummary | null> {
  const now = deps.now?.() ?? new Date();
  // Journal times use the wall clock; `now` (injectable for tests) drives the 72 h / 48 h logic.
  const started = Date.now();
  const finish = (entry: Omit<JournalEntry, 'startedAt' | 'finishedAt' | 'durationMs'>) => {
    const finished = Date.now();
    return deps.record(JOURNAL_SOURCE, {
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      ...entry,
    });
  };

  let regions: RegionShape[] | null = null;
  let regionsError: string | null = null;
  try {
    regions = deps.loadRegions();
  } catch (err: any) {
    regionsError = String(err?.message ?? err);
  }

  try {
    const snapshot = (await deps.loadSnapshot()) ?? [];
    const summary = await deps.store.transaction(async tx => {
      const { written, rejected } = await tx.insertHotspots(snapshot);
      const result: FirmsHistorySummary = {
        received: snapshot.length, written, rejected, clusters: 0, created: 0, updated: 0, deactivated: 0,
      };
      const bbox = regions && unionBbox(regions);
      if (!regions || !bbox) return result;

      const cutoff = new Date(now.getTime() - WINDOW_HOURS * HOUR_MS);
      const rows = await tx.loadHotspots(cutoff.toISOString().slice(0, 10), bbox);
      const clusters = clusterPoints(toClusterPoints(rows, regions, cutoff));
      const existing = await tx.loadFirmsIncidents(cutoff.toISOString());
      const plan = planIncidents(clusters, existing, now);

      for (const row of plan.creates) await tx.insertIncident(row);
      for (const { id, row } of plan.updates) await tx.updateIncident(id, row);
      for (const { id, status } of plan.statusChanges) await tx.setIncidentStatus(id, status);

      return {
        ...result,
        clusters: clusters.length,
        created: plan.creates.length,
        updated: plan.updates.length,
        deactivated: plan.statusChanges.filter(c => c.status === 'inactive').length,
      };
    });

    const counts = {
      items: summary.received,
      written: summary.written,
      rejected: summary.rejected,
      incidents: { created: summary.created, updated: summary.updated, deactivated: summary.deactivated },
    };
    if (regionsError) {
      await finish({ outcome: 'failed', ...counts, error: `hotspots written, incidents skipped: ${regionsError}`.slice(0, 300) });
    } else {
      await finish({ outcome: 'updated', ...counts });
    }
    console.log(`[firms-history] ${summary.written}/${summary.received} hotspots written, `
      + `${summary.created} incidents created, ${summary.updated} updated, ${summary.deactivated} deactivated`);
    return summary;
  } catch (err: any) {
    const message = err instanceof MigrationMissingError ? err.message : String(err?.message ?? err);
    await finish({ outcome: 'failed', error: message.slice(0, 300) });
    console.warn('[firms-history] failed:', message);
    return null;
  }
}
