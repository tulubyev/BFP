/**
 * Background refresh of external data in Redis, so API requests never wait for a slow source.
 */
import { firmsService } from '../services/firmsService';
import { refreshOOPT } from '../services/overpassService';
import { refreshRosleshoz } from '../services/rosleskhozService';

export interface RefreshJob {
  name: string;
  firstDelayMs: number;
  everyMs: number;
  /** Resolves false when the source failed and the cached value was kept. */
  run: () => Promise<boolean>;
}

const MIN = 60 * 1000;

export const DEFAULT_JOBS: RefreshJob[] = [
  { name: 'firms', firstDelayMs: 5 * 1000, everyMs: 30 * MIN, run: () => firmsService.refreshRussia() },
  { name: 'rosleshoz', firstDelayMs: 20 * 1000, everyMs: 12 * 60 * MIN, run: refreshRosleshoz },
  { name: 'oopt', firstDelayMs: 60 * 1000, everyMs: 24 * 60 * MIN, run: refreshOOPT },
];

/** Starts the jobs; returns a function that stops them. A run is skipped while the previous one is busy. */
export function startRefreshJobs(jobs: RefreshJob[] = DEFAULT_JOBS): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const job of jobs) {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      const started = Date.now();
      try {
        const ok = await job.run();
        console.log(`[refresh] ${job.name}: ${ok ? 'updated' : 'source failed, kept cached'} (${Date.now() - started} ms)`);
      } catch (err: any) {
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
