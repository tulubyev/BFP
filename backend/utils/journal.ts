/**
 * Load journal: per-source history of background refresh runs (jobs/refresh.ts), kept in Redis
 * so the last N runs survive an app restart. Independent of cache.ts — it never affects what
 * cached()/warm() serve, it only records what happened.
 */
import { getRedis } from '../config/redis';

export type JournalOutcome = 'updated' | 'kept-cached' | 'failed';

export interface JournalEntry {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: JournalOutcome;
  /** Item count, where cheaply available (e.g. cached list length). */
  items?: number;
  /** Rows written to the database (history jobs, e.g. firms_history). */
  written?: number;
  /** Items dropped as malformed. */
  rejected?: number;
  /** Incidents created/updated/deactivated by the run (firms_history). */
  incidents?: { created: number; updated: number; deactivated: number };
  /**
   * Static heat source mask (firms_history): hotspots left out of clustering, incidents re-labelled
   * 'static_source' by the run, static locations in the mask.
   */
  masked?: { hotspots: number; incidents: number; staticLocations: number };
  /** Source names that could not be matched (regions: Rosleshoz subject names without an ISO code). */
  unmapped?: string[];
  /** Present only when outcome is 'failed'. */
  error?: string;
}

export const MAX_RUNS = 20;

/** Keeps only the newest `max` runs (runs are ordered newest first). */
export function trimRuns(runs: JournalEntry[], max: number = MAX_RUNS): JournalEntry[] {
  return runs.slice(0, max);
}

/** Prepends a new run and trims to `max`. */
export function pushRun(runs: JournalEntry[], entry: JournalEntry, max: number = MAX_RUNS): JournalEntry[] {
  return trimRuns([entry, ...runs], max);
}

export function lastAttempt(runs: JournalEntry[]): JournalEntry | null {
  return runs[0] ?? null;
}

export function lastSuccess(runs: JournalEntry[]): JournalEntry | null {
  return runs.find(r => r.outcome !== 'failed') ?? null;
}

const journalKey = (source: string) => `journal:${source}`;

export async function readJournal(source: string): Promise<JournalEntry[]> {
  const client = getRedis();
  if (!client) return [];
  try {
    const raw = await client.get(journalKey(source));
    return raw ? (JSON.parse(raw) as JournalEntry[]) : [];
  } catch (err: any) {
    console.warn(`journal read ${source} failed:`, err.message);
    return [];
  }
}

/** Appends one run to a source's journal, keeping only the newest MAX_RUNS. No-op without Redis. */
export async function recordRun(source: string, entry: JournalEntry): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    const existing = await readJournal(source);
    const updated = pushRun(existing, entry);
    await client.set(journalKey(source), JSON.stringify(updated));
  } catch (err: any) {
    console.warn(`journal write ${source} failed:`, err.message);
  }
}

/**
 * Access record for sources fetched on demand (GFW tiles, the Sentinel-2 catalogue): when a request
 * of ours last reached the source and when it last failed. "We can still reach it", not how fresh
 * the source's data is. Kept apart from the run list because 20 throttled failures would push the
 * last success out of it long before an outage becomes worth reporting.
 */
export interface AccessSummary {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** First failure after the last success; null while the last recorded access succeeded. */
  failingSince: string | null;
  lastError?: string;
}

export const EMPTY_ACCESS: AccessSummary = { lastSuccessAt: null, lastFailureAt: null, failingSince: null };

/** Folds one access outcome into the summary. Pure. */
export function applyAccess(
  summary: AccessSummary,
  ok: boolean,
  at: Date,
  error?: string,
): AccessSummary {
  const iso = at.toISOString();
  if (ok) return { lastSuccessAt: iso, lastFailureAt: summary.lastFailureAt, failingSince: null };
  return {
    lastSuccessAt: summary.lastSuccessAt,
    lastFailureAt: iso,
    failingSince: summary.failingSince ?? iso,
    ...(error ? { lastError: error.slice(0, 300) } : {}),
  };
}

const accessKey = (source: string) => `access:${source}`;

export async function readAccess(source: string): Promise<AccessSummary | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    const raw = await client.get(accessKey(source));
    return raw ? (JSON.parse(raw) as AccessSummary) : null;
  } catch (err: any) {
    console.warn(`access read ${source} failed:`, err.message);
    return null;
  }
}

/**
 * Records one access outcome: the summary under `access:<source>` and a run in `journal:<source>`
 * ('updated' = reached the source, 'failed' = did not). No-op without Redis; never throws.
 * Throttling is the caller's job (services/sourceAccess.ts).
 */
export async function recordAccess(source: string, ok: boolean, at: Date = new Date(), error?: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    const current = (await readAccess(source)) ?? EMPTY_ACCESS;
    await client.set(accessKey(source), JSON.stringify(applyAccess(current, ok, at, error)));
  } catch (err: any) {
    console.warn(`access write ${source} failed:`, err.message);
  }
  const iso = at.toISOString();
  await recordRun(source, {
    startedAt: iso,
    finishedAt: iso,
    durationMs: 0,
    outcome: ok ? 'updated' : 'failed',
    ...(!ok && error ? { error: error.slice(0, 300) } : {}),
  });
}
