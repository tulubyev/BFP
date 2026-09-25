import { computeState, worseState } from '../../backend/utils/freshness';

const THRESHOLDS = { staleAfterMs: 60_000, failedAfterMs: 300_000 };

describe('computeState', () => {
  it('is unknown when there is no timestamp at all', () => {
    expect(computeState(null, THRESHOLDS)).toBe('unknown');
  });

  it('is unknown for a negative or NaN age', () => {
    expect(computeState(-1, THRESHOLDS)).toBe('unknown');
    expect(computeState(NaN, THRESHOLDS)).toBe('unknown');
  });

  it('is fresh at and below the stale threshold', () => {
    expect(computeState(0, THRESHOLDS)).toBe('fresh');
    expect(computeState(60_000, THRESHOLDS)).toBe('fresh');
  });

  it('is stale between the two thresholds', () => {
    expect(computeState(60_001, THRESHOLDS)).toBe('stale');
    expect(computeState(300_000, THRESHOLDS)).toBe('stale');
  });

  it('is failed beyond the failed threshold', () => {
    expect(computeState(300_001, THRESHOLDS)).toBe('failed');
  });
});

describe('worseState', () => {
  it('picks the more severe of two known states', () => {
    expect(worseState('fresh', 'stale')).toBe('stale');
    expect(worseState('stale', 'fresh')).toBe('stale');
    expect(worseState('stale', 'failed')).toBe('failed');
    expect(worseState('failed', 'fresh')).toBe('failed');
  });

  it('keeps the known state when the other is unknown, either order', () => {
    expect(worseState('unknown', 'stale')).toBe('stale');
    expect(worseState('stale', 'unknown')).toBe('stale');
  });

  it('is unknown only when both are unknown', () => {
    expect(worseState('unknown', 'unknown')).toBe('unknown');
  });

  it('returns the shared state when both sides agree', () => {
    expect(worseState('fresh', 'fresh')).toBe('fresh');
  });
});
