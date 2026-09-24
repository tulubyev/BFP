/** Classifies a data source's age against per-source thresholds. Pure — no I/O. */

export type FreshnessState = 'fresh' | 'stale' | 'failed' | 'unknown';

export interface FreshnessThresholds {
  /** Age (ms) up to which data counts as fresh. */
  staleAfterMs: number;
  /** Age (ms) beyond which data counts as failed (between the two = stale). */
  failedAfterMs: number;
}

/**
 * `ageMs` is how old the newest known data point is. `null` means we have no timestamp at
 * all (never fetched successfully, or the source has no runtime freshness signal) — 'unknown',
 * not 'failed': it is not evidence of an outage, just the absence of a check.
 */
export function computeState(ageMs: number | null, thresholds: FreshnessThresholds): FreshnessState {
  if (ageMs === null || ageMs < 0 || Number.isNaN(ageMs)) return 'unknown';
  if (ageMs <= thresholds.staleAfterMs) return 'fresh';
  if (ageMs <= thresholds.failedAfterMs) return 'stale';
  return 'failed';
}
