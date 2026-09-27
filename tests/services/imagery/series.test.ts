import type { OpenedCog } from '../../../backend/services/imagery/cog';
import { projectBbox, type Bbox } from '../../../backend/services/imagery/geometry';
import {
  SERIES_FIRST_YEAR, SERIES_REASONS, YEAR_TTL_CURRENT_SEC, YEAR_TTL_PAST_SEC, computeSeriesYear, isPartial, orderByCloud,
  searchWindow, seriesKey, seriesTarget, seriesYears, summerWindow, yearKey, yearTtlSec,
} from '../../../backend/services/imagery/series';
import { projectorFor, type ImageryDeps } from '../../../backend/services/imagery/service';
import type { S2Scene, SearchParams } from '../../../backend/services/imagery/stac';
import { scene } from './helpers';

const INCIDENT: Bbox = [103.05, 53.6, 103.09, 53.63];

describe('years and windows', () => {
  it('summer window is 1 July – 31 August UTC', () => {
    expect(summerWindow(2021)).toEqual({ start: '2021-07-01T00:00:00.000Z', end: '2021-08-31T23:59:59.999Z' });
  });

  it('years from 2017; the current year only once its window has started', () => {
    expect(SERIES_FIRST_YEAR).toBe(2017);
    expect(seriesYears(new Date('2026-06-30T23:59:59Z'))).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(seriesYears(new Date('2026-07-01T00:00:00Z')).at(-1)).toBe(2026);
    expect(seriesYears(new Date('2026-09-27T00:00:00Z'))).toHaveLength(10);
  });

  it('partial until the window ends; the search stops at now', () => {
    const now = new Date('2026-07-20T10:00:00Z');
    expect(isPartial(2026, now)).toBe(true);
    expect(isPartial(2025, now)).toBe(false);
    expect(isPartial(2026, new Date('2026-09-01T00:00:00Z'))).toBe(false);
    expect(searchWindow(2026, now)).toEqual({ start: '2026-07-01T00:00:00.000Z', end: '2026-07-20T10:00:00.000Z' });
    expect(searchWindow(2025, now)).toEqual(summerWindow(2025));
  });

  it('TTL: past years 365 days, the current year 7 days (even after its window)', () => {
    const now = new Date('2026-09-27T00:00:00Z');
    expect(yearTtlSec(2025, now)).toBe(YEAR_TTL_PAST_SEC);
    expect(yearTtlSec(2026, now)).toBe(YEAR_TTL_CURRENT_SEC);
    expect(YEAR_TTL_PAST_SEC).toBe(365 * 86_400);
    expect(YEAR_TTL_CURRENT_SEC).toBe(7 * 86_400);
  });
});

describe('target and keys', () => {
  it('AOI and site from the incident bbox; keys carry both', () => {
    const t = seriesTarget(INCIDENT);
    expect(t.site[0]).toBeLessThan(INCIDENT[0]);
    expect(t.site[2]).toBeGreaterThan(INCIDENT[2]);
    expect(t.site[0]).toBeGreaterThanOrEqual(t.aoi[0]);
    expect(yearKey(t, 2019)).toBe(`imagery:ndvi-year:v1:${t.key}:2019`);
    expect(seriesKey(t)).toBe(`imagery:ndvi-series:v1:${t.key}`);
    expect(t.key).toMatch(/^[\d.,]+\|[\d.,]+$/);
  });

  it('two incidents with the same AOI but different sites get different keys', () => {
    // both below the 3 km minimum: same AOI around the same centre
    const a = seriesTarget([103.07, 53.615, 103.07, 53.615]);
    const b = seriesTarget([103.065, 53.612, 103.075, 53.618]);
    expect(a.aoi).toEqual(b.aoi);
    expect(yearKey(a, 2020)).not.toBe(yearKey(b, 2020));
  });
});

describe('orderByCloud', () => {
  it('least cloudy first, duplicates dropped, unknown cover last, stable', () => {
    const s = (id: string, cloudCover: number | null) => scene({ id: `S2A_T48UUE_2024070${id}T000000_L2A`, cloudCover });
    const out = orderByCloud([s('1', 30), s('2', null), s('3', 5), s('3', 5), s('4', 30), s('5', 0)]);
    expect(out.map(x => x.id.slice(18, 19))).toEqual(['5', '3', '1', '4', '2']);
    expect(orderByCloud(Array.from({ length: 9 }, (_, i) => s(String(i), i))).length).toBe(6);
  });
});

/**
 * A fake COG over zone 48 whose pixel value depends on the pixel centre (x, y) in metres —
 * lets a test paint the site and the ring differently.
 */
function patternCog(value: (x: number, y: number) => number): OpenedCog {
  const level = { width: 20_000, height: 20_000, origin: [300_000, 6_100_000] as [number, number], resolution: [20, -20] as [number, number] };
  return {
    samples: 1,
    levels: [level],
    async readWindow(_l, w) {
      const width = w[2] - w[0];
      const out = new Uint16Array(width * (w[3] - w[1]));
      for (let row = w[1]; row < w[3]; row++) {
        for (let col = w[0]; col < w[2]; col++) {
          out[(row - w[1]) * width + (col - w[0])] = value(level.origin[0] + (col + 0.5) * 20, level.origin[1] - (row + 0.5) * 20);
        }
      }
      return [out];
    },
  };
}

describe('computeSeriesYear', () => {
  const target = seriesTarget(INCIDENT);
  const env = projectBbox(target.site, projectorFor(32648));
  // Strictly inside the site's UTM envelope (its corners bulge a little outside the WGS84 box)
  const inSite = (x: number, y: number) => x > env[0] + 60 && x < env[2] - 60 && y > env[1] + 60 && y < env[3] - 60;
  const DN = { red: { site: 1800, ring: 1300 }, nir: { site: 2300, ring: 3900 } };

  const sc = (id: string, cloudCover: number, scl: number) => scene({
    id, cloudCover, datetime: `${id.slice(11, 15)}-${id.slice(15, 17)}-${id.slice(17, 19)}T04:33:00Z`,
    assets: { ...scene().assets, scl: { href: `https://example.test/${id}/SCL.tif:${scl}` } },
  });

  function deps(found: S2Scene[], now = new Date('2026-09-27T00:00:00Z')): ImageryDeps & { searches: SearchParams[]; opened: string[] } {
    const searches: SearchParams[] = [];
    const opened: string[] = [];
    return {
      searches,
      opened,
      now: () => now,
      stac: { async search(p) { searches.push(p); return found; }, async getItem() { return null; } },
      async openCog(href) {
        const name = href.split('/').pop()!;
        opened.push(name.split(':')[0]);
        if (name.startsWith('SCL')) { const v = Number(name.split(':')[1]); return patternCog(() => v); }
        if (name === 'B04.tif') return patternCog((x, y) => (inSite(x, y) ? DN.red.site : DN.red.ring));
        if (name === 'B8A.tif') return patternCog((x, y) => (inSite(x, y) ? DN.nir.site : DN.nir.ring));
        throw new Error(`unexpected ${href}`);
      },
    };
  }

  it('site vs background NDVI from the least cloudy usable scene', async () => {
    const d = deps([
      sc('S2A_T48UUE_20240712T043045_L2A', 20, 9), // cloudy over the AOI by SCL
      sc('S2B_T48UUE_20240801T043045_L2A', 2, 4),
      sc('S2A_T48UUE_20240705T043045_L2A', 50, 4),
    ]);
    const p = await computeSeriesYear(target, 2024, d);
    expect(p).toMatchObject({
      year: 2024, status: 'ok', sceneId: 'S2B_T48UUE_20240801T043045_L2A', platform: 'Sentinel-2A', clearPct: 100,
    });
    if (p.status !== 'ok') throw new Error('unreachable');
    expect(p).not.toHaveProperty('partial');
    // site: burnt DNs → NDVI 0.238 (mostly: the envelope's edge pixels are ring values)
    expect(p.site.ndvi!).toBeLessThan(0.45);
    expect(p.site.validPct).toBe(100);
    // background: forest DNs → 0.812
    expect(p.background.ndvi!).toBeGreaterThan(0.75);
    expect(p.background.ndvi!).toBeLessThanOrEqual(0.813);
    // search: the AOI, the summer window, sorted by cloud cover
    expect(d.searches).toEqual([expect.objectContaining({
      bbox: target.aoi, datetime: '2024-07-01T00:00:00.000Z/2024-08-31T23:59:59.999Z', sortBy: 'cloud', maxCloudCover: 80, limit: 6,
    })]);
    // SCL read once per candidate checked and reused for the index mask; no B12 for the series
    expect(d.opened).toEqual(['SCL.tif', 'B04.tif', 'B8A.tif']);
  });

  it('skips candidates that fail the SCL check', async () => {
    const d = deps([sc('S2B_T48UUE_20240801T043045_L2A', 2, 9), sc('S2A_T48UUE_20240805T043045_L2A', 3, 4)]);
    expect(await computeSeriesYear(target, 2024, d)).toMatchObject({ status: 'ok', sceneId: 'S2A_T48UUE_20240805T043045_L2A' });
    expect(d.opened.filter(n => n === 'SCL.tif')).toHaveLength(2);
  });

  it('no scenes → none; all cloudy → none; never interpolated', async () => {
    expect(await computeSeriesYear(target, 2019, deps([]))).toEqual({ year: 2019, status: 'none', reason: SERIES_REASONS.noScenes });
    expect(await computeSeriesYear(target, 2019, deps([sc('S2B_T48UUE_20190801T043045_L2A', 2, 9)])))
      .toEqual({ year: 2019, status: 'none', reason: SERIES_REASONS.cloudy });
  });

  it('the current year before its window ends is partial', async () => {
    const now = new Date('2026-07-20T00:00:00Z');
    expect(await computeSeriesYear(target, 2026, deps([], now))).toEqual({ year: 2026, status: 'none', reason: SERIES_REASONS.notYet, partial: true });
    const p = await computeSeriesYear(target, 2026, deps([sc('S2B_T48UUE_20260715T043045_L2A', 2, 4)], now));
    expect(p).toMatchObject({ status: 'ok', partial: true });
  });

  it('a source failure rejects (so the year is not cached)', async () => {
    const d = deps([sc('S2B_T48UUE_20240801T043045_L2A', 2, 4)]);
    await expect(computeSeriesYear(target, 2024, { ...d, openCog: async () => { throw new Error('COG 503'); } })).rejects.toThrow('COG 503');
    await expect(computeSeriesYear(target, 2024, { ...d, stac: { search: async () => { throw new Error('STAC 502'); }, getItem: async () => null } }))
      .rejects.toThrow('STAC 502');
  });

  it('every COG read goes through deps.schedule (the shared scene-check limit)', async () => {
    const d = deps([sc('S2B_T48UUE_20240801T043045_L2A', 2, 4)]);
    let calls = 0;
    await computeSeriesYear(target, 2024, { ...d, schedule: task => { calls++; return task(); } });
    expect(calls).toBe(3);
  });
});
