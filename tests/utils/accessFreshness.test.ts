import { computeAccessState, type AccessTimes } from '../../backend/utils/freshness';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T = { staleAfterMs: 1 * HOUR, failedAfterMs: 3 * DAY };
const at = (ms: number) => new Date(Date.UTC(2026, 8, 20) + ms).toISOString();
const times = (o: Partial<AccessTimes>): AccessTimes => ({ lastSuccessAt: null, lastFailureAt: null, failingSince: null, ...o });

describe('computeAccessState', () => {
  it('no requests at all is unknown, never failed', () => {
    expect(computeAccessState(null, T)).toBe('unknown');
    expect(computeAccessState(times({}), T)).toBe('unknown');
  });

  it('a successful last access is fresh, however long ago (no traffic is no evidence of an outage)', () => {
    expect(computeAccessState(times({ lastSuccessAt: at(0) }), T)).toBe('fresh');
  });

  it('a recovery after failures is fresh', () => {
    expect(computeAccessState(times({ lastSuccessAt: at(5 * DAY), lastFailureAt: at(4 * DAY) }), T)).toBe('fresh');
  });

  it('a single failed request is a hiccup, not an outage — even if nothing was asked since', () => {
    const one = times({ lastSuccessAt: at(0), lastFailureAt: at(10 * DAY), failingSince: at(10 * DAY) });
    expect(computeAccessState(one, T)).toBe('fresh');
  });

  it('the outage is measured from the first failure, not from an old success', () => {
    // success 10 days ago, then 30 minutes of failures: not "10 days without a success"
    const s = times({ lastSuccessAt: at(0), failingSince: at(10 * DAY), lastFailureAt: at(10 * DAY + 30 * 60 * 1000) });
    expect(computeAccessState(s, T)).toBe('fresh');
  });

  it('failing for hours is stale', () => {
    const s = times({ lastSuccessAt: at(0), failingSince: at(DAY), lastFailureAt: at(DAY + 5 * HOUR) });
    expect(computeAccessState(s, T)).toBe('stale');
  });

  it('three days of failures without a single success is failed', () => {
    expect(computeAccessState(times({ lastSuccessAt: at(0), failingSince: at(DAY), lastFailureAt: at(DAY + 3 * DAY) }), T)).toBe('stale');
    expect(computeAccessState(times({ lastSuccessAt: at(0), failingSince: at(DAY), lastFailureAt: at(DAY + 3 * DAY + 1) }), T)).toBe('failed');
  });

  it('never reached at all and failing for days is failed', () => {
    expect(computeAccessState(times({ failingSince: at(0), lastFailureAt: at(4 * DAY) }), T)).toBe('failed');
  });

  it('garbage timestamps are treated as missing', () => {
    expect(computeAccessState(times({ lastSuccessAt: 'nope', lastFailureAt: 'nope', failingSince: 'nope' }), T)).toBe('unknown');
  });
});
