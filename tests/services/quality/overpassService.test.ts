/**
 * The Overpass count check against the last good OOPT list, with a fake Redis holding
 * `oopt:ru:v3:last-good`: a list shorter than half of it is taken as a truncated answer.
 */
jest.mock('../../../backend/config/redis', () => ({ getRedis: jest.fn() }));
jest.mock('axios');

import axios from 'axios';
import { getRedis } from '../../../backend/config/redis';
import { OOPT_KEY, refreshOOPT } from '../../../backend/services/overpassService';
import { drainQuality } from '../../../backend/services/quality/log';

const mockedAxios = axios as jest.Mocked<typeof axios>;

class FakeRedis {
  store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); return 'OK'; }
  async hset() { return 1; }
  async hgetall() { return {}; }
  async expire() { return 1; }
}

/** `count` small valid parks around Lake Baikal (inside the 83 mapped regions). */
const parks = (count: number) => Array.from({ length: count }, (_, i) => {
  const lon = 103 + (i % 5) * 0.4;
  const lat = 52.2 + Math.floor(i / 5) * 0.3;
  const geometry = [[lon, lat], [lon + 0.2, lat], [lon + 0.2, lat + 0.2], [lon, lat + 0.2], [lon, lat]].map(([x, y]) => ({ lat: y, lon: x }));
  return { type: 'relation', id: 3000 + i, tags: { name: `Парк ${i}`, boundary: 'national_park' }, members: [{ type: 'way', role: 'outer', geometry }] };
});
const lastGood = (count: number) => JSON.stringify({ features: Array.from({ length: count }, (_, i) => ({ id: i })), source: 'x', fetchedAt: '2026-09-28T00:00:00.000Z' });

let redis: FakeRedis;
beforeEach(() => {
  jest.useFakeTimers();
  redis = new FakeRedis();
  (getRedis as jest.Mock).mockReturnValue(redis);
  mockedAxios.post.mockReset();
  drainQuality('oopt');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function refresh(): Promise<boolean> {
  const result = refreshOOPT();
  await jest.advanceTimersByTimeAsync(60000); // retries wait 30 s between attempts
  return result;
}

describe('refreshOOPT count check', () => {
  it('keeps the last good list when the new one has less than half of it', async () => {
    redis.store.set(`${OOPT_KEY}:last-good`, lastGood(130));
    mockedAxios.post.mockResolvedValue({ data: { elements: parks(40) } });
    await expect(refresh()).resolves.toBe(false);
    expect(mockedAxios.post).toHaveBeenCalledTimes(3); // a truncated answer is retried like a 504
    expect(JSON.parse(redis.store.get(`${OOPT_KEY}:last-good`) as string).features).toHaveLength(130);
    const [result] = drainQuality('oopt');
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/only 40 protected areas, last good list had 130 \(< 50%\)/);
  });

  it('accepts a list of at least half the last good one', async () => {
    redis.store.set(`${OOPT_KEY}:last-good`, lastGood(130));
    mockedAxios.post.mockResolvedValue({ data: { elements: parks(65) } });
    await expect(refresh()).resolves.toBe(true);
    expect(JSON.parse(redis.store.get(`${OOPT_KEY}:last-good`) as string).features).toHaveLength(65);
    expect(drainQuality('oopt')).toEqual([expect.objectContaining({ ok: true, total: 65, rejected: 0 })]);
  });
});
