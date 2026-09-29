/**
 * The Rosleshoz gate inside the service: a rejected download never replaces `rosleshoz:*:last-good`,
 * and its reason reaches the quality log (→ `rosleshoz` load journal, /api/sources/status).
 */
jest.mock('../../../backend/config/redis', () => ({ getRedis: jest.fn() }));
jest.mock('axios');

import axios from 'axios';
import { getRedis } from '../../../backend/config/redis';
import { getDatasetRows } from '../../../backend/services/rosleskhozService';
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

const NAMES = ['Российская Федерация', 'Иркутская область', ...Array.from({ length: 96 }, (_, i) => `Субъект ${i + 1}`)];
const GOOD_CSV = ['subjects,area', ...NAMES.map((n, i) => `"${n}",${1000 + i}`)].join('\n');
const LAST_GOOD = [{ subjects: 'Иркутская область', area: '69420' }];

function serve(dataBody: unknown) {
  mockedAxios.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/meta.csv')) throw new Error('meta unavailable'); // falls back to the known file
    return { data: dataBody };
  });
}

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  (getRedis as jest.Mock).mockReturnValue(redis);
  mockedAxios.get.mockReset();
  drainQuality('rosleshoz');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('rosleskhozService quality gate', () => {
  it('a valid dataset is stored and reported as passed', async () => {
    serve(GOOD_CSV);
    const rows = await getDatasetRows('forestlandArea');
    expect(rows).toHaveLength(98);
    expect(JSON.parse(redis.store.get('rosleshoz:rows:forestlandArea:last-good') as string)).toHaveLength(98);
    expect(drainQuality('rosleshoz')).toEqual([expect.objectContaining({ check: 'forestlandArea', ok: true, total: 98 })]);
  });

  it.each([
    ['a renamed column', GOOD_CSV.replace('subjects,area', 'subjects,square'), /header lacks column/],
    ['an HTML page instead of CSV', '<html><body>Ведутся технические работы</body></html>', /HTML page instead of CSV/],
    ['negative numbers everywhere', GOOD_CSV.replace(/,(\d+)$/gm, ',-$1'), /rows are invalid/],
  ])('%s: the last good rows are served and the reason is logged', async (_label, body, reason) => {
    redis.store.set('rosleshoz:rows:forestlandArea:last-good', JSON.stringify(LAST_GOOD));
    serve(body);
    await expect(getDatasetRows('forestlandArea')).resolves.toEqual(LAST_GOOD);
    expect(redis.store.get('rosleshoz:rows:forestlandArea:last-good')).toBe(JSON.stringify(LAST_GOOD));
    const [result] = drainQuality('rosleshoz');
    expect(result).toMatchObject({ source: 'rosleshoz', check: 'forestlandArea', ok: false });
    expect(result.reason).toMatch(reason);
  });

  it('without a last good value a rejected dataset is an error, never an empty or invented table', async () => {
    serve(GOOD_CSV.replace('subjects,area', 'subjects,square'));
    await expect(getDatasetRows('forestlandArea')).rejects.toThrow(/rosleshoz\/forestlandArea: header lacks column/);
  });
});
