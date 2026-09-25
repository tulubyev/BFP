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
