jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn() }));
jest.mock('axios');

import axios from 'axios';
import { getRedis } from '../../backend/config/redis';
import { GlobalForestWatchService } from '../../backend/services/globalForestWatch';

const mockedAxios = axios as jest.Mocked<typeof axios>;

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

const SNAPSHOT = {
  data: {
    area_ha: 1,
    tree_cover_extent_ha: 1,
    tree_cover_loss_ha: 1,
    tree_cover_gain_ha: 1,
    primary_forest_loss_ha: 1,
    emissions_Mt_CO2: 1,
  },
  fetchedAt: '2026-01-01T00:00:00.000Z',
};

describe('GlobalForestWatchService.getForestStatistics', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    (getRedis as jest.Mock).mockReturnValue(redis);
    mockedAxios.post.mockReset();
  });

  it('no API key, no cached snapshot: explicit no_api_key with null data, never invented numbers', async () => {
    const service = new GlobalForestWatchService({ apiKey: undefined });
    const result = await service.getForestStatistics();
    expect(result.status).toBe('no_api_key');
    expect(result.data).toBeNull();
    expect(result.asOf).toBeNull();
    expect(result.message).toMatch(/GFW_API_KEY/);
  });

  it('no API key, but a last-good snapshot exists: serves it labeled with its original date', async () => {
    redis.store.set(`${GlobalForestWatchService.STATISTICS_KEY}:last-good`, JSON.stringify(SNAPSHOT));
    const service = new GlobalForestWatchService({ apiKey: undefined });
    const result = await service.getForestStatistics();
    expect(result.status).toBe('no_api_key');
    expect(result.asOf).toBe(SNAPSHOT.fetchedAt);
    expect(result.data).toEqual(SNAPSHOT.data);
  });

  it('API key set, live call succeeds: ok status with a fresh asOf date', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: [{
          area__ha: 100,
          umd_tree_cover_extent_2000__ha: 90,
          umd_tree_cover_loss__ha: 5,
          umd_tree_cover_gain__ha: 2,
          umd_tree_cover_loss_from_fires__ha: 1,
          gfw_forest_carbon_gross_emissions__Mg_CO2e: 2_000_000,
        }],
      },
    });
    const service = new GlobalForestWatchService({ apiKey: 'test-key' });
    const result = await service.getForestStatistics();
    expect(result.status).toBe('ok');
    expect(result.data).toEqual({
      area_ha: 100,
      tree_cover_extent_ha: 90,
      tree_cover_loss_ha: 5,
      tree_cover_gain_ha: 2,
      primary_forest_loss_ha: 1,
      emissions_Mt_CO2: 2,
    });
    expect(result.asOf).not.toBeNull();
  });

  it('API key set, live call fails, no cached snapshot: explicit source_unavailable, not sample data', async () => {
    mockedAxios.post.mockRejectedValue(new Error('network error'));
    const service = new GlobalForestWatchService({ apiKey: 'test-key' });
    const result = await service.getForestStatistics();
    expect(result.status).toBe('source_unavailable');
    expect(result.data).toBeNull();
    expect(result.asOf).toBeNull();
  });

  it('API key set, live call fails, but a last-good snapshot exists: serves it with its original date', async () => {
    redis.store.set(`${GlobalForestWatchService.STATISTICS_KEY}:last-good`, JSON.stringify(SNAPSHOT));
    mockedAxios.post.mockRejectedValue(new Error('network error'));
    const service = new GlobalForestWatchService({ apiKey: 'test-key' });
    const result = await service.getForestStatistics();
    expect(result.status).toBe('ok');
    expect(result.asOf).toBe(SNAPSHOT.fetchedAt);
    expect(result.data).toEqual(SNAPSHOT.data);
  });

  it('API key set, live call returns no rows: treated as unavailable, never falls back to zeros', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [] } });
    const service = new GlobalForestWatchService({ apiKey: 'test-key' });
    const result = await service.getForestStatistics();
    expect(result.status).toBe('source_unavailable');
    expect(result.data).toBeNull();
  });
});
