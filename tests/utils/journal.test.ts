jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn() }));

import { getRedis } from '../../backend/config/redis';
import { lastAttempt, lastSuccess, pushRun, readJournal, recordRun, trimRuns, type JournalEntry } from '../../backend/utils/journal';

class FakeRedis {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
}

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    startedAt: '2026-09-24T00:00:00.000Z',
    finishedAt: '2026-09-24T00:00:01.000Z',
    durationMs: 1000,
    outcome: 'updated',
    ...overrides,
  };
}

describe('trimRuns', () => {
  it('keeps only the newest `max` runs', () => {
    const runs = Array.from({ length: 25 }, (_, i) => entry({ durationMs: i }));
    expect(trimRuns(runs, 20)).toHaveLength(20);
    expect(trimRuns(runs, 20)[0]).toEqual(runs[0]);
  });

  it('leaves a shorter list untouched', () => {
    const runs = [entry(), entry()];
    expect(trimRuns(runs, 20)).toEqual(runs);
  });
});

describe('pushRun', () => {
  it('prepends the new run, newest first', () => {
    const older = entry({ durationMs: 1 });
    const newer = entry({ durationMs: 2 });
    expect(pushRun([older], newer)).toEqual([newer, older]);
  });

  it('drops the oldest run once past the cap', () => {
    const runs = Array.from({ length: 20 }, (_, i) => entry({ durationMs: i }));
    const updated = pushRun(runs, entry({ durationMs: 99 }), 20);
    expect(updated).toHaveLength(20);
    expect(updated[0].durationMs).toBe(99);
    expect(updated.some(r => r.durationMs === 19)).toBe(false); // the oldest one fell off
  });
});

describe('lastAttempt', () => {
  it('is the newest run regardless of outcome', () => {
    const runs = [entry({ outcome: 'failed' }), entry({ outcome: 'updated' })];
    expect(lastAttempt(runs)).toBe(runs[0]);
  });

  it('is null for an empty journal', () => {
    expect(lastAttempt([])).toBeNull();
  });
});

describe('lastSuccess', () => {
  it('skips failed runs to find the newest success', () => {
    const success = entry({ outcome: 'kept-cached' });
    const runs = [entry({ outcome: 'failed' }), success, entry({ outcome: 'updated' })];
    expect(lastSuccess(runs)).toBe(success);
  });

  it('is null when every run failed', () => {
    const runs = [entry({ outcome: 'failed' }), entry({ outcome: 'failed' })];
    expect(lastSuccess(runs)).toBeNull();
  });
});

describe('recordRun / readJournal (Redis-backed)', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    (getRedis as jest.Mock).mockReturnValue(redis);
  });

  it('reads an empty journal for a source that never ran', async () => {
    await expect(readJournal('firms')).resolves.toEqual([]);
  });

  it('records a run and reads it back, newest first', async () => {
    await recordRun('firms', entry({ outcome: 'updated', items: 42 }));
    await recordRun('firms', entry({ outcome: 'failed', error: 'timeout' }));
    const runs = await readJournal('firms');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ outcome: 'failed', error: 'timeout' });
    expect(runs[1]).toMatchObject({ outcome: 'updated', items: 42 });
  });

  it('caps stored runs at 20', async () => {
    for (let i = 0; i < 25; i++) await recordRun('oopt', entry({ durationMs: i }));
    const runs = await readJournal('oopt');
    expect(runs).toHaveLength(20);
    expect(runs[0].durationMs).toBe(24);
  });

  it('is a no-op without a Redis client', async () => {
    (getRedis as jest.Mock).mockReturnValue(null);
    await expect(recordRun('firms', entry())).resolves.toBeUndefined();
    await expect(readJournal('firms')).resolves.toEqual([]);
  });
});
