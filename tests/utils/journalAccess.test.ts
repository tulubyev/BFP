jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn() }));

import { getRedis } from '../../backend/config/redis';
import { applyAccess, EMPTY_ACCESS, readAccess, readJournal, recordAccess } from '../../backend/utils/journal';

class FakeRedis {
  store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); return 'OK'; }
}

const t = (h: number) => new Date(Date.UTC(2026, 8, 29, h));

describe('applyAccess', () => {
  it('a failure opens the outage and keeps its start over later failures', () => {
    let s = applyAccess(EMPTY_ACCESS, true, t(0));
    s = applyAccess(s, false, t(1), 'HTTP 503');
    s = applyAccess(s, false, t(2), 'timeout');
    expect(s).toEqual({
      lastSuccessAt: t(0).toISOString(),
      lastFailureAt: t(2).toISOString(),
      failingSince: t(1).toISOString(),
      lastError: 'timeout',
    });
  });

  it('a success closes the outage but remembers the last failure time', () => {
    const s = applyAccess(applyAccess(EMPTY_ACCESS, false, t(1), 'x'), true, t(3));
    expect(s).toEqual({ lastSuccessAt: t(3).toISOString(), lastFailureAt: t(1).toISOString(), failingSince: null });
  });

  it('caps long error texts', () => {
    expect(applyAccess(EMPTY_ACCESS, false, t(1), 'e'.repeat(1000)).lastError).toHaveLength(300);
  });
});

describe('recordAccess', () => {
  let redis: FakeRedis;
  beforeEach(() => {
    redis = new FakeRedis();
    (getRedis as jest.Mock).mockReturnValue(redis);
  });

  it('writes the summary and a journal run', async () => {
    await recordAccess('gfw_loss', true, t(0));
    await recordAccess('gfw_loss', false, t(1), 'HTTP 502');
    expect(await readAccess('gfw_loss')).toMatchObject({ lastSuccessAt: t(0).toISOString(), failingSince: t(1).toISOString(), lastError: 'HTTP 502' });
    const runs = await readJournal('gfw_loss');
    expect(runs.map(r => r.outcome)).toEqual(['failed', 'updated']);
    expect(runs[0].error).toBe('HTTP 502');
  });

  it('is a no-op without Redis', async () => {
    (getRedis as jest.Mock).mockReturnValue(null);
    await expect(recordAccess('gfw_loss', true)).resolves.toBeUndefined();
    await expect(readAccess('gfw_loss')).resolves.toBeNull();
  });

  it('never throws when Redis does', async () => {
    (getRedis as jest.Mock).mockReturnValue({
      get: async () => { throw new Error('down'); },
      set: async () => { throw new Error('down'); },
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(recordAccess('gfw_loss', false, t(0), 'x')).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
