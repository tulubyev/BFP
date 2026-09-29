import fixture from '../../fixtures/overpass/incident-context.json';
import {
  CONTEXT_LICENSE, CONTEXT_TTL_SEC, OverpassAnswerError, RADIUS_KM, buildContext, buildContextQuery, classifyRoad,
  contextCacheKey, contextPoint, nearestRoad, nearestSettlement, parseContextAnswer, type OsmRoad,
} from '../../../backend/services/incidentContext/context';
import { haversineKm } from '../../../backend/services/incidentContext/geo';
import { SQL_KEYWORDS_RE } from '../../security/sqlGuard';

const P = { lat: 52.3, lon: 104.2 };

describe('buildContextQuery', () => {
  it('asks for road ways with geometry and settlements with a centre within 15 km', () => {
    const q = buildContextQuery(P);
    expect(q).toContain('[out:json][timeout:60];');
    expect(q).toContain('way(around:15000,52.30000,104.20000)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track)$"];');
    expect(q).toContain('out tags geom;');
    expect(q).toContain('nwr(around:15000,52.30000,104.20000)["place"~"^(city|town|village|hamlet)$"];');
    expect(q).toContain('out tags center;');
    for (const excluded of ['footway', 'path', 'steps', 'cycleway', 'service']) expect(q).not.toMatch(new RegExp(`\\b${excluded}\\b`));
    // not SQL, so the SQL guard does not treat it as such
    expect(SQL_KEYWORDS_RE.test(q)).toBe(false);
  });

  it('formats numbers itself and refuses an invalid point', () => {
    expect(buildContextQuery({ lat: 66.123456789, lon: -179.5 }, 2.5, 30)).toContain('around:2500,66.12346,-179.50000');
    expect(() => buildContextQuery({ lat: NaN, lon: 1 })).toThrow('invalid point');
    expect(() => buildContextQuery({ lat: 1, lon: 200 })).toThrow('invalid point');
  });
});

describe('classifyRoad', () => {
  it('reports car roads and tracks, not paths, service roads or non-roads', () => {
    expect(classifyRoad({ highway: 'tertiary' })?.kind).toBe('road');
    expect(classifyRoad({ highway: 'trunk_link' })?.kind).toBe('road');
    expect(classifyRoad({ highway: 'track' })?.kind).toBe('track');
    for (const highway of ['footway', 'path', 'steps', 'cycleway', 'service', 'pedestrian', 'construction', 'proposed', 'bus_stop', '']) {
      expect(classifyRoad({ highway })).toBeNull();
    }
    expect(classifyRoad({})).toBeNull();
  });

  it('paved from `surface`, else by class for motorway…secondary; tracks only by surface', () => {
    expect(classifyRoad({ highway: 'tertiary', surface: 'asphalt' })).toMatchObject({ paved: true, paved_by_class: false });
    expect(classifyRoad({ highway: 'trunk', surface: 'gravel' })).toMatchObject({ paved: false, paved_by_class: false, surface: 'gravel' });
    expect(classifyRoad({ highway: 'primary' })).toMatchObject({ paved: true, paved_by_class: true, surface: null });
    expect(classifyRoad({ highway: 'secondary_link' })).toMatchObject({ paved: true, paved_by_class: true });
    expect(classifyRoad({ highway: 'tertiary' })).toMatchObject({ paved: false, paved_by_class: false });
    expect(classifyRoad({ highway: 'unclassified', surface: 'Concrete:Plates' })).toMatchObject({ paved: true, surface: 'concrete:plates' });
    expect(classifyRoad({ highway: 'track' })).toMatchObject({ paved: false, paved_by_class: false });
    expect(classifyRoad({ highway: 'track', surface: 'concrete' })).toMatchObject({ kind: 'track', paved: true });
  });
});

describe('parseContextAnswer (fixture)', () => {
  const parsed = parseContextAnswer(fixture);

  it('keeps roads with geometry and settlements, drops the rest with a count', () => {
    expect(parsed.roads.map(r => [r.osm_id, r.kind, r.highway])).toEqual([
      [1001, 'road', 'tertiary'], [1002, 'road', 'trunk'], [1003, 'road', 'primary'], [1004, 'track', 'track'],
    ]);
    expect(parsed.places.map(p => [p.osm_type, p.osm_id, p.place, p.name])).toEqual([
      ['node', 2001, 'village', 'Ключи'], ['relation', 3001, 'town', 'Дальний'], ['way', 3002, 'hamlet', null],
    ]);
    // footway, service, the residential way with broken geometry, isolated_dwelling
    expect(parsed.skipped).toBe(4);
    expect(parsed.osmBase).toBe('2026-09-28T21:14:03Z');
    expect(parsed.roads[1]).toMatchObject({ ref: 'Р-255', name: 'Сибирь', surface: 'asphalt', paved: true });
    expect(parsed.places[1].point).toEqual({ lat: 52.2, lon: 104.0 });
  });

  it('rejects answers that are not an Overpass result', () => {
    expect(() => parseContextAnswer('<html>504 Gateway Timeout</html>')).toThrow(OverpassAnswerError);
    expect(() => parseContextAnswer(null)).toThrow(OverpassAnswerError);
    expect(() => parseContextAnswer([])).toThrow(OverpassAnswerError);
    expect(() => parseContextAnswer({ version: 0.6 })).toThrow(/elements/);
  });

  it('rejects a runtime error or timeout remark (partial data must not read as "nothing nearby")', () => {
    const remark = 'runtime error: Query timed out in "query" at line 2 after 61 seconds.';
    expect(() => parseContextAnswer({ elements: [], remark })).toThrow(/timed out/);
    expect(() => parseContextAnswer({ elements: fixture.elements, remark: 'runtime error: Query run out of memory' })).toThrow(OverpassAnswerError);
  });

  it('an empty result is a valid answer (nothing mapped nearby)', () => {
    expect(parseContextAnswer({ elements: [] })).toEqual({ roads: [], places: [], osmBase: null, skipped: 0 });
  });

  it('prefers name:ru for settlements and ignores a bad timestamp', () => {
    const p = parseContextAnswer({
      osm3s: { timestamp_osm_base: 'soon' },
      elements: [{ type: 'node', id: 5, lat: 52, lon: 104, tags: { place: 'town', name: 'Ust-Kut', 'name:ru': 'Усть-Кут' } }],
    });
    expect(p.places[0].name).toBe('Усть-Кут');
    expect(p.osmBase).toBeNull();
  });
});

describe('nearest road and settlement', () => {
  const parsed = parseContextAnswer(fixture);
  const ctx = buildContext(P, parsed, '2026-09-29T10:00:00.000Z');

  it('nearest road by distance to segments: the gravel tertiary 2 km east, not the track', () => {
    expect(ctx.nearest_road).toMatchObject({
      osm_id: 1001, osm_url: 'https://www.openstreetmap.org/way/1001', highway: 'tertiary', name: 'Ключевская',
      paved: false, direction: 'на восток',
    });
    expect(ctx.nearest_road!.distance_km).toBeCloseTo(2.0, 1);
    // its vertices are ~3 km away: vertex distances would have picked wrongly
    expect(Math.min(...parsed.roads[0].geometry.map(g => haversineKm(P, g)))).toBeGreaterThan(2.9);
  });

  it('nearest paved road: the primary without surface (by class) 6.1 km south beats the asphalt trunk 6.7 km north', () => {
    expect(ctx.nearest_paved_road).toMatchObject({ osm_id: 1003, ref: '25К-011', paved_by_class: true, direction: 'на юг', bearing_deg: 180 });
    expect(ctx.nearest_paved_road!.distance_km).toBeCloseTo(6.1, 1);
    const withoutPrimary = buildContext(P, { ...parsed, roads: parsed.roads.filter(r => r.osm_id !== 1003) }, 'x');
    expect(withoutPrimary.nearest_paved_road).toMatchObject({ osm_id: 1002, ref: 'Р-255', paved_by_class: false, direction: 'на север' });
    expect(withoutPrimary.nearest_paved_road!.distance_km).toBeCloseTo(6.7, 1);
  });

  it('nearest track separately (0.3 km west); footway and service are not roads', () => {
    expect(ctx.nearest_track).toMatchObject({ osm_id: 1004, highway: 'track', direction: 'на запад' });
    expect(ctx.nearest_track!.distance_km).toBeCloseTo(0.3, 1);
  });

  it('nearest settlement within the radius with direction in words; the town 17 km away is out', () => {
    expect(ctx.nearest_settlement).toMatchObject({
      osm_id: 2001, osm_type: 'node', osm_url: 'https://www.openstreetmap.org/node/2001', place: 'village', name: 'Ключи',
      direction: 'на северо-восток',
    });
    expect(ctx.nearest_settlement!.distance_km).toBeCloseTo(4.8, 1);
    const onlyTown = nearestSettlement(P, parsed.places.filter(p => p.place === 'town'));
    expect(onlyTown).toBeNull();
    expect(nearestSettlement(P, parsed.places.filter(p => p.place === 'town'), 20)).toMatchObject({ osm_url: 'https://www.openstreetmap.org/relation/3001' });
    expect(nearestSettlement(P, parsed.places.filter(p => p.place === 'hamlet'))).toMatchObject({ name: null, direction: 'на северо-запад' });
  });

  it('carries the data date, source, licence and the approximate note', () => {
    expect(ctx).toMatchObject({
      point: P, radius_km: RADIUS_KM, data_date: '2026-09-28T21:14:03Z', fetched_at: '2026-09-29T10:00:00.000Z',
      license: CONTEXT_LICENSE,
    });
    expect(ctx.license).toMatch(/ODbL/);
    expect(ctx.note).toMatch(/по OSM, приблизительно/);
    expect(buildContext(P, { ...parsed, osmBase: null }, '2026-09-29T10:00:00.000Z').data_date).toBe('2026-09-29T10:00:00.000Z');
  });

  it('nothing within the radius → nulls, never a made-up value', () => {
    const empty = buildContext(P, { roads: [], places: [], osmBase: null, skipped: 0 }, 'x');
    expect([empty.nearest_road, empty.nearest_paved_road, empty.nearest_track, empty.nearest_settlement]).toEqual([null, null, null, null]);
    const far: OsmRoad = { ...parsed.roads[1], geometry: [{ lat: 52.5, lon: 104.0 }, { lat: 52.5, lon: 104.4 }] };
    expect(nearestRoad(P, [far])).toBeNull();
  });

  it('ties go to the first road; bearings are integers in [0, 360)', () => {
    const r = nearestRoad(P, [parsed.roads[0], { ...parsed.roads[0], osm_id: 9 }])!;
    expect(r.osm_id).toBe(1001);
    expect(Number.isInteger(r.bearing_deg)).toBe(true);
    const north = nearestRoad(P, [{ ...parsed.roads[1], geometry: [{ lat: 52.35, lon: 104.1999 }, { lat: 52.35, lon: 104.1999 }] }])!;
    expect(north.bearing_deg).toBeGreaterThanOrEqual(0);
    expect(north.bearing_deg).toBeLessThan(360);
    expect(north.direction).toBe('на север');
  });
});

describe('cache key', () => {
  it('rounds the centre to 3 decimals and carries a version', () => {
    expect(contextPoint({ lat: 52.30049, lon: 104.19951 })).toEqual({ lat: 52.3, lon: 104.2 });
    expect(contextCacheKey({ lat: 52.30049, lon: 104.19951 })).toBe('incident:context:v1:15:52.300:104.200');
    expect(contextCacheKey({ lat: 52.3006, lon: 104.2 })).toBe('incident:context:v1:15:52.301:104.200');
    expect(contextCacheKey({ lat: 66.0, lon: -179.9996 })).toBe('incident:context:v1:15:66.000:-180.000');
    expect(CONTEXT_TTL_SEC).toBe(7 * 24 * 3600);
  });
});
