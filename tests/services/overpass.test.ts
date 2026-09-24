/**
 * getOOPT()/refreshOOPT() against a small, hand-built fixture standing in for a real Overpass
 * `out geom` response — outbound network to overpass-api.de is blocked in this sandbox, so this
 * couldn't be recorded live. Shape matches the documented format: relations with `tags` and
 * `members` where way members carry `geometry: [{lat, lon}, ...]` inline.
 */
import axios from 'axios';
import { getOOPT, ooptToGeoJSON, refreshOOPT } from '../../backend/services/overpassService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Keep REDIS_URL unset so cache.ts runs in pass-through mode (no Redis needed for these tests).
delete process.env.REDIS_URL;

const way = (points: Array<[number, number]>, role = 'outer') => ({
  type: 'way',
  role,
  geometry: points.map(([lon, lat]) => ({ lat, lon })),
});

const nationalPark = {
  type: 'relation',
  id: 1001,
  tags: { name: 'Тестовый парк', 'name:ru': 'Тестовый парк', boundary: 'national_park', protect_class: '2' },
  members: [way([[104, 53], [105, 53], [105, 54], [104, 54], [104, 53]])],
};

const reserveWithHole = {
  type: 'relation',
  id: 1002,
  tags: { name: 'Тестовый заповедник', boundary: 'protected_area', protect_class: '1' },
  members: [
    way([[110, 50], [111, 50], [111, 51]], 'outer'),
    way([[111, 51], [110, 51], [110, 50]], 'outer'),
    way([[110.3, 50.3], [110.7, 50.3], [110.7, 50.7], [110.3, 50.7], [110.3, 50.3]], 'inner'),
  ],
};

// One way member with a single-point "geometry" — not enough to form a ring, exercises the
// centroid Point fallback.
const degraded = {
  type: 'relation',
  id: 1003,
  tags: { name: 'Обрезанные данные', boundary: 'national_park' },
  members: [way([[100, 55]])],
};

// Georgian name inside the South Caucasus exclusion box — must be filtered out.
const georgianPark = {
  type: 'relation',
  id: 1004,
  tags: { name: 'ეროვნული პარკი', boundary: 'national_park' },
  members: [way([[44, 42], [44.1, 42], [44.1, 42.1], [44, 42.1], [44, 42]])],
};

function mockOverpassResponse(elements: unknown[]) {
  mockedAxios.post.mockResolvedValue({ data: { elements } });
}

describe('getOOPT / refreshOOPT (parsing + shaping against a recorded-style fixture)', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
  });

  it('returns polygons for relations, a Point fallback for degraded data, and filters non-Russian results', async () => {
    mockOverpassResponse([nationalPark, reserveWithHole, degraded, georgianPark]);

    const { features, source } = await getOOPT();
    expect(source).toBe('https://overpass-api.de/api/interpreter');
    expect(features.map(f => f.id).sort()).toEqual([1001, 1002, 1003]);

    const park = features.find(f => f.id === 1001)!;
    expect(park.geometry.type).toBe('Polygon');
    expect(park.name).toBe('Тестовый парк');
    // Label point must land inside the polygon, roughly the middle of the 104-105 / 53-54 box
    expect(park.lon).toBeGreaterThan(104);
    expect(park.lon).toBeLessThan(105);
    expect(park.lat).toBeGreaterThan(53);
    expect(park.lat).toBeLessThan(54);

    const reserve = features.find(f => f.id === 1002)!;
    expect(reserve.geometry.type).toBe('Polygon');
    expect((reserve.geometry as GeoJSON.Polygon).coordinates).toHaveLength(2); // outer + hole
    expect(reserve.area_ha).not.toBeNull();

    const fallback = features.find(f => f.id === 1003)!;
    expect(fallback.geometry).toEqual({ type: 'Point', coordinates: [100, 55] });
    expect(fallback.area_ha).toBeNull();
  });

  it('builds a GeoJSON FeatureCollection whose feature geometry matches and properties omit it', async () => {
    mockOverpassResponse([nationalPark]);
    const { features } = await getOOPT();
    const geojson = ooptToGeoJSON(features);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].geometry).toEqual(features[0].geometry);
    expect((geojson.features[0].properties as any).geometry).toBeUndefined();
    expect((geojson.features[0].properties as any).name).toBe('Тестовый парк');
  });

  it('rejects an all-filtered/empty Overpass answer instead of returning an empty feature list', async () => {
    mockOverpassResponse([georgianPark]);
    await expect(getOOPT()).rejects.toThrow();
  });

  it('refreshOOPT retries up to 3 times and reports failure without throwing', async () => {
    jest.useFakeTimers();
    try {
      mockedAxios.post.mockRejectedValue(new Error('504'));
      const result = refreshOOPT();
      await jest.advanceTimersByTimeAsync(60000); // two 30s waits between the three attempts
      await expect(result).resolves.toBe(false);
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
