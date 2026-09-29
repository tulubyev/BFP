jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn() }));

import { getRedis } from '../../backend/config/redis';
import { GFW_TILE_LAYERS } from '../../backend/services/gfwTileLayers';
import {
  ACCESS_RECORD_INTERVAL_MS, GFW_TILE_SOURCE, createAccessThrottle, recordSourceAccess, resetAccessThrottle,
} from '../../backend/services/sourceAccess';
import { getSourceDefinition } from '../../backend/services/sourceRegistry';
import { readAccess, readJournal } from '../../backend/utils/journal';

class FakeRedis {
  store = new Map<string, string>();
  sets = 0;
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.sets++; this.store.set(key, value); return 'OK'; }
}

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 8, 29, 12);

describe('createAccessThrottle', () => {
  it('lets one record per source and outcome through every 10 minutes', () => {
    const th = createAccessThrottle();
    expect(ACCESS_RECORD_INTERVAL_MS).toBe(10 * MIN);
    expect(th.shouldRecord('gfw_loss', 'ok', T0)).toBe(true);
    expect(th.shouldRecord('gfw_loss', 'ok', T0 + 1)).toBe(false);
    expect(th.shouldRecord('gfw_loss', 'ok', T0 + 10 * MIN - 1)).toBe(false);
    expect(th.shouldRecord('gfw_loss', 'ok', T0 + 10 * MIN)).toBe(true);
  });

  it('throttles each source separately', () => {
    const th = createAccessThrottle();
    expect(th.shouldRecord('gfw_loss', 'ok', T0)).toBe(true);
    expect(th.shouldRecord('gfw_cover', 'ok', T0)).toBe(true);
    expect(th.shouldRecord('sentinel2', 'ok', T0)).toBe(true);
  });

  it('never swallows a failure right after a success, nor the recovery after it', () => {
    const th = createAccessThrottle();
    expect(th.shouldRecord('gfw_dist', 'ok', T0)).toBe(true);
    expect(th.shouldRecord('gfw_dist', 'failed', T0 + MIN)).toBe(true);
    expect(th.shouldRecord('gfw_dist', 'failed', T0 + 2 * MIN)).toBe(false);
    expect(th.shouldRecord('gfw_dist', 'ok', T0 + 11 * MIN)).toBe(true);
  });

  it('a clock that jumps backwards does not block recording forever', () => {
    const th = createAccessThrottle();
    th.shouldRecord('gfw_loss', 'ok', T0);
    expect(th.shouldRecord('gfw_loss', 'ok', T0 - 60 * MIN)).toBe(true);
  });

  it('reset forgets everything', () => {
    const th = createAccessThrottle();
    th.shouldRecord('gfw_loss', 'ok', T0);
    th.reset();
    expect(th.shouldRecord('gfw_loss', 'ok', T0 + 1)).toBe(true);
  });
});

describe('recordSourceAccess', () => {
  let redis: FakeRedis;
  beforeEach(() => {
    resetAccessThrottle();
    redis = new FakeRedis();
    (getRedis as jest.Mock).mockReturnValue(redis);
  });

  it('a burst of tile requests costs one Redis write per outcome', async () => {
    for (let i = 0; i < 200; i++) await recordSourceAccess('gfw_loss', 'ok', undefined, new Date(T0 + i * 1000));
    expect((await readJournal('gfw_loss')).length).toBe(1);
    await recordSourceAccess('gfw_loss', 'failed', new Error('HTTP 503'), new Date(T0 + 201 * 1000));
    await recordSourceAccess('gfw_loss', 'failed', new Error('HTTP 503'), new Date(T0 + 202 * 1000));
    const runs = await readJournal('gfw_loss');
    expect(runs.map(r => r.outcome)).toEqual(['failed', 'updated']);
    expect(await readAccess('gfw_loss')).toMatchObject({ lastError: 'HTTP 503', failingSince: new Date(T0 + 201 * 1000).toISOString() });
  });

  it('takes error text from strings and non-Error values', async () => {
    await recordSourceAccess('sentinel2', 'failed', 'STAC search: no features array', new Date(T0));
    expect((await readAccess('sentinel2'))?.lastError).toBe('STAC search: no features array');
  });

  it('never rejects, even when Redis is down', async () => {
    (getRedis as jest.Mock).mockReturnValue({ get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(recordSourceAccess('gfw_cover', 'ok')).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('GFW_TILE_SOURCE', () => {
  it('maps every tile layer to a registry source', () => {
    for (const layer of Object.keys(GFW_TILE_LAYERS) as (keyof typeof GFW_TILE_LAYERS)[]) {
      expect(getSourceDefinition(GFW_TILE_SOURCE[layer])).toBeDefined();
    }
    expect(GFW_TILE_SOURCE).toEqual({ loss: 'gfw_loss', cover: 'gfw_cover', dist: 'gfw_dist' });
  });
});
