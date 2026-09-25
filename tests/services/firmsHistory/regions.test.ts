import path from 'path';
import {
  findRegion, loadBaikalRegions, pickNewestRegionsFile, pointInPolygon, regionsFromGeoJSON, unionBbox,
} from '../../../backend/services/firmsHistory/regions';

const square = (x0: number, y0: number, size: number) =>
  [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]];

describe('pointInPolygon', () => {
  const withHole = [square(0, 0, 10), square(4, 4, 2)];
  it('is inside the outer ring and outside holes', () => {
    expect(pointInPolygon(1, 1, withHole)).toBe(true);
    expect(pointInPolygon(5, 5, withHole)).toBe(false);
    expect(pointInPolygon(11, 5, withHole)).toBe(false);
  });
});

describe('regionsFromGeoJSON / findRegion', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { iso: 'RU-IRK', name: 'Иркутская область' }, geometry: { type: 'Polygon', coordinates: [square(100, 50, 5)] } },
      { type: 'Feature', properties: { iso: 'RU-BU', name: 'Бурятия' }, geometry: { type: 'MultiPolygon', coordinates: [[square(105, 50, 5)], [square(120, 50, 1)]] } },
      { type: 'Feature', properties: { iso: 'RU-MOS', name: 'Московская область' }, geometry: { type: 'Polygon', coordinates: [square(36, 55, 2)] } },
    ],
  };
  const regions = regionsFromGeoJSON(fc, ['RU-IRK', 'RU-BU']);

  it('keeps only the wanted regions, with bboxes', () => {
    expect(regions.map(r => r.iso)).toEqual(['RU-IRK', 'RU-BU']);
    expect(regions[1].bbox).toEqual({ minLat: 50, minLon: 105, maxLat: 55, maxLon: 121 });
  });
  it('finds the region of a point, including MultiPolygon parts', () => {
    expect(findRegion(52, 101, regions)?.iso).toBe('RU-IRK');
    expect(findRegion(50.5, 120.5, regions)?.name).toBe('Бурятия');
    expect(findRegion(56, 37, regions)).toBeNull();
  });
  it('unions the bboxes', () => {
    expect(unionBbox(regions)).toEqual({ minLat: 50, minLon: 100, maxLat: 55, maxLon: 121 });
    expect(unionBbox([])).toBeNull();
  });
});

describe('pickNewestRegionsFile', () => {
  it('picks the newest version and ignores other files', () => {
    expect(pickNewestRegionsFile(['ru-regions.2026-03.geojson', 'baikal-districts.2027-01.geojson', 'ru-regions.2026-09.geojson']))
      .toBe('ru-regions.2026-09.geojson');
    expect(pickNewestRegionsFile(['readme.txt'])).toBeNull();
  });
});

describe('loadBaikalRegions (real boundaries file)', () => {
  const dir = path.resolve(__dirname, '../../../frontend/public/data/boundaries');
  const { regions } = loadBaikalRegions([dir]);

  it('loads Irkutsk oblast, Buryatia and Zabaykalsky krai', () => {
    expect(regions.map(r => r.iso).sort()).toEqual(['RU-BU', 'RU-IRK', 'RU-ZAB']);
  });
  it('places regional capitals in their regions and Moscow nowhere', () => {
    expect(findRegion(52.29, 104.28, regions)?.iso).toBe('RU-IRK'); // Irkutsk
    expect(findRegion(51.83, 107.58, regions)?.iso).toBe('RU-BU'); // Ulan-Ude
    expect(findRegion(52.03, 113.5, regions)?.iso).toBe('RU-ZAB'); // Chita
    expect(findRegion(55.75, 37.62, regions)).toBeNull();
  });
});
