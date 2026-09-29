import { SOURCE_REGISTRY, getSourceDefinition } from '../../backend/services/sourceRegistry';

describe('source registry', () => {
  it('ids are unique', () => {
    const ids = SOURCE_REGISTRY.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes Sentinel-2 with owner, license, cadence, resolution and limitations', () => {
    const s2 = getSourceDefinition('sentinel2');
    expect(s2).toBeDefined();
    expect(s2!.owner).toMatch(/Copernicus/);
    expect(s2!.license.name).toMatch(/Contains modified Copernicus Sentinel data/);
    expect(s2!.updateFrequency).toMatch(/5 суток/);
    expect(s2!.spatialResolution).toMatch(/10 м/);
    expect(s2!.spatialResolution).toMatch(/20 м/);
    expect(s2!.limitations.join(' ')).toMatch(/Облака/);
    expect(s2!.limitations.join(' ')).toMatch(/Снег/);
    expect(s2!.monitored).toBe(true);
  });
});
