import {
  countProblem, geometryProblem, MIN_OOPT_FEATURES, ooptVerdict, overpassAnswerProblem, tallyProblems,
} from '../../../backend/services/quality/overpassOopt';

const square: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[104, 53], [105, 53], [105, 54], [104, 54], [104, 53]]] };

describe('overpassAnswerProblem', () => {
  it('accepts a JSON answer with elements (also an empty list — the count check handles that)', () => {
    expect(overpassAnswerProblem({ version: 0.6, elements: [{ type: 'relation' }] })).toBeNull();
    expect(overpassAnswerProblem({ elements: [] })).toBeNull();
  });

  it.each([
    ['an HTML error page', '<?xml version="1.0"?><html><body>504 Gateway Timeout</body></html>', /HTML page instead of JSON/],
    ['truncated JSON (axios leaves it a string)', '{"version":0.6,"elements":[{"type":"relation","id":1,', /not valid JSON \(truncated\?\)/],
    ['an empty body', '', /empty response/],
    ['JSON without elements', { version: 0.6, osm3s: {} }, /without an "elements" array/],
    ['null', null, /not a JSON object/],
    ['a runtime-error remark (partial answer)', { elements: [{}], remark: 'runtime error: Query timed out in "query" at line 3 after 181 seconds.' }, /Overpass reported an error/],
  ])('rejects %s', (_label, body, reason) => {
    expect(overpassAnswerProblem(body)).toMatch(reason);
  });
});

describe('geometryProblem', () => {
  it('accepts valid polygons, multipolygons with holes and points', () => {
    expect(geometryProblem(square)).toBeNull();
    const hole = [[104.2, 53.2], [104.4, 53.2], [104.4, 53.4], [104.2, 53.4], [104.2, 53.2]];
    expect(geometryProblem({ type: 'MultiPolygon', coordinates: [[square.coordinates[0], hole], square.coordinates] })).toBeNull();
    expect(geometryProblem({ type: 'Point', coordinates: [100, 55] })).toBeNull();
    // Chukotka: negative longitudes are valid WGS84
    expect(geometryProblem({ type: 'Polygon', coordinates: [[[-175, 66], [-174, 66], [-174, 67], [-175, 67], [-175, 66]]] })).toBeNull();
  });

  it.each([
    ['coordinates outside WGS84', { type: 'Polygon', coordinates: [[[104, 53], [205, 53], [105, 54], [104, 53]]] }, /outside WGS84/],
    ['swapped/NaN coordinates', { type: 'Polygon', coordinates: [[[104, NaN], [105, 53], [105, 54], [104, NaN]]] }, /outside WGS84/],
    ['an open ring', { type: 'Polygon', coordinates: [[[104, 53], [105, 53], [105, 54], [104, 54]]] }, /not closed/],
    ['a ring of 3 positions', { type: 'Polygon', coordinates: [[[104, 53], [105, 53], [104, 53]]] }, /< 4 positions/],
    ['zero area (collinear)', { type: 'Polygon', coordinates: [[[104, 53], [105, 53], [106, 53], [104, 53]]] }, /zero area/],
    ['a polygon without rings', { type: 'Polygon', coordinates: [] }, /unsupported or empty|without rings/],
    ['an empty multipolygon', { type: 'MultiPolygon', coordinates: [] }, /empty geometry/],
    ['a point outside WGS84', { type: 'Point', coordinates: [100, 95] }, /point outside WGS84/],
    ['no geometry', null, /no geometry/],
  ])('rejects %s', (_label, geometry, reason) => {
    expect(geometryProblem(geometry as any)).toMatch(reason);
  });
});

describe('countProblem', () => {
  it('accepts a plausible count', () => {
    expect(countProblem(130, 130)).toBeNull();
    expect(countProblem(66, 130)).toBeNull();
    expect(countProblem(MIN_OOPT_FEATURES, null)).toBeNull();
  });

  it('rejects fewer than half of the last good list as truncated', () => {
    expect(countProblem(64, 130)).toMatch(/only 64 .* last good list had 130 .* truncated/);
  });

  it('rejects fewer than 20 even without a last good list', () => {
    expect(countProblem(19, undefined)).toMatch(/only 19 protected areas \(< 20\)/);
    expect(countProblem(0, null)).toMatch(/only 0/);
  });
});

describe('ooptVerdict', () => {
  it('passes with the dropped objects counted and tallied', () => {
    const r = ooptVerdict(132, ['ring not closed', 'zero area', 'ring not closed'], 128, 130);
    expect(r).toMatchObject({ source: 'oopt', check: 'overpass', ok: true, total: 132, rejected: 3 });
    expect(r.reason).toBe('dropped 2 × ring not closed, 1 × zero area');
  });

  it('fails on a truncated answer and keeps the drop tally in the reason', () => {
    const r = ooptVerdict(12, ['zero area'], 11, 130);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/only 11 .*; dropped 1 × zero area/);
  });

  it('tallyProblems is undefined without problems', () => {
    expect(tallyProblems([])).toBeUndefined();
  });
});
