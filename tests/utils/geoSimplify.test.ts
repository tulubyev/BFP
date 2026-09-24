import { countVertices, simplifyFeatureGeometry } from '../../backend/utils/geoSimplify';

/** A closed ring approximating a circle with `n` vertices, centered at (lon, lat). */
function circleRing(n: number, lon: number, lat: number, radiusDeg: number): GeoJSON.Position[] {
  const ring: GeoJSON.Position[] = [];
  for (let i = 0; i <= n; i++) {
    const angle = (2 * Math.PI * (i % n)) / n;
    ring.push([lon + radiusDeg * Math.cos(angle), lat + radiusDeg * Math.sin(angle)]);
  }
  return ring;
}

function isClosed(ring: GeoJSON.Position[]): boolean {
  return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
}

describe('simplifyFeatureGeometry', () => {
  it('leaves a small polygon under the cap untouched in vertex count', () => {
    const square: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    const result = simplifyFeatureGeometry(square, 300);
    expect(countVertices(result)).toBe(5);
  });

  it('reduces a large, over-detailed ring to at most the requested vertex cap', () => {
    const detailed: GeoJSON.Polygon = { type: 'Polygon', coordinates: [circleRing(2000, 104, 53, 0.5)] };
    const result = simplifyFeatureGeometry(detailed, 300);
    expect(countVertices(result)).toBeLessThanOrEqual(300);
    expect(countVertices(result)).toBeGreaterThan(4);
  });

  it('keeps every ring closed after simplification, including the hard-decimation fallback', () => {
    // A pathological ring Douglas-Peucker alone won't shrink much: many points on a near-straight
    // zig-zag, forcing the decimation fallback to actually run.
    const zigzag: GeoJSON.Position[] = [[0, 0]];
    for (let i = 1; i <= 1000; i++) zigzag.push([i * 0.5, i % 2 === 0 ? 0.5 : -0.5]);
    zigzag.push([0, 0]);
    const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates: [zigzag] };
    const result = simplifyFeatureGeometry(polygon, 50) as GeoJSON.Polygon;
    const [ring] = result.coordinates;
    expect(isClosed(ring)).toBe(true);
    expect(ring.length).toBeLessThanOrEqual(50);
  });

  it('assembles holes correctly through a MultiPolygon and caps each ring independently', () => {
    const multi: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [circleRing(1000, 0, 0, 0.2)],
        [circleRing(1000, 10, 10, 0.2)],
      ],
    };
    const result = simplifyFeatureGeometry(multi, 100) as GeoJSON.MultiPolygon;
    for (const poly of result.coordinates) {
      for (const ring of poly) {
        expect(ring.length).toBeLessThanOrEqual(100);
        expect(isClosed(ring)).toBe(true);
      }
    }
  });

  it('truncates coordinates to 5 decimal places', () => {
    const square: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[[0.123456789, 0], [1.000000001, 0], [1, 1], [0, 1], [0.123456789, 0]]],
    };
    const result = simplifyFeatureGeometry(square, 300) as GeoJSON.Polygon;
    const decimals = (n: number) => (n.toString().split('.')[1] || '').length;
    for (const [lon, lat] of result.coordinates[0]) {
      expect(decimals(lon)).toBeLessThanOrEqual(5);
      expect(decimals(lat)).toBeLessThanOrEqual(5);
    }
  });
});
