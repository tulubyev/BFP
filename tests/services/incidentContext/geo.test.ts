import {
  EARTH_RADIUS_KM, bearingDeg, compassWords, destination, haversineKm, isValidLatLon, pointToPolyline, pointToSegment,
  type LatLon,
} from '../../../backend/services/incidentContext/geo';

const RAD = Math.PI / 180;

/** Point at fraction f along the great circle a→b (spherical interpolation) — independent of the code under test. */
function interpolate(a: LatLon, b: LatLon, f: number): LatLon {
  const toVec = (p: LatLon) => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]);
  const ω = Math.acos(dot);
  if (ω < 1e-12) return a;
  const [ka, kb] = [Math.sin((1 - f) * ω) / Math.sin(ω), Math.sin(f * ω) / Math.sin(ω)];
  const v = va.map((x, i) => ka * x + kb * vb[i]);
  return { lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD, lon: Math.atan2(v[1], v[0]) / RAD };
}

/** Minimum distance to densely sampled points of the segment. */
function bruteForceKm(p: LatLon, a: LatLon, b: LatLon, samples = 20000): number {
  let best = Infinity;
  for (let i = 0; i <= samples; i++) best = Math.min(best, haversineKm(p, interpolate(a, b, i / samples)));
  return best;
}

describe('haversineKm', () => {
  it('matches known distances', () => {
    // one degree of latitude ≈ 111.2 km; one degree of longitude on the equator the same
    expect(haversineKm({ lat: 52, lon: 104 }, { lat: 53, lon: 104 })).toBeCloseTo(EARTH_RADIUS_KM * RAD, 6);
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.195, 2);
    // Irkutsk → Moscow ≈ 4200 km
    expect(haversineKm({ lat: 52.2869, lon: 104.305 }, { lat: 55.7558, lon: 37.6173 })).toBeGreaterThan(4150);
    expect(haversineKm({ lat: 52.2869, lon: 104.305 }, { lat: 55.7558, lon: 37.6173 })).toBeLessThan(4250);
    expect(haversineKm({ lat: 52.3, lon: 104.2 }, { lat: 52.3, lon: 104.2 })).toBe(0);
  });

  it('crosses the antimeridian (Chukotka)', () => {
    expect(haversineKm({ lat: 66, lon: 179.9 }, { lat: 66, lon: -179.9 })).toBeCloseTo(0.2 * 111.195 * Math.cos(66 * RAD), 2);
  });
});

describe('bearingDeg / compassWords', () => {
  const o = { lat: 52.3, lon: 104.2 };
  it('gives the initial bearing in [0, 360)', () => {
    expect(bearingDeg(o, { lat: 52.4, lon: 104.2 })).toBeCloseTo(0, 6);
    expect(bearingDeg(o, { lat: 52.3, lon: 104.3 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 52.2, lon: 104.2 })).toBeCloseTo(180, 6);
    expect(bearingDeg(o, { lat: 52.3, lon: 104.1 })).toBeCloseTo(270, 0);
    expect(bearingDeg({ lat: 66, lon: 179.95 }, { lat: 66, lon: -179.95 })).toBeCloseTo(90, 0);
  });

  it('names 8 directions with 45° sectors', () => {
    expect([0, 44, 45, 90, 135, 180, 225, 270, 315, 337, 338, 359.9, 360, -45].map(compassWords)).toEqual([
      'на север', 'на северо-восток', 'на северо-восток', 'на восток', 'на юго-восток', 'на юг', 'на юго-запад',
      'на запад', 'на северо-запад', 'на северо-запад', 'на север', 'на север', 'на север', 'на северо-запад',
    ]);
    expect(compassWords(22.4)).toBe('на север');
    expect(compassWords(22.6)).toBe('на северо-восток');
  });
});

describe('destination', () => {
  it('is the inverse of distance + bearing', () => {
    const start = { lat: 52.3, lon: 104.2 };
    const d = destination(start, 37, 12.5);
    expect(haversineKm(start, d)).toBeCloseTo(12.5, 6);
    expect(bearingDeg(start, d)).toBeCloseTo(37, 6);
    expect(destination({ lat: 66, lon: 179.99 }, 90, 5).lon).toBeLessThan(-179);
  });
});

describe('pointToSegment', () => {
  const p = { lat: 52.3, lon: 104.2 };

  it('measures to the segment, not to its vertices', () => {
    // N–S road 0.03° east (≈ 2.04 km); both vertices ≈ 3 km away
    const a = { lat: 52.28, lon: 104.23 };
    const b = { lat: 52.33, lon: 104.23 };
    const d = pointToSegment(p, a, b);
    expect(d.km).toBeCloseTo(2.04, 1);
    expect(d.km).toBeLessThan(Math.min(haversineKm(p, a), haversineKm(p, b)) - 0.8);
    expect(d.km).toBeCloseTo(bruteForceKm(p, a, b), 3);
    expect(d.nearest.lat).toBeCloseTo(52.3, 3);
    expect(d.nearest.lon).toBeCloseTo(104.23, 6);
    expect(haversineKm(p, d.nearest)).toBeCloseTo(d.km, 6);
  });

  it('clamps to the nearer end when the perpendicular falls outside', () => {
    const a = { lat: 52.35, lon: 104.1 };
    const b = { lat: 52.35, lon: 104.15 };
    const d = pointToSegment(p, a, b);
    expect(d.nearest).toEqual(b);
    expect(d.km).toBeCloseTo(haversineKm(p, b), 9);
    const back = pointToSegment(p, b, a);
    expect(back.nearest).toEqual(b);
    expect(back.km).toBeCloseTo(d.km, 9);
  });

  it('handles a degenerate segment and a point on the segment', () => {
    const a = { lat: 52.31, lon: 104.21 };
    expect(pointToSegment(p, a, a).km).toBeCloseTo(haversineKm(p, a), 9);
    expect(pointToSegment(p, { lat: 52.2, lon: 104.2 }, { lat: 52.4, lon: 104.2 }).km).toBeLessThan(1e-6);
    expect(pointToSegment(p, p, { lat: 52.4, lon: 104.3 }).km).toBe(0);
  });

  it('agrees with brute force on random segments (both sides, diagonals, long segments)', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 60; i++) {
      const a = { lat: 52.3 + (rnd() - 0.5) * 0.4, lon: 104.2 + (rnd() - 0.5) * 0.6 };
      const b = { lat: 52.3 + (rnd() - 0.5) * 0.4, lon: 104.2 + (rnd() - 0.5) * 0.6 };
      const d = pointToSegment(p, a, b).km;
      const brute = bruteForceKm(p, a, b, 4000);
      expect(d).toBeLessThanOrEqual(brute + 1e-6);
      expect(brute - d).toBeLessThan(0.01);
    }
  });

  it('works across the antimeridian', () => {
    const q = { lat: 66, lon: 180 };
    const d = pointToSegment(q, { lat: 65.9, lon: 179.98 }, { lat: 66.1, lon: 179.98 });
    expect(d.km).toBeCloseTo(0.02 * 111.195 * Math.cos(66 * RAD), 2);
    const across = pointToSegment(q, { lat: 66.05, lon: 179.9 }, { lat: 66.05, lon: -179.9 });
    expect(across.km).toBeCloseTo(0.05 * 111.195, 1);
  });
});

describe('pointToPolyline', () => {
  const p = { lat: 52.3, lon: 104.2 };
  it('takes the nearest segment of the line', () => {
    const line = [{ lat: 52.36, lon: 104.1 }, { lat: 52.36, lon: 104.22 }, { lat: 52.31, lon: 104.3 }];
    const d = pointToPolyline(p, line)!;
    const perSegment = [pointToSegment(p, line[0], line[1]).km, pointToSegment(p, line[1], line[2]).km];
    expect(d.km).toBeCloseTo(Math.min(...perSegment), 9);
  });

  it('a single vertex is a point; no valid vertices → null; invalid vertices are skipped', () => {
    expect(pointToPolyline(p, [{ lat: 52.31, lon: 104.2 }])!.km).toBeCloseTo(1.112, 2);
    expect(pointToPolyline(p, [])).toBeNull();
    expect(pointToPolyline(p, [{ lat: NaN, lon: 1 }, { lat: 91, lon: 0 }] as LatLon[])).toBeNull();
    expect(pointToPolyline(p, [{ lat: 52.31, lon: 104.2 }, { lat: NaN, lon: 0 }] as LatLon[])!.km).toBeCloseTo(1.112, 2);
  });
});

describe('isValidLatLon', () => {
  it('accepts WGS84 numbers only', () => {
    expect(isValidLatLon({ lat: 52, lon: 104 })).toBe(true);
    expect(isValidLatLon({ lat: -90, lon: -180 })).toBe(true);
    for (const bad of [null, undefined, {}, { lat: '52', lon: 104 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: Infinity, lon: 0 }]) {
      expect(isValidLatLon(bad)).toBe(false);
    }
  });
});
