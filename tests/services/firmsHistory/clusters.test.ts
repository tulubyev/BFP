import {
  bboxDistanceKm, clusterPoints, haversineKm, pixelAreaHa, pixelKey, pointsBbox, qualifies, uniquePixels,
} from '../../../backend/services/firmsHistory/clusters';
import { point } from './fixtures';

describe('haversineKm', () => {
  it('measures ~111 km per degree of latitude and shrinks longitude with latitude', () => {
    expect(haversineKm(52, 104, 53, 104)).toBeCloseTo(111.2, 0);
    expect(haversineKm(52, 104, 52, 105)).toBeCloseTo(68.5, 0);
  });
});

describe('clusterPoints (single linkage ≤ 2 km)', () => {
  it('chains points whose neighbours are within 2 km even if the ends are farther apart', () => {
    // 0.015° lat ≈ 1.67 km steps: ends are ~5 km apart but connected by the chain
    const pts = [point(1, 52.0, 104), point(2, 52.015, 104), point(3, 52.03, 104), point(4, 52.045, 104)];
    const clusters = clusterPoints(pts);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map(p => p.id)).toEqual([1, 2, 3, 4]);
  });

  it('splits at a gap just over 2 km and joins at just under', () => {
    const over = clusterPoints([point(1, 52.0, 104), point(2, 52.0181, 104)]); // ~2.01 km
    expect(over).toHaveLength(2);
    const under = clusterPoints([point(1, 52.0, 104), point(2, 52.0179, 104)]); // ~1.99 km
    expect(under).toHaveLength(1);
  });

  it('uses real distance on longitude too (not degrees)', () => {
    // 0.03° lon at 52°N ≈ 2.05 km; 0.028° ≈ 1.92 km
    expect(clusterPoints([point(1, 52, 104), point(2, 52, 104.03)])).toHaveLength(2);
    expect(clusterPoints([point(1, 52, 104), point(2, 52, 104.028)])).toHaveLength(1);
  });

  it('orders points oldest first (ties by id) and clusters by their first point', () => {
    const clusters = clusterPoints([
      point(9, 53, 105, { acquiredAt: '2026-09-24T01:00:00.000Z' }),
      point(3, 52.001, 104, { acquiredAt: '2026-09-24T03:00:00.000Z' }),
      point(2, 52, 104, { acquiredAt: '2026-09-24T03:00:00.000Z' }),
      point(5, 52.002, 104, { acquiredAt: '2026-09-23T23:00:00.000Z' }),
    ]);
    expect(clusters.map(c => c.map(p => p.id))).toEqual([[5, 2, 3], [9]]);
  });

  it('handles empty input', () => {
    expect(clusterPoints([])).toEqual([]);
  });
});

describe('qualifies', () => {
  it('needs ≥ 2 points or one high-confidence point', () => {
    expect(qualifies([point(1, 52, 104)])).toBe(false);
    expect(qualifies([point(1, 52, 104, { confidence: 'high' })])).toBe(true);
    expect(qualifies([point(1, 52, 104), point(2, 52.001, 104)])).toBe(true);
  });
});

describe('pixel area estimate', () => {
  it('counts repeated detections of the same 375 m cell once', () => {
    const pts = [point(1, 52.0005, 104.0005), point(2, 52.0006, 104.0006), point(3, 52.01, 104)];
    expect(uniquePixels(pts).size).toBe(2);
    expect(pixelKey(52.0005, 104.0005)).toBe(pixelKey(52.0006, 104.0006));
  });
  it('multiplies unique pixels by 14.06 ha', () => {
    expect(pixelAreaHa(1)).toBe(14.06);
    expect(pixelAreaHa(3)).toBe(42.18);
    expect(pixelAreaHa(0)).toBe(0);
  });
});

describe('bboxDistanceKm', () => {
  const a = pointsBbox([point(1, 52, 104), point(2, 52.01, 104.01)]);
  it('is 0 for overlapping or touching boxes', () => {
    expect(bboxDistanceKm(a, a)).toBe(0);
    expect(bboxDistanceKm(a, pointsBbox([point(3, 52.005, 104.01)]))).toBe(0);
  });
  it('measures the gap in km along latitude, longitude and diagonally', () => {
    expect(bboxDistanceKm(a, pointsBbox([point(3, 52.03, 104.005)]))).toBeCloseTo(2.22, 1);
    expect(bboxDistanceKm(a, pointsBbox([point(3, 52.005, 104.04)]))).toBeCloseTo(2.05, 1);
    const diag = bboxDistanceKm(a, pointsBbox([point(3, 52.02, 104.02)]));
    expect(diag).toBeCloseTo(Math.hypot(1.11, 0.685), 1);
  });
});
