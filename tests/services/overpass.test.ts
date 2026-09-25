/**
 * getOOPT()/refreshOOPT() against a small, hand-built fixture standing in for a real Overpass
 * `out geom` response — outbound network to overpass-api.de is blocked in this sandbox, so this
 * couldn't be recorded live. Shape matches the documented format: relations with `tags` and
 * `members` where way members carry `geometry: [{lat, lon}, ...]` inline.
 */
import axios from 'axios';
import {
  filterToRegions,
  getOOPT,
  newestRegionsFile,
  ooptToGeoJSON,
  refreshOOPT,
  type OOPTFeature,
} from '../../backend/services/overpassService';

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

// Has a Cyrillic name so it passes isLikelyRussia (matching the real bug: Overpass's Russia area
// includes Crimea) but sits outside the 83 mapped regions and must be dropped by the scope filter.
const crimeanReserve = {
  type: 'relation',
  id: 1005,
  tags: { name: 'Крымский заповедник', 'name:ru': 'Крымский заповедник', boundary: 'protected_area', protect_class: '1' },
  members: [way([[34.2, 44.7], [34.3, 44.7], [34.3, 44.8], [34.2, 44.8], [34.2, 44.7]])],
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

  it('drops a Crimean protected area even though it passes the Russia-name heuristic (out of scope)', async () => {
    // Exercises the real, checked-in frontend/public/data/boundaries/ru-regions.*.geojson — this
    // relation sits well outside all 83 mapped regions, unlike nationalPark (inside Irkutsk/Buryatia).
    mockOverpassResponse([nationalPark, crimeanReserve]);
    const { features } = await getOOPT();
    expect(features.map(f => f.id)).toEqual([1001]);
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

describe('filterToRegions', () => {
  const square = (name: string, [minLon, minLat, maxLon, maxLat]: [number, number, number, number]): GeoJSON.Feature<GeoJSON.Polygon> => ({
    type: 'Feature',
    properties: { name },
    geometry: {
      type: 'Polygon',
      coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
    },
  });

  const feature = (id: number, lon: number, lat: number): OOPTFeature => ({
    id,
    name: `Feature ${id}`,
    name_ru: null,
    protect_class: null,
    boundary: null,
    lat,
    lon,
    wikidata: null,
    website: null,
    area_ha: null,
    osm_url: '',
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });

  const irkutsk = square('Иркутская область', [95, 51, 119, 65]);
  const buryatia = square('Республика Бурятия', [98, 49, 116, 57]);

  it('keeps a feature whose label point falls inside one of several mapped regions', () => {
    const inIrkutsk = feature(1, 104, 53);
    expect(filterToRegions([inIrkutsk], [irkutsk, buryatia])).toEqual([inIrkutsk]);
  });

  it('drops a feature outside every mapped region (e.g. Crimea, not among the 83)', () => {
    const crimea = feature(2, 34, 45);
    expect(filterToRegions([crimea], [irkutsk, buryatia])).toEqual([]);
  });

  it('drops everything when there are no mapped regions to match against', () => {
    const inIrkutsk = feature(1, 104, 53);
    expect(filterToRegions([inIrkutsk], [])).toEqual([]);
  });

  it('keeps only the in-scope features from a mixed list', () => {
    const inIrkutsk = feature(1, 104, 53);
    const crimea = feature(2, 34, 45);
    expect(filterToRegions([inIrkutsk, crimea], [irkutsk, buryatia])).toEqual([inIrkutsk]);
  });
});

describe('newestRegionsFile', () => {
  it('picks the newest ru-regions.*.geojson by version, ignoring other files', () => {
    expect(newestRegionsFile([
      'baikal-districts.2026-09.geojson',
      'ru-regions.2026-06.geojson',
      'ru-regions.2026-09.geojson',
    ])).toBe('ru-regions.2026-09.geojson');
  });

  it('returns null when no ru-regions.*.geojson file is present', () => {
    expect(newestRegionsFile(['baikal-districts.2026-09.geojson', 'readme.txt'])).toBeNull();
  });
});

describe('loadRegionPolygons', () => {
  // Uses jest.isolateModules for a fresh module registry each time, since loadRegionPolygons()
  // memoizes its result at module scope — without isolation, whichever variant runs first would
  // decide the (cached) answer for the rest of the suite.
  it('finds and parses the real checked-in boundaries file (the dev-mode path), all 83 regions', () => {
    let regions: unknown[] | null = null;
    jest.isolateModules(() => {
      regions = require('../../backend/services/overpassService').loadRegionPolygons();
    });
    expect(regions).not.toBeNull();
    expect(regions!.length).toBe(83);
  });

  it('returns null without throwing when no boundaries file exists in either known location', () => {
    let regions: unknown[] | null = [];
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({ readdirSync: () => { throw new Error('ENOENT'); } }));
      regions = require('../../backend/services/overpassService').loadRegionPolygons();
    });
    expect(regions).toBeNull();
  });
});
