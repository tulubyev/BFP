import {
  DNBR_THRESHOLDS, INDEX_NOTE, INDEX_REASONS, MIN_VALID_FRACTION, NDVI_RENDER_MAX, NDVI_RENDER_MIN, NDVI_STOPS, SITE_PAD_KM,
  combineIndices, ndviColor, ndviOf, normalizedDifference, pointInPolygon, polygonMask, regionIndexStats, severityOf, subtractMask,
  type RegionIndexStats,
} from '../../../backend/services/imagery/indices';

const C1 = { scale: 0.0001, offset: -0.1 };
const PLAIN = { scale: 0.0001, offset: 0 };
/** DN for a C1 reflectance. */
const dn = (reflectance: number) => Math.round((reflectance + 0.1) / 0.0001);
const CLEAR = 4; const DARK = 2; const CLOUD = 9; const SHADOW = 3; const SNOW = 11; const CIRRUS = 10; const NODATA = 0; const SATURATED = 1;

describe('normalizedDifference', () => {
  it('computes (a − b) / (a + b)', () => {
    expect(normalizedDifference(0.3, 0.05)).toBeCloseTo(0.25 / 0.35, 10);
    expect(normalizedDifference(0.1, 0.3)).toBeCloseTo(-0.5, 10);
    expect(normalizedDifference(0.2, 0.2)).toBe(0);
  });

  it('null for a zero or negative sum (no division by zero)', () => {
    expect(normalizedDifference(0, 0)).toBeNull();
    expect(normalizedDifference(0.05, -0.05)).toBeNull();
    expect(normalizedDifference(-0.02, -0.01)).toBeNull();
    expect(normalizedDifference(NaN, 0.1)).toBeNull();
    expect(normalizedDifference(Infinity, 0.1)).toBeNull();
  });

  it('clamps to [−1, 1] when one reflectance is slightly negative (C1 offset)', () => {
    expect(normalizedDifference(0.3, -0.01)).toBe(1);
    expect(normalizedDifference(-0.01, 0.3)).toBe(-1);
  });
});

describe('ndviOf', () => {
  it('applies the raster:bands scale and offset', () => {
    // C1: DN 4000 → 0.3, DN 1500 → 0.05
    expect(ndviOf(1500, 4000, C1, C1)).toBeCloseTo(0.25 / 0.35, 6);
    // the plain L2A convention gives a different value for the same DNs
    expect(ndviOf(1500, 4000, PLAIN, PLAIN)).toBeCloseTo(2500 / 5500, 6);
  });

  it('DN 0 in either band is nodata', () => {
    expect(ndviOf(0, 4000, C1, C1)).toBeNull();
    expect(ndviOf(1500, 0, C1, C1)).toBeNull();
  });
});

describe('regionIndexStats', () => {
  const forest = { red: dn(0.03), nir: dn(0.3), swir: dn(0.1) }; // NDVI 0.818, NBR 0.5
  const burnt = { red: dn(0.08), nir: dn(0.13), swir: dn(0.23) }; // NDVI 0.238, NBR −0.278
  const bands = (px: { red: number; nir: number; swir: number }[], scl: number[]) => ({
    red: px.map(p => p.red), nir: px.map(p => p.nir), swir: px.map(p => p.swir), scl,
  });
  const scales = { red: C1, nir: C1, swir: C1 };

  it('means over clear pixels inside the mask only', () => {
    const b = bands([forest, burnt, forest, burnt], [CLEAR, CLEAR, CLEAR, CLEAR]);
    const s = regionIndexStats(b, scales, [1, 1, 0, 0]);
    expect(s).toEqual({ total: 2, valid: 2, validPct: 100, ndvi: 0.528, nbr: 0.111 });
  });

  it('SCL mask: clouds, shadows, cirrus, snow, saturated and nodata do not count; class 2 (dark) does', () => {
    const scl = [CLEAR, DARK, CLOUD, SHADOW, SNOW, CIRRUS, NODATA, SATURATED];
    const b = bands(scl.map((_, i) => (i === 1 ? burnt : forest)), scl);
    const s = regionIndexStats(b, scales, scl.map(() => 1));
    expect(s.total).toBe(8);
    expect(s.valid).toBe(2);
    expect(s.validPct).toBe(25);
    expect(s.ndvi).toBeNull(); // 25 % < 50 %
  });

  it('band nodata (0) makes a pixel invalid even when SCL is clear', () => {
    const b = bands([forest, { ...forest, swir: 0 }, { ...forest, red: 0 }, forest], [CLEAR, CLEAR, CLEAR, CLEAR]);
    const s = regionIndexStats(b, scales, [1, 1, 1, 1]);
    expect(s.valid).toBe(2);
    expect(s.validPct).toBe(50);
    expect(s.ndvi).toBeCloseTo(0.818, 3);
  });

  it('exactly 50 % clear passes, below it the mean is withheld', () => {
    expect(MIN_VALID_FRACTION).toBe(0.5);
    const two = bands([forest, forest], [CLEAR, CLOUD]);
    expect(regionIndexStats(two, scales, [1, 1]).ndvi).not.toBeNull();
    const three = bands([forest, forest, forest], [CLEAR, CLOUD, CLOUD]);
    expect(regionIndexStats(three, scales, [1, 1, 1])).toMatchObject({ validPct: 33, ndvi: null, nbr: null });
  });

  it('validPct is floored (199 of 400 → 49, not a passing 50)', () => {
    const n = 400;
    const b = bands(Array(n).fill(forest), Array.from({ length: n }, (_, i) => (i < 199 ? CLEAR : CLOUD)));
    expect(regionIndexStats(b, scales, new Uint8Array(n).fill(1))).toMatchObject({ validPct: 49, ndvi: null });
  });

  it('without swir: NDVI only, NBR null', () => {
    const { swir: _drop, ...noSwir } = bands([forest], [CLEAR]);
    const s = regionIndexStats(noSwir, { red: C1, nir: C1 }, [1]);
    expect(s.ndvi).toBeCloseTo(0.818, 3);
    expect(s.nbr).toBeNull();
  });

  it('an empty region has no values', () => {
    expect(regionIndexStats(bands([forest], [CLEAR]), scales, [0])).toEqual({ total: 0, valid: 0, validPct: 0, ndvi: null, nbr: null });
  });
});

describe('masks', () => {
  it('pointInPolygon', () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(pointInPolygon(2, 2, square)).toBe(true);
    expect(pointInPolygon(5, 2, square)).toBe(false);
    // slightly rotated quadrilateral (a WGS84 bbox in UTM)
    const rotated: [number, number][] = [[1, 0], [5, 0.3], [4.7, 4.3], [0.7, 4]];
    expect(pointInPolygon(0.8, 0.1, rotated)).toBe(false);
    expect(pointInPolygon(3, 2, rotated)).toBe(true);
  });

  it('polygonMask marks pixels whose centre is inside', () => {
    const mask = polygonMask({ width: 4, height: 3 }, [[1, 1], [3, 1], [3, 3], [1, 3]]);
    expect(Array.from(mask)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it('a polygon smaller than a pixel still marks the pixel holding its centre', () => {
    const mask = polygonMask({ width: 3, height: 3 }, [[1.2, 1.1], [1.3, 1.1], [1.3, 1.2], [1.2, 1.2]]);
    expect(Array.from(mask)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('the ring is the AOI minus the site', () => {
    const aoi = polygonMask({ width: 4, height: 4 }, [[0, 0], [4, 0], [4, 4], [0, 4]]);
    const site = polygonMask({ width: 4, height: 4 }, [[1, 1], [3, 1], [3, 3], [1, 3]]);
    const ring = subtractMask(aoi, site);
    expect(ring.reduce((a, b) => a + b, 0)).toBe(12);
    expect(Array.from(ring).every((v, i) => v !== site[i])).toBe(true);
  });

  it('site padding is half a VIIRS pixel', () => {
    expect(SITE_PAD_KM).toBe(0.1875);
  });
});

describe('severityOf (USGS, Key & Benson 2006)', () => {
  it.each([
    [-0.3, 'unburned'], [0, 'unburned'], [0.0999, 'unburned'],
    [0.1, 'low'], [0.2699, 'low'],
    [0.27, 'moderate-low'], [0.4399, 'moderate-low'],
    [0.44, 'moderate-high'], [0.6599, 'moderate-high'],
    [0.66, 'high'], [1.3, 'high'],
  ])('dNBR %p → %p', (value, cls) => {
    expect(severityOf(value).class).toBe(cls);
  });

  it('thresholds and labels', () => {
    expect(DNBR_THRESHOLDS).toEqual({ low: 0.1, moderateLow: 0.27, moderateHigh: 0.44, high: 0.66 });
    expect(severityOf(0.5).label).toBe('умеренно-высокая степень выгорания');
    expect(severityOf(0.02).label).toBe('не горело / без изменений');
  });
});

describe('combineIndices', () => {
  const site: [number, number, number, number] = [1, 2, 3, 4];
  const stats = (ndvi: number | null, nbr: number | null, validPct = 100): RegionIndexStats => ({ total: 100, valid: validPct, validPct, ndvi, nbr });

  it('ΔNDVI = after − before, dNBR = before − after with its class', () => {
    expect(combineIndices(stats(0.8, 0.5), stats(0.3, -0.2), false, site)).toEqual({
      before: { ndvi: 0.8, nbr: 0.5, validPct: 100 },
      after: { ndvi: 0.3, nbr: -0.2, validPct: 100 },
      dNdvi: -0.5,
      dNbr: 0.7,
      severity: { class: 'high', label: 'высокая степень выгорания' },
      reasons: [],
      site,
      note: INDEX_NOTE,
    });
  });

  it('"after" during activity: ΔNDVI stays, dNBR is null with the reason', () => {
    const r = combineIndices(stats(0.8, 0.5), stats(0.3, -0.2), true, site);
    expect(r).toMatchObject({ dNdvi: -0.5, dNbr: null, severity: null, reasons: [INDEX_REASONS.duringActivity] });
  });

  it('a missing side: null side, no differences', () => {
    expect(combineIndices(null, stats(0.3, -0.2), false, site)).toMatchObject({
      before: null, dNdvi: null, dNbr: null, severity: null, reasons: [INDEX_REASONS.beforeMissing],
    });
    expect(combineIndices(stats(0.8, 0.5), null, false, site).reasons).toEqual([INDEX_REASONS.afterMissing]);
    expect(combineIndices(null, null, false, site).reasons).toHaveLength(2);
  });

  it('a cloudy side keeps its validPct and says why', () => {
    const r = combineIndices(stats(0.8, 0.5), stats(null, null, 31), false, site);
    expect(r.after).toEqual({ ndvi: null, nbr: null, validPct: 31 });
    expect(r.dNbr).toBeNull();
    expect(r.reasons).toEqual(['снимок «после»: над участком 31% чистых пикселей, нужно не меньше 50%']);
  });

  it('rounds differences to 3 decimals', () => {
    expect(combineIndices(stats(0.812, 0.526), stats(0.238, -0.278), false, site)).toMatchObject({ dNdvi: -0.574, dNbr: 0.804 });
  });
});

describe('ndviColor', () => {
  it('brown at the bottom, green at the top, clamped outside the scale', () => {
    expect(ndviColor(NDVI_RENDER_MIN)).toEqual(NDVI_STOPS[0][1]);
    expect(ndviColor(-1)).toEqual(NDVI_STOPS[0][1]);
    expect(ndviColor(NDVI_RENDER_MAX)).toEqual(NDVI_STOPS[NDVI_STOPS.length - 1][1]);
    expect(ndviColor(1)).toEqual(NDVI_STOPS[NDVI_STOPS.length - 1][1]);
    const [r, g, b] = ndviColor(0.85);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('interpolates between stops', () => {
    const mid = (NDVI_STOPS[1][0] + NDVI_STOPS[2][0]) / 2;
    const c = ndviColor(mid);
    [0, 1, 2].forEach(k => expect(c[k]).toBe(Math.round((NDVI_STOPS[1][1][k] + NDVI_STOPS[2][1][k]) / 2)));
  });

  it('stops ascend over the render scale', () => {
    expect(NDVI_STOPS[0][0]).toBe(NDVI_RENDER_MIN);
    expect(NDVI_STOPS[NDVI_STOPS.length - 1][0]).toBe(NDVI_RENDER_MAX);
    NDVI_STOPS.slice(1).forEach(([v], i) => expect(v).toBeGreaterThan(NDVI_STOPS[i][0]));
  });
});
