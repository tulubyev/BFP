jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getRedis } from '../../backend/config/redis';
import {
  ACCESS_THRESHOLDS, boundariesVersionDate, boundariesVersionOf, getAllSourcesStatus, getSourceStatus, shippedBoundariesVersion,
} from '../../backend/services/sourceStatus';
import { getSourceDefinition, type SourceId } from '../../backend/services/sourceRegistry';
import { LOSS_VERSION } from '../../backend/services/gfwTileLayers';
import { BOUNDARIES_VERSION } from '../../frontend/src/map/boundariesVersion';

class FakeRedis {
  store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); return 'OK'; }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-09-29T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const def = (id: SourceId) => getSourceDefinition(id)!;

describe('on-demand sources: access signal', () => {
  let redis: FakeRedis;
  beforeEach(() => {
    redis = new FakeRedis();
    (getRedis as jest.Mock).mockReturnValue(redis);
  });
  const setAccess = (id: string, a: object) => redis.store.set(`access:${id}`, JSON.stringify({ lastSuccessAt: null, lastFailureAt: null, failingSince: null, ...a }));

  it.each(['gfw_loss', 'gfw_cover', 'gfw_dist', 'sentinel2'] as SourceId[])('%s has a 3-day access threshold', id => {
    expect(ACCESS_THRESHOLDS[id]).toEqual({ staleAfterMs: HOUR, failedAfterMs: 3 * DAY });
  });

  it.each(['gfw_loss', 'gfw_cover', 'sentinel2'] as SourceId[])('%s: never requested → unknown, not failed', async id => {
    const s = await getSourceStatus(def(id), NOW);
    expect(s.state).toBe('unknown');
    expect(s.access).toBeNull();
    expect(s.signals).toEqual([{ kind: 'access', state: 'unknown' }]);
  });

  it('gfw_loss: a recent successful tile fetch is fresh, with the age and the dataset version', async () => {
    setAccess('gfw_loss', { lastSuccessAt: ago(5 * 60 * 1000) });
    const s = await getSourceStatus(def('gfw_loss'), NOW);
    expect(s.state).toBe('fresh');
    expect(s.access).toMatchObject({ state: 'fresh', lastSuccessAgeMs: 5 * 60 * 1000 });
    expect(s.version).toBe(LOSS_VERSION);
    expect(s.freshness).toBeNull();
  });

  it('gfw_cover: failing for hours is stale', async () => {
    setAccess('gfw_cover', { lastSuccessAt: ago(DAY), failingSince: ago(6 * HOUR), lastFailureAt: ago(10 * 60 * 1000), lastError: 'HTTP 503' });
    const s = await getSourceStatus(def('gfw_cover'), NOW);
    expect(s.state).toBe('stale');
    expect(s.access?.lastError).toBe('HTTP 503');
  });

  it('sentinel2: three days of failures without a success is failed', async () => {
    setAccess('sentinel2', { lastSuccessAt: ago(5 * DAY), failingSince: ago(4 * DAY), lastFailureAt: ago(HOUR) });
    const s = await getSourceStatus(def('sentinel2'), NOW);
    expect(s.state).toBe('failed');
    expect(s.signals).toEqual([{ kind: 'access', state: 'failed' }]);
  });

  it('sentinel2: one old failure and silence since is not an outage', async () => {
    setAccess('sentinel2', { lastSuccessAt: ago(20 * DAY), failingSince: ago(10 * DAY), lastFailureAt: ago(10 * DAY) });
    expect((await getSourceStatus(def('sentinel2'), NOW)).state).toBe('fresh');
  });

  it('attaches the access journal runs', async () => {
    redis.store.set('journal:gfw_loss', JSON.stringify([{ startedAt: ago(0), finishedAt: ago(0), durationMs: 0, outcome: 'failed', error: 'x' }]));
    const s = await getSourceStatus(def('gfw_loss'), NOW);
    expect(s.journal?.lastAttempt?.outcome).toBe('failed');
  });

  describe('gfw_dist: worst of the version date and tile access', () => {
    it('fresh version + tiles failing for days → failed, blamed on access', async () => {
      redis.store.set('gfw:dist:version:last-good', JSON.stringify('v20260925'));
      setAccess('gfw_dist', { lastSuccessAt: ago(5 * DAY), failingSince: ago(4 * DAY), lastFailureAt: ago(HOUR) });
      const s = await getSourceStatus(def('gfw_dist'), NOW);
      expect(s.state).toBe('failed');
      expect(s.signals).toEqual([{ kind: 'data', state: 'fresh' }, { kind: 'access', state: 'failed' }]);
      expect(s.version).toBe('v20260925');
    });

    it('old version + tiles fine → stale, blamed on data', async () => {
      redis.store.set('gfw:dist:version:last-good', JSON.stringify('v20260915'));
      setAccess('gfw_dist', { lastSuccessAt: ago(HOUR) });
      const s = await getSourceStatus(def('gfw_dist'), NOW);
      expect(s.state).toBe('stale');
      expect(s.signals).toEqual([{ kind: 'data', state: 'stale' }, { kind: 'access', state: 'fresh' }]);
    });

    it('no tile requests do not drag a fresh version to unknown', async () => {
      redis.store.set('gfw:dist:version:last-good', JSON.stringify('v20260925'));
      expect((await getSourceStatus(def('gfw_dist'), NOW)).state).toBe('fresh');
    });
  });

  it('rosleshoz: failing downloads are an access signal, the publication date a data signal', async () => {
    redis.store.set('journal:rosleshoz', JSON.stringify([
      { startedAt: ago(0), finishedAt: ago(0), durationMs: 5, outcome: 'failed', error: 'meta.csv 404' },
      { startedAt: ago(20 * DAY), finishedAt: ago(20 * DAY), durationMs: 5, outcome: 'updated' },
    ]));
    const s = await getSourceStatus(def('rosleshoz'), NOW);
    expect(s.signals).toContainEqual({ kind: 'access', state: 'failed' });
    expect(s.state).toBe('failed');
  });

  it('every source reports its signals; only on-demand ones carry an access record', async () => {
    const all = await getAllSourcesStatus(NOW);
    for (const s of all) expect(Array.isArray(s.signals)).toBe(true);
    expect(all.filter(s => s.access !== undefined).map(s => s.id).sort()).toEqual(['gfw_cover', 'gfw_dist', 'gfw_loss', 'sentinel2']);
  });
});

describe('osm_boundaries: version from the file name', () => {
  beforeEach(() => {
    (getRedis as jest.Mock).mockReturnValue(new FakeRedis());
  });

  it('parses the version and its month', () => {
    expect(boundariesVersionOf('ru-regions.2026-09.geojson')).toBe('2026-09');
    expect(boundariesVersionOf('ru-regions.2026-13.geojson')).toBeNull();
    expect(boundariesVersionOf('baikal-districts.2026-09.geojson')).toBeNull();
    expect(boundariesVersionOf(null)).toBeNull();
    expect(boundariesVersionDate('2026-09')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(boundariesVersionDate(null)).toBeNull();
  });

  it('takes the newest shipped file across directories and ignores missing ones', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-b-'));
    try {
      fs.writeFileSync(path.join(a, 'ru-regions.2025-12.geojson'), '{}');
      fs.writeFileSync(path.join(b, 'ru-regions.2026-03.geojson'), '{}');
      fs.writeFileSync(path.join(b, 'baikal-districts.2027-01.geojson'), '{}');
      expect(shippedBoundariesVersion([a, b, path.join(a, 'missing')])).toBe('2026-03');
      expect(shippedBoundariesVersion([path.join(a, 'missing')])).toBeNull();
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it('the status shows the version the frontend loads (boundariesVersion.ts)', async () => {
    const s = await getSourceStatus(def('osm_boundaries'), NOW);
    expect(s.version).toBe(BOUNDARIES_VERSION);
    expect(s.freshness?.timestamp).toBe(`${BOUNDARIES_VERSION}-01T00:00:00.000Z`);
    expect(s.signals).toEqual([{ kind: 'data', state: 'fresh' }]);
    expect(s.state).toBe('fresh');
  });

  it('stale after 18 months, never failed', async () => {
    const built = new Date(`${BOUNDARIES_VERSION}-01T00:00:00Z`).getTime();
    const at17 = new Date(built + 17 * 30.44 * DAY);
    const at19 = new Date(built + 19 * 30.44 * DAY);
    const at10y = new Date(built + 3650 * DAY);
    expect((await getSourceStatus(def('osm_boundaries'), at17)).state).toBe('fresh');
    expect((await getSourceStatus(def('osm_boundaries'), at19)).state).toBe('stale');
    expect((await getSourceStatus(def('osm_boundaries'), at10y)).state).toBe('stale');
  });
});
