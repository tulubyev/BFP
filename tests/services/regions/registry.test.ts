import path from 'path';
import { BAIKAL_ISOS, loadRegionRegistry, registryFromGeoJSON } from '../../../backend/services/regions/registry';
import { checkIso } from '../../../backend/services/regions/service';

const registry = loadRegionRegistry([path.resolve(__dirname, '../../../frontend/public/data/boundaries')]);

describe('loadRegionRegistry (real boundaries file)', () => {
  it('has the 83 regions with names and areas', () => {
    expect(registry.file).toMatch(/^ru-regions\.\d{4}-\d{2}\.geojson$/);
    expect(registry.regions).toHaveLength(83);
    for (const r of registry.regions) {
      expect(r.name).toBeTruthy();
      expect(r.areaKm2).toBeGreaterThan(0);
    }
  });

  it('has no Crimea, Sevastopol or 2022 regions', () => {
    for (const iso of ['UA-43', 'UA-40', 'RU-CR', 'RU-SEV', 'UA-14', 'UA-09', 'UA-23', 'UA-65']) {
      expect(registry.byIso.has(iso)).toBe(false);
    }
  });

  it('computes plausible areas (official: Irkutsk 774 846 km², Moscow city 2 561 km²)', () => {
    expect(registry.byIso.get('RU-IRK')!.areaKm2 / 774_846).toBeGreaterThan(0.95);
    expect(registry.byIso.get('RU-IRK')!.areaKm2 / 774_846).toBeLessThan(1.05);
    expect(registry.byIso.get('RU-MOW')!.areaKm2 / 2_561).toBeGreaterThan(0.9);
    expect(registry.byIso.get('RU-MOW')!.areaKm2 / 2_561).toBeLessThan(1.1);
  });

  it('includes the Baikal regions', () => {
    for (const iso of BAIKAL_ISOS) expect(registry.byIso.has(iso)).toBe(true);
  });
});

describe('registryFromGeoJSON', () => {
  it('ignores features without a valid ISO code', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { iso: 'RU-IRK', name: 'Иркутская область' }, geometry: { type: 'Polygon', coordinates: [[[100, 50], [101, 50], [101, 51], [100, 51], [100, 50]]] } },
        { type: 'Feature', properties: { name: 'без кода' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      ],
    };
    expect(registryFromGeoJSON('f', fc).regions.map(r => r.iso)).toEqual(['RU-IRK']);
  });
});

describe('checkIso (API validation)', () => {
  it('accepts a known code, case-insensitively', () => {
    expect(checkIso('RU-IRK', registry)).toEqual({ ok: true, iso: 'RU-IRK' });
    expect(checkIso('ru-bu', registry)).toEqual({ ok: true, iso: 'RU-BU' });
  });
  it('rejects a malformed code with 400', () => {
    for (const bad of ['', 'IRK', 'RU_IRK', 'RU-IRKX', '../etc', 'RU-1', undefined, 42]) {
      expect(checkIso(bad, registry)).toMatchObject({ ok: false, status: 400 });
    }
  });
  it('rejects a well-formed code outside the 83 regions with 404 (Crimea, Sevastopol)', () => {
    expect(checkIso('RU-CR', registry)).toMatchObject({ ok: false, status: 404 });
    expect(checkIso('RU-SEV', registry)).toMatchObject({ ok: false, status: 404 });
  });
});
