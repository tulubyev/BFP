import path from 'path';
import { loadFirmsArchive } from '../../../backend/services/regions/firmsArchive';
import { loadRegionRegistry } from '../../../backend/services/regions/registry';
import {
  buildRegionsData, createRegionsService, isCompleteBuild, sortRegions, type CachedFn, type RegionsDeps,
} from '../../../backend/services/regions/service';

const registry = loadRegionRegistry([path.resolve(__dirname, '../../../frontend/public/data/boundaries')]);
const archive = loadFirmsArchive([path.resolve(__dirname, '../../fixtures/regional')]);

function fakeDeps(overrides: Partial<RegionsDeps> = {}): RegionsDeps & { reported: string[][] } {
  const reported: string[][] = [];
  return {
    reported,
    registry: () => registry,
    archive: () => archive,
    rosleshozRows: async key => (key === 'woodVolume'
      ? [{ region: 'Всего по Российской Федерации', volume: '200000' }, { region: 'Иркутская область', volume: '31000' }, { region: 'Неизвестный край', volume: '1' }]
      : [{ region: 'Иркутская область', subjects: 'Иркутская область', area: '69420', total_materials: '71500', woodiness: '83.1' }]),
    rosleshozPublished: () => new Date('2026-05-21T00:00:00Z'),
    oopt: async () => ({ features: [], fetchedAt: '2026-09-25T06:00:00Z' }),
    nrtCells: async () => [{ lat: 52.29, lon: 104.28, count: 3, lastDate: '2026-09-25' }],
    gfwLoss: async () => ({ byIso: {}, hasApiKey: false }),
    reportUnmapped: async names => { reported.push(names); },
    now: () => new Date('2026-09-26T12:00:00Z'),
    ...overrides,
  };
}

/** In-memory stand-in for cached(): fresh value, then last-good fallback on invalid results. */
function memoryCache() {
  const store = new Map<string, unknown>();
  const lastGood = new Map<string, unknown>();
  const fn: CachedFn = async (key, _ttl, fetcher, opts = {}) => {
    if (store.has(key)) return store.get(key) as any;
    const value = await fetcher();
    if (opts.isValid && !opts.isValid(value)) {
      if (lastGood.has(key)) return lastGood.get(key) as any;
      throw new Error('invalid');
    }
    store.set(key, value);
    lastGood.set(key, value);
    return value;
  };
  return { fn, store, lastGood };
}

describe('buildRegionsData', () => {
  it('assembles all 83 regions with the Baikal regions pinned on top', async () => {
    const data = await buildRegionsData(fakeDeps());
    expect(data.regions).toHaveLength(83);
    expect(data.regions.slice(0, 3).map(r => r.iso)).toEqual(['RU-IRK', 'RU-BU', 'RU-ZAB']);
    expect(data.regions.slice(0, 3).every(r => r.baikal)).toBe(true);
    expect(data.regions[3].baikal).toBe(false);
    expect(data.archive?.file).toBe('firms-archive.2024.json');
    expect(isCompleteBuild(data)).toBe(true);
  });

  it('assigns NRT detections to regions (Irkutsk city → RU-IRK)', async () => {
    const data = await buildRegionsData(fakeDeps());
    const nrt = (iso: string) => data.regions.find(r => r.iso === iso)!.indicators.find(i => i.id === 'hotspots_nrt_season')!.value;
    expect(nrt('RU-IRK')).toBe(3);
    expect(nrt('RU-MOW')).toBe(0);
  });

  it('logs and journals unmapped Rosleshoz names loudly, and lists them in diagnostics', async () => {
    const deps = fakeDeps();
    const data = await buildRegionsData(deps);
    expect(deps.reported).toEqual([['Неизвестный край']]);
    expect(data.diagnostics.unmappedRosleshozNames).toEqual(['Неизвестный край']);
  });

  it('does not report anything when all names are mapped or excluded', async () => {
    const deps = fakeDeps({ rosleshozRows: async () => [{ region: 'Иркутская область', volume: '1' }, { region: 'Итого', volume: '1' }] });
    await buildRegionsData(deps);
    expect(deps.reported).toEqual([]);
  });

  it('marks a build with a failed source as incomplete and keeps nulls with reasons', async () => {
    const data = await buildRegionsData(fakeDeps({
      nrtCells: async () => { throw new Error('ECONNREFUSED'); },
      oopt: async () => { throw new Error('504'); },
    }));
    expect(isCompleteBuild(data)).toBe(false);
    expect(data.diagnostics.sourceErrors).toEqual(expect.arrayContaining([expect.stringMatching(/^oopt:/), expect.stringMatching(/^nrt:/)]));
    const irk = data.regions[0].indicators;
    expect(irk.find(i => i.id === 'hotspots_nrt_season')).toMatchObject({ value: null, reason: expect.stringContaining('недоступна') });
    expect(irk.find(i => i.id === 'oopt_share')).toMatchObject({ value: null });
  });

  it('works without the archive: archive indicators null, everything else present', async () => {
    const data = await buildRegionsData(fakeDeps({ archive: () => null }));
    expect(data.archive).toBeNull();
    expect(isCompleteBuild(data)).toBe(true);
    const irk = data.regions[0];
    expect(irk.hotspotSeries).toEqual([]);
    expect(irk.hotspotSeriesReason).toBe('архив FIRMS ещё не собран');
    expect(irk.indicators.find(i => i.id === 'wood_volume')?.value).toBe(31000);
  });
});

describe('createRegionsService', () => {
  it('lists summaries without series and returns details with series', async () => {
    const service = createRegionsService(fakeDeps(), memoryCache().fn);
    const list = await service.list();
    expect(list.regions).toHaveLength(83);
    expect(list.regions[0]).not.toHaveProperty('hotspotSeries');
    const detail = await service.detail('RU-IRK');
    expect(detail?.hotspotSeries).toHaveLength(6);
    expect(detail?.generatedAt).toBe('2026-09-26T12:00:00.000Z');
    expect(await service.detail('RU-XXX')).toBeNull();
  });

  it('caches a complete build under a key naming the boundaries and archive files', async () => {
    const cache = memoryCache();
    const deps = fakeDeps();
    const spy = jest.fn(deps.rosleshozRows);
    const service = createRegionsService({ ...deps, rosleshozRows: spy }, cache.fn);
    await service.list();
    await service.list();
    expect([...cache.store.keys()]).toEqual([`regions:v1:${registry.file}:firms-archive.2024.json`]);
    expect(spy).toHaveBeenCalledTimes(3); // one build: one read per dataset
  });

  it('never replaces a good cached build with a degraded one', async () => {
    const cache = memoryCache();
    let dbUp = true;
    let now = new Date('2026-09-26T12:00:00Z').getTime();
    const deps = fakeDeps({
      nrtCells: async () => { if (!dbUp) throw new Error('db down'); return []; },
      now: () => new Date(now),
    });
    const service = createRegionsService(deps, cache.fn);
    await service.list();
    cache.store.clear(); // TTL expired
    dbUp = false;
    now += 60 * 60 * 1000;
    const list = await service.list();
    expect(list.generatedAt).toBe('2026-09-26T12:00:00.000Z'); // last good build, with its date
    expect(list.diagnostics.sourceErrors).toEqual([]);
  });

  it('serves the degraded build when there is no good one yet', async () => {
    const service = createRegionsService(fakeDeps({ nrtCells: async () => { throw new Error('db down'); } }), memoryCache().fn);
    const list = await service.list();
    expect(list.regions).toHaveLength(83);
    expect(list.diagnostics.sourceErrors[0]).toMatch(/^nrt:/);
  });
});

describe('sortRegions', () => {
  it('pins Irkutsk, Buryatia, Zabaykalsky first and sorts the rest by Russian name', () => {
    const sorted = sortRegions([
      { iso: 'RU-TOM', name: 'Томская область' }, { iso: 'RU-ZAB', name: 'Забайкальский край' },
      { iso: 'RU-AD', name: 'Адыгея' }, { iso: 'RU-IRK', name: 'Иркутская область' }, { iso: 'RU-BU', name: 'Бурятия' },
    ]);
    expect(sorted.map(r => r.iso)).toEqual(['RU-IRK', 'RU-BU', 'RU-ZAB', 'RU-AD', 'RU-TOM']);
  });
});
