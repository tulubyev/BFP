import {
  bboxIntersects, bboxSizeKm, clipBbox, expandAoi, formatBbox, pickLevel, pixelWindow, planGrid, projectBbox,
  resampleToGrid, toGridPixel, utmProjDef, type Bbox, type CogLevel, type Grid,
} from '../../../backend/services/imagery/geometry';
import { projectorFor } from '../../../backend/services/imagery/service';

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('expandAoi', () => {
  it('grows a point to a 3 km square around it', () => {
    const aoi = expandAoi([104.3, 52.3, 104.3, 52.3]);
    const { widthKm, heightKm } = bboxSizeKm(aoi);
    near(widthKm, 3, 0.01);
    near(heightKm, 3, 0.01);
    near((aoi[0] + aoi[2]) / 2, 104.3, 1e-5);
    near((aoi[1] + aoi[3]) / 2, 52.3, 1e-5);
  });

  it('keeps a mid-size bbox with a 20 % margin, each side at least 3 km', () => {
    // ~6.8 km wide, ~1.1 km tall at 52° N
    const aoi = expandAoi([104.0, 52.0, 104.1, 52.01]);
    const { widthKm, heightKm } = bboxSizeKm(aoi);
    near(widthKm, bboxSizeKm([104.0, 52.0, 104.1, 52.01]).widthKm * 1.2, 0.01);
    near(heightKm, 3, 0.01);
  });

  it('caps a large incident to a 20 km square around its centre', () => {
    const aoi = expandAoi([104.0, 52.0, 104.5, 52.3]);
    const { widthKm, heightKm } = bboxSizeKm(aoi);
    near(widthKm, 20, 0.01);
    near(heightKm, 20, 0.01);
    near((aoi[0] + aoi[2]) / 2, 104.25, 1e-5);
  });

  it('is stable: the AOI of the clipped outline equals the AOI of the incident', () => {
    const incident: Bbox = [104.0, 52.0, 104.5, 52.3];
    const aoi = expandAoi(incident);
    const again = expandAoi(clipBbox(incident, aoi));
    again.forEach((v, i) => near(v, aoi[i], 2e-5));
  });
});

describe('bbox helpers', () => {
  it('intersection test and clip', () => {
    expect(bboxIntersects([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true);
    expect(bboxIntersects([0, 0, 1, 1], [2, 2, 3, 3])).toBe(false);
    expect(bboxIntersects([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true); // touching counts
    expect(clipBbox([0, 0, 2, 2], [1, 1, 3, 3])).toEqual([1, 1, 2, 2]);
  });

  it('formats with 5 decimals', () => {
    expect(formatBbox([104.1, 52, 104.123456, 52.5])).toBe('104.10000,52.00000,104.12346,52.50000');
  });
});

describe('utmProjDef', () => {
  it('builds north and south UTM definitions', () => {
    expect(utmProjDef(32648)).toBe('+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs');
    expect(utmProjDef(32705)).toBe('+proj=utm +zone=5 +south +datum=WGS84 +units=m +no_defs');
  });

  it('rejects anything else', () => {
    expect(() => utmProjDef(4326)).toThrow();
    expect(() => utmProjDef(32661)).toThrow();
    expect(() => utmProjDef(32600)).toThrow();
  });
});

describe('WGS84 → UTM', () => {
  it('projects the central meridian of zone 48 to easting 500 000 m', () => {
    const [x, y] = projectorFor(32648)([105, 52]);
    near(x, 500_000, 0.01);
    near(y, 5_761_038, 5);
  });

  it('projectBbox envelopes a bbox that is slightly rotated in UTM', () => {
    const b = projectBbox([103.0, 53.6, 103.1, 53.7], projectorFor(32648));
    expect(b[2] - b[0]).toBeGreaterThan(6_500);
    expect(b[2] - b[0]).toBeLessThan(7_000);
    expect(b[3] - b[1]).toBeGreaterThan(11_000);
    expect(b[3] - b[1]).toBeLessThan(11_400); // 11.1 km of latitude plus the tilt of the top edge
  });
});

describe('planGrid', () => {
  it('uses 10 m pixels for a small area', () => {
    const g = planGrid([0, 0, 3000, 2000]);
    expect(g).toMatchObject({ width: 300, height: 200, pixelSize: 10 });
    expect(g.extent).toEqual([0, 0, 3000, 2000]);
  });

  it('keeps the long side at 512 px for a large area', () => {
    const g = planGrid([0, 0, 20_000, 10_000]);
    expect(g.width).toBe(512);
    expect(g.height).toBe(256);
    near(g.pixelSize, 20_000 / 512, 1e-9);
  });

  it('grows the extent symmetrically to whole pixels', () => {
    const g = planGrid([0, 0, 3005, 2000]);
    expect(g.width).toBe(301);
    expect(g.extent[0]).toBeCloseTo(-2.5);
    expect(g.extent[2]).toBeCloseTo(3007.5);
  });

  it('honours a coarser minimum pixel (SCL at 20 m)', () => {
    expect(planGrid([0, 0, 3000, 3000], 256, 20)).toMatchObject({ width: 150, height: 150, pixelSize: 20 });
  });
});

const level = (width: number, res: number): CogLevel => ({ width, height: width, origin: [300_000, 6_000_000], resolution: [res, -res] });

describe('pickLevel', () => {
  const levels = [level(10980, 10), level(5490, 20), level(2745, 40), level(1373, 80)];

  it('takes the coarsest level still finer than the target', () => {
    expect(pickLevel(levels, 39)).toBe(1);
    expect(pickLevel(levels, 40)).toBe(2);
    expect(pickLevel(levels, 100)).toBe(3);
  });

  it('falls back to full resolution for a finer target', () => {
    expect(pickLevel(levels, 10)).toBe(0);
    expect(pickLevel(levels, 5)).toBe(0);
  });
});

describe('pixelWindow', () => {
  const l = level(100, 20);

  it('covers the extent with whole pixels', () => {
    expect(pixelWindow([300_030, 5_999_900, 300_110, 5_999_990], l)).toEqual([1, 0, 6, 5]);
  });

  it('clamps to the image', () => {
    expect(pixelWindow([299_900, 5_997_000, 300_040, 6_000_100], l)).toEqual([0, 0, 2, 100]);
  });

  it('is null outside the image', () => {
    expect(pixelWindow([200_000, 5_000_000, 200_100, 5_000_100], l)).toBeNull();
  });
});

describe('resampleToGrid', () => {
  const l: CogLevel = { width: 2, height: 2, origin: [0, 20], resolution: [10, -10] };
  const src = [10, 20, 30, 40];

  it('nearest keeps source values', () => {
    const grid: Grid = { extent: [0, 0, 20, 20], width: 4, height: 4, pixelSize: 5 };
    expect(Array.from(resampleToGrid(src, l, [0, 0, 2, 2], grid, 'nearest')))
      .toEqual([10, 10, 20, 20, 10, 10, 20, 20, 30, 30, 40, 40, 30, 30, 40, 40]);
  });

  it('bilinear interpolates between pixel centres', () => {
    const grid: Grid = { extent: [5, 5, 15, 15], width: 1, height: 1, pixelSize: 10 };
    expect(Array.from(resampleToGrid(src, l, [0, 0, 2, 2], grid, 'bilinear'))).toEqual([25]);
  });

  it('bilinear does not blend nodata into valid pixels', () => {
    const grid: Grid = { extent: [5, 5, 15, 15], width: 1, height: 1, pixelSize: 10 };
    const out = resampleToGrid([10, 0, 30, 40], l, [0, 0, 2, 2], grid, 'bilinear');
    expect([10, 0, 30, 40]).toContain(out[0]);
  });

  it('respects the window offset inside the level', () => {
    const big: CogLevel = { width: 4, height: 4, origin: [0, 40], resolution: [10, -10] };
    // window = pixels (2,2)-(4,4) → x 20..40, y 0..20
    const grid: Grid = { extent: [20, 0, 40, 20], width: 2, height: 2, pixelSize: 10 };
    expect(Array.from(resampleToGrid(src, big, [2, 2, 4, 4], grid, 'nearest'))).toEqual([10, 20, 30, 40]);
  });
});

describe('toGridPixel', () => {
  it('maps projected points to fractional pixels (rows grow southwards)', () => {
    const grid: Grid = { extent: [1000, 2000, 1100, 2100], width: 10, height: 10, pixelSize: 10 };
    expect(toGridPixel([1000, 2100], grid)).toEqual([0, 0]);
    expect(toGridPixel([1050, 2000], grid)).toEqual([5, 10]);
  });
});
