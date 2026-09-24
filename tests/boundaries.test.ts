import {
  boundaryFileUrl,
  boundaryStyle,
  describeBoundary,
  districtsVisible,
  labelVisible,
  type BoundaryProps,
} from '../frontend/src/map/boundaries';

const region: BoundaryProps = {
  osm_id: 145454,
  name: 'Иркутская область',
  kind: 'region',
  iso: 'RU-IRK',
  label: [104.3, 57.5],
};

const district: BoundaryProps = {
  osm_id: 1234,
  name: 'Ольхонский район',
  kind: 'district',
  parent: 'Иркутская область',
  parent_iso: 'RU-IRK',
  label: [106.9, 53.1],
};

describe('boundary visibility by zoom', () => {
  it('shows districts from zoom 6', () => {
    expect(districtsVisible(5)).toBe(false);
    expect(districtsVisible(6)).toBe(true);
  });

  it('labels regions from zoom 5 and districts from zoom 8', () => {
    expect(labelVisible('region', 4)).toBe(false);
    expect(labelVisible('region', 5)).toBe(true);
    expect(labelVisible('district', 7)).toBe(false);
    expect(labelVisible('district', 8)).toBe(true);
  });
});

describe('boundaryStyle', () => {
  it('keeps polygons clickable but unfilled until hovered', () => {
    expect(boundaryStyle('region')).toMatchObject({ fill: true, fillOpacity: 0 });
    expect(boundaryStyle('region', true).fillOpacity).toBeGreaterThan(0);
  });

  it('draws districts dashed and thinner than regions', () => {
    expect(boundaryStyle('district').dashArray).toBeTruthy();
    expect(boundaryStyle('district').weight).toBeLessThan(boundaryStyle('region').weight as number);
  });
});

describe('describeBoundary', () => {
  it('describes a region with its ISO code and OSM link', () => {
    expect(describeBoundary(region)).toEqual({
      title: 'Иркутская область',
      rows: [['Тип', 'Субъект РФ'], ['Код ISO', 'RU-IRK']],
      osmUrl: 'https://www.openstreetmap.org/relation/145454',
    });
  });

  it('describes a district with its parent region', () => {
    expect(describeBoundary(district).rows).toEqual([
      ['Тип', 'Муниципальное образование'],
      ['Субъект РФ', 'Иркутская область'],
    ]);
  });

  it('builds the OSM link from a numeric id only', () => {
    const evil = { ...region, osm_id: '1"><script>' as unknown as number };
    expect(describeBoundary(evil).osmUrl).toBeNull();
  });
});

describe('boundaryFileUrl', () => {
  it('uses the CDN origin when configured', () => {
    expect(boundaryFileUrl('https://cdn.forestwatch.ru', 'ru-regions', '2026-09'))
      .toBe('https://cdn.forestwatch.ru/data/boundaries/ru-regions.2026-09.geojson');
  });

  it('falls back to a same-origin path', () => {
    expect(boundaryFileUrl('', 'baikal-districts', '2026-09'))
      .toBe('/data/boundaries/baikal-districts.2026-09.geojson');
  });
});
