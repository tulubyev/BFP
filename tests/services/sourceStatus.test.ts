jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn() }));

import { getRedis } from '../../backend/config/redis';
import { getAllSourcesStatus, getSourceStatus } from '../../backend/services/sourceStatus';
import { getSourceDefinition } from '../../backend/services/sourceRegistry';
import { OOPT_KEY } from '../../backend/services/overpassService';
import * as rosleskhoz from '../../backend/services/rosleskhozService';

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

  it('postgis without an injected pool stays unknown rather than guessing', async () => {
    const status = await getSourceStatus(getSourceDefinition('postgis')!, NOW);
    expect(status.state).toBe('unknown');
    expect(status.freshness).toBeNull();
    expect(status.journal).toBeNull();
  });

  describe('postgis: live check via a dependency-injected pool', () => {
    const postgis = () => getSourceDefinition('postgis')!;

    function fakePool(overrides: Partial<{ newest: string | null; fail: boolean }> = {}) {
      const { newest = null, fail = false } = overrides;
      return {
        query: jest.fn(async () => {
          if (fail) throw new Error('connection refused');
          return { rows: [{ newest }] };
        }),
      };
    }

    it('is fresh, with the newest record date, when the DB responds', async () => {
      const pool = fakePool({ newest: '2026-09-20T12:00:00.000Z' });
      const status = await getSourceStatus(postgis(), NOW, pool);
      expect(status.state).toBe('fresh');
      expect(status.freshness?.timestamp).toBe('2026-09-20T12:00:00.000Z');
      expect(status.journal).toBeNull();
    });

    it('is fresh with no freshness timestamp when the tables are empty', async () => {
      const pool = fakePool({ newest: null });
      const status = await getSourceStatus(postgis(), NOW, pool);
      expect(status.state).toBe('fresh');
      expect(status.freshness).toBeNull();
    });

    it('is failed when the DB is unreachable', async () => {
      const pool = fakePool({ fail: true });
      const status = await getSourceStatus(postgis(), NOW, pool);
      expect(status.state).toBe('failed');
      expect(status.freshness).toBeNull();
    });

    it('getAllSourcesStatus threads the injected pool through to postgis', async () => {
      const pool = fakePool({ newest: '2026-09-20T12:00:00.000Z' });
      const statuses = await getAllSourcesStatus(NOW, pool);
      const status = statuses.find(s => s.id === 'postgis')!;
      expect(status.state).toBe('fresh');
    });
  });

  it('a monitored source with no data yet is unknown, not failed', async () => {
    const status = await getSourceStatus(getSourceDefinition('firms')!, NOW);
    expect(status.state).toBe('unknown');
    expect(status.freshness).toBeNull();
    expect(status.journal).toEqual({ lastAttempt: null, lastSuccess: null, runs: [] });
  });

  describe('rosleshoz: annual cadence + our own download health', () => {
    const rosleshoz = () => getSourceDefinition('rosleshoz')!;

    it('exposes its cadence for the frontend to label instead of showing a relative age', async () => {
      const status = await getSourceStatus(rosleshoz(), NOW);
      expect(status.cadence).toBe('annual');
    });

    it('a dataset published 99 days ago with healthy downloads reads as fresh, not stale', async () => {
      redis.store.set(
        'journal:rosleshoz',
        JSON.stringify([{ startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 500, outcome: 'updated' }]),
      );
      const publishedAt = new Date(NOW.getTime() - 99 * 24 * 60 * 60 * 1000);
      jest.spyOn(rosleskhoz, 'latestDatasetModified').mockReturnValue(publishedAt);
      try {
        const status = await getSourceStatus(rosleshoz(), NOW);
        expect(status.state).toBe('fresh');
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('a publication over 800 days old is failed even if our downloads keep succeeding', async () => {
      redis.store.set(
        'journal:rosleshoz',
        JSON.stringify([{ startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 500, outcome: 'updated' }]),
      );
      const publishedAt = new Date(NOW.getTime() - 900 * 24 * 60 * 60 * 1000);
      jest.spyOn(rosleskhoz, 'latestDatasetModified').mockReturnValue(publishedAt);
      try {
        const status = await getSourceStatus(rosleshoz(), NOW);
        expect(status.state).toBe('failed');
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('a recent publication is downgraded to stale when our own downloads have been failing for a week', async () => {
      const lastSuccessAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
      redis.store.set(
        'journal:rosleshoz',
        JSON.stringify([
          { startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 500, outcome: 'failed', error: 'meta.csv 404' },
          { startedAt: lastSuccessAt.toISOString(), finishedAt: lastSuccessAt.toISOString(), durationMs: 500, outcome: 'updated' },
        ]),
      );
      const publishedAt = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
      jest.spyOn(rosleskhoz, 'latestDatasetModified').mockReturnValue(publishedAt);
      try {
        const status = await getSourceStatus(rosleshoz(), NOW);
        expect(status.state).toBe('stale');
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('a recent publication is failed when our own downloads have been broken for weeks', async () => {
      const lastSuccessAt = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000);
      redis.store.set(
        'journal:rosleshoz',
        JSON.stringify([
          { startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 500, outcome: 'failed', error: 'meta.csv 404' },
          { startedAt: lastSuccessAt.toISOString(), finishedAt: lastSuccessAt.toISOString(), durationMs: 500, outcome: 'updated' },
        ]),
      );
      const publishedAt = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
      jest.spyOn(rosleskhoz, 'latestDatasetModified').mockReturnValue(publishedAt);
      try {
        const status = await getSourceStatus(rosleshoz(), NOW);
        expect(status.state).toBe('failed');
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('no journal yet does not drag a fresh publication down to unknown', async () => {
      const publishedAt = new Date(NOW.getTime() - 99 * 24 * 60 * 60 * 1000);
      jest.spyOn(rosleskhoz, 'latestDatasetModified').mockReturnValue(publishedAt);
      try {
        const status = await getSourceStatus(rosleshoz(), NOW);
        expect(status.state).toBe('fresh');
      } finally {
        jest.restoreAllMocks();
      }
    });
  });
});
