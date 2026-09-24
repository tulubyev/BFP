import { assembleRings, buildMultiPolygon, type Position } from '../../backend/utils/osmRings';

const way = (...points: Position[]) => points.map(([lon, lat]) => ({ lat, lon }));

describe('assembleRings', () => {
  it('keeps an already-closed single way as one ring', () => {
    const rectangle: Position[] = [[104, 53], [105, 53], [105, 54], [104, 54], [104, 53]];
    expect(assembleRings([rectangle])).toEqual([rectangle]);
  });

  it('stitches two segments sharing endpoints into one closed ring', () => {
    const a: Position[] = [[110, 50], [111, 50], [111, 51]];
    const b: Position[] = [[111, 51], [110, 51], [110, 50]];
    const [ring] = assembleRings([a, b]);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBe(5); // 3 + 3 - 1 shared endpoint
  });

  it('matches segments regardless of direction', () => {
    const a: Position[] = [[0, 0], [1, 0]];
    const b: Position[] = [[2, 1], [1, 1], [1, 0]]; // reversed relative to `a`'s end
    const c: Position[] = [[0, 1], [0, 0]]; // closes back to start, reversed
    const combined = assembleRings([a, b, c]);
    expect(combined).toHaveLength(1);
    const [ring] = combined;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('force-closes a dangling segment instead of dropping it', () => {
    const open: Position[] = [[0, 0], [1, 0], [1, 1]];
    const [ring] = assembleRings([open]);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('drops segments too short to ever form a ring', () => {
    expect(assembleRings([[[0, 0]]])).toEqual([]);
  });
});

describe('buildMultiPolygon', () => {
  it('returns null when there are no usable outer ways', () => {
    expect(buildMultiPolygon([])).toBeNull();
    expect(buildMultiPolygon([{ role: 'outer', geometry: way([0, 0]) }])).toBeNull();
  });

  it('builds a Polygon from a single outer way', () => {
    const outer = way([104, 53], [105, 53], [105, 54], [104, 54], [104, 53]);
    const result = buildMultiPolygon([{ role: 'outer', geometry: outer }]);
    expect(result).toEqual({
      type: 'Polygon',
      coordinates: [[[104, 53], [105, 53], [105, 54], [104, 54], [104, 53]]],
    });
  });

  it('treats an empty role as outer (non-multipolygon-tagged boundary ways)', () => {
    const outer = way([0, 0], [1, 0], [1, 1], [0, 1], [0, 0]);
    const result = buildMultiPolygon([{ role: '', geometry: outer }]);
    expect(result?.type).toBe('Polygon');
  });

  it('assembles a split outer ring and attaches a hole to it', () => {
    const outerA = way([110, 50], [111, 50], [111, 51]);
    const outerB = way([111, 51], [110, 51], [110, 50]);
    const hole = way([110.3, 50.3], [110.7, 50.3], [110.7, 50.7], [110.3, 50.7], [110.3, 50.3]);
    const result = buildMultiPolygon([
      { role: 'outer', geometry: outerA },
      { role: 'outer', geometry: outerB },
      { role: 'inner', geometry: hole },
    ]);
    expect(result?.type).toBe('Polygon');
    const polygon = result as GeoJSON.Polygon;
    expect(polygon.coordinates).toHaveLength(2); // outer + 1 hole
    expect(polygon.coordinates[1]).toEqual(hole.map(p => [p.lon, p.lat]));
  });

  it('drops a hole that matches no outer ring instead of throwing', () => {
    const outer = way([0, 0], [1, 0], [1, 1], [0, 1], [0, 0]);
    const strayHole = way([50, 50], [51, 50], [51, 51], [50, 51], [50, 50]);
    const result = buildMultiPolygon([
      { role: 'outer', geometry: outer },
      { role: 'inner', geometry: strayHole },
    ]);
    expect((result as GeoJSON.Polygon).coordinates).toHaveLength(1);
  });

  it('builds a MultiPolygon from two disjoint outer rings', () => {
    const first = way([0, 0], [1, 0], [1, 1], [0, 1], [0, 0]);
    const second = way([10, 10], [11, 10], [11, 11], [10, 11], [10, 10]);
    const result = buildMultiPolygon([
      { role: 'outer', geometry: first },
      { role: 'outer', geometry: second },
    ]);
    expect(result?.type).toBe('MultiPolygon');
    expect((result as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });
});
