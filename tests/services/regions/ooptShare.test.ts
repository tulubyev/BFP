import path from 'path';
import area from '@turf/area';
import { cellAreaKm2, mergeIntervals, ooptAreaByRegion, polygonRowIntervals } from '../../../backend/services/regions/ooptShare';
import { loadRegionRegistry } from '../../../backend/services/regions/registry';
import type { RegionShape } from '../../../backend/services/firmsHistory/regions';

const square = (x0: number, y0: number, size: number) =>
  [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]];

const regionShape = (iso: string, ring: number[][]): RegionShape => {
  const lons = ring.map(p => p[0]);
  const lats = ring.map(p => p[1]);
  return {
    iso, name: iso, polygons: [[ring]],
    bbox: { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) },
  };
};
const polygon = (ring: number[][]) => ({ geometry: { type: 'Polygon', coordinates: [ring] } });
const turfKm2 = (ring: number[][]) => area({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }) / 1e6;

describe('cellAreaKm2', () => {
  it('matches the geodesic area of a 1° cell at the equator (~12 391 km²)', () => {
    expect(cellAreaKm2(0, 1) / turfKm2(square(0, 0, 1))).toBeCloseTo(1, 3);
  });
  it('shrinks with latitude', () => {
    expect(cellAreaKm2(60, 0.02)).toBeLessThan(cellAreaKm2(40, 0.02));
  });
});

describe('ooptAreaByRegion', () => {
  const west = regionShape('RU-W', square(100, 50, 2));
  const east = regionShape('RU-E', square(102, 50, 2));

  it('estimates the area of an OOPT inside one region within 2 %', () => {
    const ring = square(100.5, 50.5, 1);
    const { areaKm2 } = ooptAreaByRegion([polygon(ring)], [west, east]);
    expect(areaKm2['RU-W'] / turfKm2(ring)).toBeGreaterThan(0.98);
    expect(areaKm2['RU-W'] / turfKm2(ring)).toBeLessThan(1.02);
    expect(areaKm2['RU-E']).toBe(0);
  });

  it('splits an OOPT crossing a region border between both regions', () => {
    const { areaKm2 } = ooptAreaByRegion([polygon(square(101.5, 50.5, 1))], [west, east]);
    expect(areaKm2['RU-W'] / areaKm2['RU-E']).toBeCloseTo(1, 1);
  });

  it('counts overlapping OOPTs once', () => {
    const one = ooptAreaByRegion([polygon(square(100.5, 50.5, 1))], [west]).areaKm2['RU-W'];
    const both = ooptAreaByRegion([polygon(square(100.5, 50.5, 1)), polygon(square(100.5, 50.5, 0.5))], [west]).areaKm2['RU-W'];
    expect(both).toBeCloseTo(one, 6);
  });

  it('drops the part outside every region (e.g. sea) and skips point-only OOPTs', () => {
    const r = ooptAreaByRegion([polygon(square(101, 51, 2)), { geometry: { type: 'Point', coordinates: [101, 51] } }], [west]);
    expect(r.areaKm2['RU-W'] / turfKm2(square(101, 51, 1))).toBeCloseTo(1, 1);
    expect(r.polygonCount).toBe(1);
    expect(r.pointOnlyCount).toBe(1);
  });

  it('handles an OOPT crossing the antimeridian (Chukotka)', () => {
    const chukotkaWest = regionShape('RU-CHU', square(-180, 65, 5));
    const ring = [[179.5, 66], [-179.5, 66], [-179.5, 67], [179.5, 67], [179.5, 66]];
    const { areaKm2 } = ooptAreaByRegion([polygon(ring)], [chukotkaWest]);
    // Only the western half (−180…−179.5) lies inside this test region
    expect(areaKm2['RU-CHU'] / turfKm2([[-180, 66], [-179.5, 66], [-179.5, 67], [-180, 67], [-180, 66]])).toBeCloseTo(1, 1);
  });

  it('gives Baikal-sized results on the real boundaries file', () => {
    const registry = loadRegionRegistry([path.resolve(__dirname, '../../../frontend/public/data/boundaries')]);
    const shapes = registry.regions.map(r => r.shape);
    // A 0.5° box around Irkutsk city lies entirely within Irkutsk oblast
    const ring = square(104, 52, 0.5);
    const { areaKm2 } = ooptAreaByRegion([polygon(ring)], shapes);
    expect(areaKm2['RU-IRK'] / turfKm2(ring)).toBeCloseTo(1, 1);
  });
});

describe('scanline helpers', () => {
  it('cuts a polygon with a hole into two intervals', () => {
    const withHole = [square(0, 0, 10), square(4, 4, 2)];
    expect(polygonRowIntervals(withHole, 5)).toEqual([[0, 4], [6, 10]]);
    expect(polygonRowIntervals(withHole, 11)).toEqual([]);
  });
  it('merges overlapping intervals without mutating the input', () => {
    const input: [number, number][] = [[5, 7], [0, 2], [1, 3], [7, 8]];
    expect(mergeIntervals(input)).toEqual([[0, 3], [5, 8]]);
    expect(input[0]).toEqual([5, 7]);
  });
  it('subtracts an OOPT hole from the area', () => {
    const region = regionShape('RU-W', square(100, 50, 2));
    const full = ooptAreaByRegion([polygon(square(100.5, 50.5, 1))], [region]).areaKm2['RU-W'];
    const holed = ooptAreaByRegion([{ geometry: { type: 'Polygon', coordinates: [square(100.5, 50.5, 1), square(100.75, 50.75, 0.5)] } }], [region]).areaKm2['RU-W'];
    expect(holed / full).toBeCloseTo(0.75, 1);
  });
});
