/**
 * Background computation of NDVI series (series.ts) behind GET /api/monitoring/forest-changes/:id/ndvi-series.
 *
 * - The request never computes: it reads what is ready and, when years are missing, queues a job in
 *   this process and answers `pending` with progress. The UI polls.
 * - At most one series runs at a time (its own limiter); jobs waiting or running are capped at 8, the
 *   next request gets QueueFullError (→ 503). COG reads inside a job go through the shared scene-check
 *   limit (ImageryDeps.schedule), so a series never crowds out the before/after scene checks.
 * - Every finished year is stored on its own (past years 365 days, the current one 7 days); a year
 *   that failed (network, source) is not stored and is recomputed by a later request after a cooldown.
 * - The whole series is `cached()` for 24 h once every year is known; while a newer version is being
 *   built, `cached()` keeps serving the last complete one.
 * - Finished years are also kept in memory for a while, so the series completes even without Redis.
 */
import { QueueFullError, createLimiter, withTimeout, type Limiter } from '../../utils/limiter';
import type { Bbox } from './geometry';
import {
  SERIES_TTL_SEC, SUMMER_WINDOW, seriesKey, seriesTarget, seriesYears, yearKey, yearTtlSec,
  type SeriesTarget, type SeriesYear,
} from './series';
import { LICENSE, SOURCE_NAME, attributionFor } from './service';
import { STAC_API_URL } from './stac';

export const MAX_SERIES_RUNNING = 1;
/** Series running or waiting; one more request → 503. */
export const MAX_SERIES_JOBS = 8;
/** Years of one series computed at once (their reads still wait for the shared scene-check limit). */
export const SERIES_YEAR_CONCURRENCY = 2;
/** One year that hangs past this is given up (not stored) and the job moves on. */
export const YEAR_TIMEOUT_MS = 120_000;
/** After a job with failed years, requests show what is ready for this long before trying again. */
export const FAILURE_COOLDOWN_MS = 5 * 60_000;
/** Finished jobs are remembered this long (progress, memory fallback without Redis). */
export const RECENT_MS = 10 * 60_000;

export interface YearStore {
  get(key: string): Promise<SeriesYear | null>;
  set(key: string, value: SeriesYear, ttlSec: number): Promise<void>;
}

export interface NdviSeriesDeps {
  store: YearStore;
  computeYear(target: SeriesTarget, year: number): Promise<SeriesYear>;
  /** `cached()` from utils/cache (keeps last-good). */
  cachedSeries<T>(key: string, ttlSec: number, fetcher: () => Promise<T>): Promise<T>;
  now?: () => Date;
  limiter?: Limiter;
  maxJobs?: number;
  yearConcurrency?: number;
  yearTimeoutMs?: number;
}

interface SeriesPayload {
  years: SeriesYear[];
  generatedAt: string;
}

export interface NdviSeriesResponse {
  incidentId: number;
  status: 'ready' | 'pending';
  /** Ready years, oldest first (pending: those computed so far). */
  years: SeriesYear[];
  progress: { done: number; total: number };
  /** Years that could not be computed (source unavailable); retried by a later request. */
  failedYears?: number[];
  aoi: Bbox;
  site: Bbox;
  window: typeof SUMMER_WINDOW;
  source: { name: string; url: string; license: string; attribution: string };
  generatedAt: string;
}

interface Job {
  results: Map<number, SeriesYear>;
  total: number;
}

interface Finished {
  results: Map<number, SeriesYear>;
  failedYears: number[];
  at: number;
}

class SeriesNotReady extends Error {
  constructor(public known: Map<number, SeriesYear>, public job: Job | null, public failedYears: number[]) {
    super('ndvi series not ready');
    this.name = 'SeriesNotReady';
  }
}

const byYear = (m: Map<number, SeriesYear>) => [...m.values()].sort((a, b) => a.year - b.year);

/** Runs `fn` over `items` with at most `n` at a time. */
async function eachLimit<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export function createNdviSeries(deps: NdviSeriesDeps) {
  const now = () => deps.now?.() ?? new Date();
  const limiter = deps.limiter ?? createLimiter(MAX_SERIES_RUNNING);
  const maxJobs = deps.maxJobs ?? MAX_SERIES_JOBS;
  const jobs = new Map<string, Job>();
  const finished = new Map<string, Finished>();

  const prune = () => {
    const t = now().getTime();
    for (const [key, f] of finished) if (t - f.at > RECENT_MS) finished.delete(key);
  };

  async function loadYears(target: SeriesTarget, years: number[]): Promise<Map<number, SeriesYear>> {
    const memory = finished.get(target.key)?.results;
    const known = new Map<number, SeriesYear>();
    await Promise.all(years.map(async year => {
      const hit = (await deps.store.get(yearKey(target, year))) ?? memory?.get(year) ?? null;
      if (hit) known.set(year, hit);
    }));
    return known;
  }

  function startJob(target: SeriesTarget, years: number[], known: Map<number, SeriesYear>): Job {
    if (jobs.size >= maxJobs) throw new QueueFullError();
    const job: Job = { results: new Map(known), total: years.length };
    jobs.set(target.key, job);
    const failedYears: number[] = [];
    limiter.run(async () => {
      const missing = years.filter(y => !job.results.has(y));
      await eachLimit(missing, deps.yearConcurrency ?? SERIES_YEAR_CONCURRENCY, async year => {
        try {
          const point = await withTimeout(deps.computeYear(target, year), deps.yearTimeoutMs ?? YEAR_TIMEOUT_MS, `ndvi ${year}`);
          job.results.set(year, point);
          await deps.store.set(yearKey(target, year), point, yearTtlSec(year, now()));
        } catch (err) {
          failedYears.push(year);
          console.warn(`ndvi series ${target.key} ${year} failed:`, (err as Error)?.message);
        }
      });
    })
      .catch(err => console.warn(`ndvi series ${target.key} failed:`, (err as Error)?.message))
      .finally(() => {
        finished.set(target.key, { results: job.results, failedYears: failedYears.sort((a, b) => a - b), at: now().getTime() });
        jobs.delete(target.key);
      });
    return job;
  }

  /** Complete series, or SeriesNotReady after making sure a job runs (unless a recent one failed). */
  async function build(target: SeriesTarget, years: number[]): Promise<SeriesPayload> {
    const known = await loadYears(target, years);
    if (known.size === years.length) return { years: byYear(known), generatedAt: now().toISOString() };
    const running = jobs.get(target.key);
    if (running) throw new SeriesNotReady(known, running, []);
    const recent = finished.get(target.key);
    if (recent && recent.failedYears.length && now().getTime() - recent.at < FAILURE_COOLDOWN_MS) {
      throw new SeriesNotReady(known, null, recent.failedYears);
    }
    throw new SeriesNotReady(known, startJob(target, years, known), []);
  }

  return {
    /** Never waits for the computation; QueueFullError when too many series are queued. */
    async get(incidentId: number, incidentBbox: Bbox): Promise<NdviSeriesResponse> {
      prune();
      const target = seriesTarget(incidentBbox);
      const years = seriesYears(now());
      const base = { incidentId, aoi: target.aoi, site: target.site, window: SUMMER_WINDOW };
      const source = (points: SeriesYear[]) => {
        const sceneYears = points.flatMap(p => (p.status === 'ok' ? [new Date(p.datetime).getUTCFullYear()] : []));
        return {
          name: SOURCE_NAME, url: STAC_API_URL, license: LICENSE,
          attribution: attributionFor(sceneYears.length ? sceneYears : [now().getUTCFullYear()]),
        };
      };
      try {
        const payload = await deps.cachedSeries(seriesKey(target), SERIES_TTL_SEC, () => build(target, years));
        return {
          ...base, status: 'ready', years: payload.years,
          progress: { done: payload.years.length, total: payload.years.length },
          source: source(payload.years), generatedAt: payload.generatedAt,
        };
      } catch (err) {
        if (!(err instanceof SeriesNotReady)) throw err;
        const results = err.job ? err.job.results : err.known;
        const points = byYear(results);
        return {
          ...base,
          status: err.job ? 'pending' : 'ready',
          years: points,
          progress: { done: results.size, total: years.length },
          ...(err.failedYears.length ? { failedYears: err.failedYears } : {}),
          source: source(points),
          generatedAt: now().toISOString(),
        };
      }
    },
    /** For tests and monitoring. */
    get jobs() { return jobs.size; },
  };
}
