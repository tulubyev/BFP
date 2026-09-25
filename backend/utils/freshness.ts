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

const SEVERITY: Record<FreshnessState, number> = { unknown: -1, fresh: 0, stale: 1, failed: 2 };

/**
 * Combines two independent freshness signals for the same source (e.g. "is the upstream
 * publication current" and "are we ourselves still able to fetch it") into one state — the more
 * concerning of the two. 'unknown' carries no information, so it never outweighs a known state.
 */
export function worseState(a: FreshnessState, b: FreshnessState): FreshnessState {
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}
