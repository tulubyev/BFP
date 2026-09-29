/**
 * Background refresh of external data in Redis, so API requests never wait for a slow source.
 */
import { FIRMS_KEY, firmsService } from '../services/firmsService';
import { OOPT_KEY, refreshOOPT, type OOPTResult } from '../services/overpassService';
import { refreshRosleshoz } from '../services/rosleskhozService';
import { runFirmsHistory } from '../services/firmsHistory/ingest';
import { loadBaikalRegions } from '../services/firmsHistory/regions';
import { loadArchiveStaticCells } from '../services/firmsHistory/staticSources';
import { createPgFirmsHistoryStore } from '../services/firmsHistory/store';
import { purgeOldHotspots } from '../services/hotspotRetention';
import { readLastGood } from '../utils/cache';
import { recordRun, type JournalEntry, type JournalOutcome } from '../utils/journal';
import { drainQuality, summarizeForJournal } from '../services/quality/log';

export interface RefreshJob {
  name: string;
  firstDelayMs: number;
  everyMs: number;
  /** Resolves false when the source failed and the cached value was kept. */
  run: () => Promise<boolean>;
  /** Cheap item count for the load journal, read after a run (e.g. cached list length). */
  count?: () => Promise<number | undefined>;
  /**
   * Source whose quality gate results (services/quality/) go into the run's journal entry:
   * dropped items as `rejected`; a rejected input makes the run 'failed' with the reason as `error`
   * (the cached value was kept, but the source did not give us usable data).
   */
  qualitySource?: string;
}

/** Journal fields from the quality results reported since the previous run of this job. */
export function qualityFields(
  source: string | undefined,
  outcome: JournalOutcome,
  drain: (source: string) => ReturnType<typeof drainQuality> = drainQuality,
): Pick<JournalEntry, 'outcome' | 'rejected' | 'error'> {
  if (!source) return { outcome };
  const { rejected, failures } = summarizeForJournal(drain(source));
  return {
    outcome: failures.length ? 'failed' : outcome,
    ...(rejected > 0 ? { rejected } : {}),
    ...(failures.length ? { error: `quality check: ${failures.join('; ')}`.slice(0, 300) } : {}),
  };
}

const MIN = 60 * 1000;

/**
 * FIRMS refresh, then (only when it succeeded) the history job: hotspots → gis.fire_hotspots,
 * Baikal clusters → fire incidents. The history job journals itself under `firms_history` and
 * never throws, so its failure (e.g. migration 011 not applied) never marks the map layer failed.
 */
export async function refreshFirmsWithHistory(
  refresh: () => Promise<boolean> = () => firmsService.refreshRussia(),
  history: () => Promise<unknown> = async () => runFirmsHistory({
    // Loaded lazily: importing the pool opens a database connection.
    store: createPgFirmsHistoryStore((await import('../config/database')).default),
    loadSnapshot: () => readLastGood(FIRMS_KEY),
    loadRegions: () => loadBaikalRegions().regions,
    loadArchiveCells: () => loadArchiveStaticCells(),
    record: recordRun,
  }),
): Promise<boolean> {
  const ok = await refresh();
  if (ok) await history().catch((err: any) => console.warn('[firms-history] failed:', err?.message ?? err));
  return ok;
}

/** Daily hotspot retention (see hotspotRetention.ts); the deleted count goes to the journal as `items`. */
export function createHotspotRetentionJob(
  purge: () => Promise<number> = async () => purgeOldHotspots((await import('../config/database')).default),
): RefreshJob {
  let lastDeleted: number | undefined;
  return {
    name: 'hotspot_retention',
    firstDelayMs: 10 * MIN,
    everyMs: 24 * 60 * MIN,
    run: async () => {
      lastDeleted = await purge();
      if (lastDeleted > 0) console.log(`[hotspot_retention] deleted ${lastDeleted} hotspots older than the window`);
      return true;
    },
    count: async () => lastDeleted,
  };
}

export const DEFAULT_JOBS: RefreshJob[] = [
  {
    name: 'firms',
    firstDelayMs: 5 * 1000,
    everyMs: 30 * MIN,
    run: () => refreshFirmsWithHistory(),
    count: () => readLastGood<unknown[]>(FIRMS_KEY).then(v => v?.length),
  },
  { name: 'rosleshoz', firstDelayMs: 20 * 1000, everyMs: 12 * 60 * MIN, run: refreshRosleshoz, qualitySource: 'rosleshoz' },
  createHotspotRetentionJob(),
  {
    name: 'oopt',
    firstDelayMs: 60 * 1000,
    everyMs: 24 * 60 * MIN,
    run: refreshOOPT,
    qualitySource: 'oopt',
    count: () => readLastGood<OOPTResult>(OOPT_KEY).then(v => v?.features?.length),
  },
];

/** Starts the jobs; returns a function that stops them. A run is skipped while the previous one is busy. */
export function startRefreshJobs(jobs: RefreshJob[] = DEFAULT_JOBS): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const job of jobs) {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const startedAt = new Date();
      try {
        const ok = await job.run();
        const items = await job.count?.().catch(() => undefined);
        const quality = qualityFields(job.qualitySource, ok ? 'updated' : 'kept-cached');
        await recordRun(job.name, {
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          items,
          ...quality,
        });
        console.log(`[refresh] ${job.name}: ${quality.error ?? (ok ? 'updated' : 'source failed, kept cached')} (${Date.now() - startedAt.getTime()} ms)`);
      } catch (err: any) {
        const { rejected } = qualityFields(job.qualitySource, 'failed');
        await recordRun(job.name, {
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          outcome: 'failed',
          ...(rejected ? { rejected } : {}),
          error: String(err?.message ?? err).slice(0, 300),
        });
        console.warn(`[refresh] ${job.name} failed:`, err.message);
      } finally {
        busy = false;
      }
    };
    timers.push(setTimeout(() => {
      void tick();
      timers.push(setInterval(tick, job.everyMs));
    }, job.firstDelayMs));
  }

  return () => timers.forEach(t => {
    clearTimeout(t);
    clearInterval(t);
  });
}
