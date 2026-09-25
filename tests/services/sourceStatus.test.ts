jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn() }));

import { getRedis } from '../../backend/config/redis';
import { getSourceStatus } from '../../backend/services/sourceStatus';
import { getSourceDefinition } from '../../backend/services/sourceRegistry';
import { OOPT_KEY } from '../../backend/services/overpassService';

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

const NOW = new Date('2026-09-24T12:00:00.000Z');

describe('getSourceStatus', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    (getRedis as jest.Mock).mockReturnValue(redis);
  });

  it('firms: fresh right after a recent acquisition, with the journal attached', async () => {
    redis.store.set(
      'firms:viirs:ru:last-good',
      JSON.stringify([{ acq_date: '2026-09-24', acq_time: '1000' }, { acq_date: '2026-09-24', acq_time: '0800' }]),
    );
    redis.store.set(
      'journal:firms',
      JSON.stringify([{ startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 500, outcome: 'updated', items: 2 }]),
    );
    const status = await getSourceStatus(getSourceDefinition('firms')!, NOW);
    expect(status.state).toBe('fresh');
    expect(status.freshness?.ageMs).toBe(2 * 60 * 60 * 1000);
    expect(status.journal?.lastAttempt?.outcome).toBe('updated');
  });

  it('firms: attaches the history journal (hotspots written, incidents) next to the refresh journal', async () => {
    const failed = { startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 5, outcome: 'failed', error: 'migration 011 not applied: …' };
    const ok = { startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 900, outcome: 'updated', items: 10, written: 7, incidents: { created: 1, updated: 0, deactivated: 0 } };
    redis.store.set('journal:firms_history', JSON.stringify([failed, ok]));
    const status = await getSourceStatus(getSourceDefinition('firms')!, NOW);
    expect(status.historyJournal?.lastAttempt?.error).toContain('migration 011 not applied');
    expect(status.historyJournal?.lastSuccess).toMatchObject({ written: 7, incidents: { created: 1 } });
    const oopt = await getSourceStatus(getSourceDefinition('oopt')!, NOW);
    expect(oopt.historyJournal).toBeUndefined();
  });

  it('firms: failed once the newest acquisition is far too old', async () => {
    redis.store.set('firms:viirs:ru:last-good', JSON.stringify([{ acq_date: '2026-09-20', acq_time: '0000' }]));
    const status = await getSourceStatus(getSourceDefinition('firms')!, NOW);
    expect(status.state).toBe('failed');
  });

  it('oopt: stale between the two thresholds', async () => {
    const fetchedAt = new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(); // 48h old (36h..4d = stale)
    redis.store.set(`${OOPT_KEY}:last-good`, JSON.stringify({ features: [1, 2, 3], source: 'x', fetchedAt }));
    const status = await getSourceStatus(getSourceDefinition('oopt')!, NOW);
    expect(status.state).toBe('stale');
  });

  it('gfw_dist: reads the resolved DIST-ALERT version date', async () => {
    redis.store.set('gfw:dist:version:last-good', JSON.stringify('v20260920'));
    const status = await getSourceStatus(getSourceDefinition('gfw_dist')!, NOW);
    expect(status.state).toBe('fresh');
    expect(status.freshness?.timestamp).toBe('2026-09-20T00:00:00.000Z');
  });

  it('a static, unmonitored source (postgis) has no journal and an unknown state', async () => {
    const status = await getSourceStatus(getSourceDefinition('postgis')!, NOW);
    expect(status.state).toBe('unknown');
    expect(status.freshness).toBeNull();
    expect(status.journal).toBeNull();
  });

  it('a monitored source with no data yet is unknown, not failed', async () => {
    const status = await getSourceStatus(getSourceDefinition('firms')!, NOW);
    expect(status.state).toBe('unknown');
    expect(status.freshness).toBeNull();
    expect(status.journal).toEqual({ lastAttempt: null, lastSuccess: null, runs: [] });
  });
});
