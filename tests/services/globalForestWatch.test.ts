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

describe('GFW Data API quality gate (quality/gfw.ts)', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    (getRedis as jest.Mock).mockReturnValue(redis);
    mockedAxios.post.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('live loss rows pass, a bad row is dropped', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [
      { year: 2019, area_ha: 85000, emissions_Mg_CO2: 1 },
      { year: 2020, area_ha: 90000, emissions_Mg_CO2: 2 },
      { year: 2021, area_ha: 95000, emissions_Mg_CO2: 3 },
      { year: 2022, area_ha: 70000, emissions_Mg_CO2: 4 },
      { year: 2023, area_ha: 60000, emissions_Mg_CO2: 5 },
      { year: 2024, area_ha: 50000, emissions_Mg_CO2: 6 },
      { year: 2025, area_ha: 40000, emissions_Mg_CO2: 7 },
      { year: 2026, area_ha: 30000, emissions_Mg_CO2: 8 },
      { year: 2016, area_ha: 20000, emissions_Mg_CO2: 9 },
      { year: 2017, area_ha: 10000, emissions_Mg_CO2: 10 },
      { year: 2018, area_ha: -1, emissions_Mg_CO2: 11 },
    ] } });
    const service = new GlobalForestWatchService({ apiKey: 'test-key' });
    const result = await service.getRegionalTreeCoverLoss('irkutsk', 2016, 2026);
    expect(result.data_type).toBe('live');
    expect(result.data).toHaveLength(10);
    expect(result.data.some(r => r.year === 2018)).toBe(false);
  });

  it('a changed answer format falls back to the labelled estimate instead of NaN rows', async () => {
    mockedAxios.post.mockResolvedValue({ data: { rows: [{ loss_year: 2020, ha: 5 }] } });
    const service = new GlobalForestWatchService({ apiKey: 'test-key' });
    const result = await service.getRegionalTreeCoverLoss('irkutsk', 2020, 2021);
    expect(result.data_type).toBe('estimated');
    expect(result.data.every(r => Number.isFinite(r.area_ha))).toBe(true);
  });

  it('statistics with a missing field are rejected, not shown with 0', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [{ area__ha: 100, umd_tree_cover_extent_2000__ha: 90 }] } });
    const service = new GlobalForestWatchService({ apiKey: 'test-key' });
    const result = await service.getForestStatistics();
    expect(result.status).toBe('source_unavailable');
    expect(result.data).toBeNull();
  });
});
