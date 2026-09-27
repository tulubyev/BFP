import sharp from 'sharp';
import type { OpenedCog } from '../../../backend/services/imagery/cog';
import { expandAoi, projectBbox, type Bbox } from '../../../backend/services/imagery/geometry';
import {
  attributionFor, getIncidentImagery, projectorFor, readSceneScl, renderScenePng, sceneCovers, sceneGrid, type ImageryDeps,
} from '../../../backend/services/imagery/service';
import type { S2Scene, SearchParams } from '../../../backend/services/imagery/stac';
import { NONE_REASONS } from '../../../backend/services/imagery/selection';
import { grid2d, memoryCog, scene } from './helpers';

const INCIDENT_BBOX: Bbox = [103.05, 53.6, 103.09, 53.63];
const incident = { id: 7, bbox: INCIDENT_BBOX, firstSeen: '2025-07-20T05:00:00.000Z', lastSeen: '2025-07-22T18:30:00.000Z' };
const NOW = new Date('2025-08-10T00:00:00Z');

/** A COG covering all of zone 48's AOI area whose every pixel has `value`. */
function constantCog(value: number): OpenedCog {
  return {
    samples: 1,
    levels: [{ width: 10_000, height: 10_000, origin: [300_000, 6_000_000], resolution: [20, -20] }],
    async readWindow(_level, w) { return [new Uint8Array((w[2] - w[0]) * (w[3] - w[1])).fill(value)]; },
  };
}

const s = (id: string, datetime: string, sclValue: number) =>
  ({ ...scene({ id, datetime, assets: { ...scene().assets, scl: { href: `https://example.test/${id}/SCL.tif:${sclValue}` } } }) });

function fakeDeps(byWindow: (p: SearchParams) => S2Scene[]): ImageryDeps & { searches: SearchParams[] } {
  const searches: SearchParams[] = [];
  return {
    searches,
    now: () => NOW,
    stac: {
      async search(p) { searches.push(p); return byWindow(p); },
      async getItem() { return null; },
    },
    async openCog(href) { return constantCog(Number(href.split(':').pop())); },
  };
}

const CLEAR = 4; const CLOUD = 9; const SNOW = 11;

describe('getIncidentImagery', () => {
  it('picks the newest clear scene before and the earliest clear scene after', async () => {
    const deps = fakeDeps(p => (p.sort === 'desc' && p.datetime.startsWith('2025-05')
      ? [s('S2A_T48UUE_20250718T043045_L2A', '2025-07-18T04:33:00Z', CLOUD), s('S2B_T48UUE_20250713T043045_L2A', '2025-07-13T04:33:00Z', CLEAR)]
      : p.sort === 'asc'
        ? [s('S2C_T48UUE_20250725T043045_L2A', '2025-07-25T04:33:00Z', CLEAR)]
        : []));
    const r = await getIncidentImagery(incident, deps);
    expect(r.before).toEqual({
      status: 'ok',
      sceneId: 'S2B_T48UUE_20250713T043045_L2A',
      datetime: '2025-07-13T04:33:00Z',
      platform: 'Sentinel-2A', // from the fixture's platform field
      clearPct: 100,
      urls: {
        truecolor: '/imagery/s2/v1/S2B_T48UUE_20250713T043045_L2A/truecolor/103.05000,53.60000,103.09000,53.63000.png',
        swir: '/imagery/s2/v1/S2B_T48UUE_20250713T043045_L2A/swir/103.05000,53.60000,103.09000,53.63000.png',
      },
    });
    expect(r.after).toMatchObject({ status: 'ok', sceneId: 'S2C_T48UUE_20250725T043045_L2A' });
    expect(r.after).not.toHaveProperty('duringActivity');
    expect(r.aoi).toEqual(expandAoi(INCIDENT_BBOX));
    expect(r.incidentId).toBe(7);
    expect(r.source.attribution).toBe('Contains modified Copernicus Sentinel data 2025');
    expect(r.generatedAt).toBe(NOW.toISOString());
    // search windows and filters
    expect(deps.searches).toEqual(expect.arrayContaining([
      expect.objectContaining({ datetime: '2025-05-21T05:00:00.000Z/2025-07-19T05:00:00.000Z', sort: 'desc', limit: 6, maxCloudCover: 80, bbox: r.aoi }),
      expect.objectContaining({ datetime: '2025-07-22T18:30:01.000Z/2025-08-10T00:00:00.000Z', sort: 'asc' }),
    ]));
  });

  it('falls back to a scene taken during activity when nothing is usable after the last hotspot', async () => {
    const deps = fakeDeps(p => {
      if (p.sort === 'asc') return [s('S2C_T48UUE_20250725T043045_L2A', '2025-07-25T04:33:00Z', CLOUD)];
      if (p.datetime.startsWith('2025-07-20')) return [s('S2A_T48UUE_20250721T043045_L2A', '2025-07-21T04:33:00Z', CLEAR)];
      return [];
    });
    const r = await getIncidentImagery(incident, deps);
    expect(r.after).toMatchObject({ status: 'ok', sceneId: 'S2A_T48UUE_20250721T043045_L2A', duringActivity: true });
    expect(r.before).toEqual({ status: 'none', reason: NONE_REASONS.beforeCloudy });
  });

  it('an active incident searches only during activity (no window after last_seen = now)', async () => {
    const deps = fakeDeps(() => []);
    const r = await getIncidentImagery({ ...incident, lastSeen: NOW.toISOString() }, deps);
    expect(r.after).toEqual({ status: 'none', reason: 'снимков после обнаружения ещё нет' });
    expect(deps.searches.filter(p => p.sort === 'asc')).toHaveLength(0);
  });

  it('reports snow as the reason when snow spoils the candidates', async () => {
    const deps = fakeDeps(p => (p.sort === 'desc' && p.datetime.startsWith('2025-05')
      ? [s('S2A_T48UUE_20250718T043045_L2A', '2025-07-18T04:33:00Z', SNOW)]
      : []));
    expect((await getIncidentImagery(incident, deps)).before).toEqual({ status: 'none', reason: 'участок под снегом' });
  });

  it('a STAC failure rejects (so it is never cached as "no images")', async () => {
    const deps = fakeDeps(() => { throw new Error('STAC 502'); });
    await expect(getIncidentImagery(incident, deps)).rejects.toThrow('STAC 502');
  });

  it('routes every SCL read through deps.schedule', async () => {
    const deps = fakeDeps(p => (p.sort === 'asc' ? [s('S2C_T48UUE_20250725T043045_L2A', '2025-07-25T04:33:00Z', CLEAR)] : []));
    let calls = 0;
    const schedule = <T,>(task: () => Promise<T>): Promise<T> => { calls++; return task(); };
    await getIncidentImagery(incident, { ...deps, schedule });
    expect(calls).toBe(1);
  });
});

describe('readSceneScl', () => {
  it('fails when the scene has no scl asset', async () => {
    const deps = fakeDeps(() => []);
    await expect(readSceneScl(scene({ assets: {} }), expandAoi(INCIDENT_BBOX), deps)).rejects.toThrow('no scl asset');
  });
});

describe('attributionFor', () => {
  it('lists distinct years', () => {
    expect(attributionFor([2025, 2024, 2025])).toBe('Contains modified Copernicus Sentinel data 2024, 2025');
  });
});

describe('sceneCovers', () => {
  it('checks the bbox against the scene footprint bbox', () => {
    expect(sceneCovers(scene(), INCIDENT_BBOX)).toBe(true);
    expect(sceneCovers(scene(), [110, 50, 110.1, 50.1])).toBe(false);
  });
});

describe('renderScenePng (in-memory GeoTIFFs)', () => {
  const sc = scene();
  const aoi = expandAoi(INCIDENT_BBOX);
  const env = projectBbox(aoi, projectorFor(sc.epsg));
  // 50 m source pixels covering the AOI with a 500 m margin
  const origin: [number, number] = [Math.floor(env[0]) - 500, Math.ceil(env[3]) + 500];
  const w = Math.ceil((env[2] - env[0] + 1000) / 50);
  const h = Math.ceil((env[3] - env[1] + 1000) / 50);

  const deps = (cogs: Record<string, OpenedCog>): ImageryDeps => ({
    stac: { search: async () => [], getItem: async () => null },
    openCog: async href => {
      const name = href.split('/').pop()!;
      if (!cogs[name]) throw new Error(`unexpected ${href}`);
      return cogs[name];
    },
  });

  it('renders truecolor at the planned size with the outline', async () => {
    const visual = await memoryCog([grid2d(h, w, () => 40), grid2d(h, w, () => 90), grid2d(h, w, () => 50)], origin, 50, 32648, 8);
    const png = await renderScenePng(sc, 'truecolor', INCIDENT_BBOX, deps({ 'TCI.tif': visual }));
    const { grid } = sceneGrid(sc.epsg, aoi);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([grid.width, grid.height]);
    expect(Array.from(data.subarray(0, 4))).toEqual([40, 90, 50, 255]); // corner: plain image
    const yellow = Array.from({ length: info.width * info.height }, (_, i) => i)
      .filter(i => data[i * 4] > 200 && data[i * 4 + 1] > 180 && data[i * 4 + 2] < 100);
    expect(yellow.length).toBeGreaterThan(100); // the incident outline
  });

  it('renders swir from B12/B8A/B04 with the declared scale', async () => {
    const band = (v: number) => memoryCog([grid2d(h, w, () => v)], origin, 50);
    const png = await renderScenePng(sc, 'swir', INCIDENT_BBOX, deps({
      'B12.tif': await band(3500), 'B8A.tif': await band(2000), 'B04.tif': await band(1500),
    }));
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(data[1]); // burn-like pixel: red > green
    expect(data[3]).toBe(255);
  });

  it('makes pixels outside the source transparent', async () => {
    const small = await memoryCog([grid2d(2, 2, () => 9), grid2d(2, 2, () => 9), grid2d(2, 2, () => 9)], origin, 50, 32648, 8);
    const png = await renderScenePng(sc, 'truecolor', INCIDENT_BBOX, deps({ 'TCI.tif': small }));
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(data[(info.width * info.height - 1) * 4 + 3]).toBe(0);
  });

  it('fails clearly when an asset is missing', async () => {
    await expect(renderScenePng(scene({ assets: {} }), 'truecolor', INCIDENT_BBOX, deps({}))).rejects.toThrow('no visual asset');
  });
});
