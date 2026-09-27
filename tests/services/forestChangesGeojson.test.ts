import {
  GEOJSON_LIMIT,
  buildForestChangesGeojsonQuery,
  parseIsoDate,
  rowBbox,
  toGeojsonFeature,
} from '../../backend/services/forestChangesGeojson';
import { buildForestChangesQuery } from '../../backend/services/forestChangesQuery';

describe('parseIsoDate', () => {
  it('accepts real YYYY-MM-DD dates only', () => {
    expect(parseIsoDate('2026-08-28')).toBe('2026-08-28');
    expect(parseIsoDate([' 2026-08-28 ', 'x'])).toBe('2026-08-28');
    for (const bad of ['2026-02-30', '2026-13-01', '28.08.2026', "2026-08-28' OR 1=1--", '', 20260828, undefined, null]) {
      expect(parseIsoDate(bad)).toBeUndefined();
    }
  });
});

describe('buildForestChangesGeojsonQuery', () => {
  it('hides static heat sources by default, like the feed', () => {
    const { sql, params, filters } = buildForestChangesGeojsonQuery({});
    expect(sql).toContain("COALESCE(fc.metadata->>'status', '') <> 'static_source'");
    expect(filters).toEqual({ static_sources: 'exclude' });
    expect(params).toEqual([GEOJSON_LIMIT]);
    expect(sql).toMatch(/ORDER BY fc\.detected_date DESC, fc\.id DESC LIMIT \$1$/);
  });

  it('static_sources=include / only use the feed whitelist; junk falls back to exclude', () => {
    expect(buildForestChangesGeojsonQuery({ static_sources: 'include' }).sql).not.toContain('static_source');
    expect(buildForestChangesGeojsonQuery({ static_sources: 'only' }).sql).toContain("fc.metadata->>'status' = 'static_source'");
    const junk = buildForestChangesGeojsonQuery({ static_sources: "include' OR '1'='1" });
    expect(junk.filters.static_sources).toBe('exclude');
    expect(junk.sql).not.toContain("'1'='1");
  });

  it('start_date and change_type travel as placeholders', () => {
    const { sql, params, filters } = buildForestChangesGeojsonQuery({ change_type: 'fire', start_date: '2026-08-28' });
    expect(sql).toContain('fc.change_type = $1');
    expect(sql).toContain('fc.detected_date >= $2');
    expect(sql).toContain('LIMIT $3');
    expect(params).toEqual(['fire', '2026-08-28', GEOJSON_LIMIT]);
    expect(filters).toMatchObject({ change_type: 'fire', start_date: '2026-08-28' });
  });

  it('drops an invalid start_date instead of sending it to SQL', () => {
    const { sql, params } = buildForestChangesGeojsonQuery({ start_date: "2026-01-01'; DROP TABLE x;--" });
    expect(sql).not.toContain('detected_date >=');
    expect(sql).not.toContain('DROP');
    expect(params).toEqual([GEOJSON_LIMIT]);
  });

  it('shares WHERE and params with the feed builder', () => {
    const query = { change_type: 'fire', region: 'Иркутская область', start_date: '2026-08-28', end_date: '2026-09-27', static_sources: 'include' };
    const feed = buildForestChangesQuery(query);
    const layer = buildForestChangesGeojsonQuery(query);
    expect(layer.sql).toContain(feed.where);
    expect(layer.params).toEqual([...feed.params, GEOJSON_LIMIT]);
  });

  it('ignores the feed pagination and sort', () => {
    const { sql, params } = buildForestChangesGeojsonQuery({ sort: 'area_asc', limit: '5', offset: '10' } as any);
    expect(sql).not.toContain('area_ha ASC');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([GEOJSON_LIMIT]);
  });
});

describe('toGeojsonFeature', () => {
  const row = {
    id: 42, change_type: 'fire', severity: 'medium', detected_date: '2026-09-20', area_ha: '28.12', confidence: '0.75',
    source: 'firms', satellite: 'N21', center_lat: '52.275', center_lng: '104.2',
    bbox_min_lat: '52.2', bbox_min_lng: '104.1', bbox_max_lat: '52.35', bbox_max_lng: '104.3', geojson: null,
    method: 'firms-cluster-v1', status: 'active', hotspot_count: '17',
    first_seen: '2026-09-20T04:28:00Z', last_seen: '2026-09-25T18:05:00Z', region: 'Иркутская область',
  };

  it('centre point geometry plus the layer fields', () => {
    const f = toGeojsonFeature(row);
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [104.2, 52.275] });
    expect(f.properties).toMatchObject({
      id: 42, region: 'Иркутская область', method: 'firms-cluster-v1', status: 'active', hotspot_count: 17,
      first_seen: '2026-09-20T04:28:00Z', last_seen: '2026-09-25T18:05:00Z', bbox: [104.1, 52.2, 104.3, 52.35],
    });
  });

  it('keeps a stored GeoJSON geometry; a broken one falls back to the centre', () => {
    expect(toGeojsonFeature({ ...row, geojson: '{"type":"Polygon","coordinates":[]}' }).geometry.type).toBe('Polygon');
    expect(toGeojsonFeature({ ...row, geojson: '{oops' }).geometry.type).toBe('Point');
  });

  it('rowBbox needs four valid numbers in order', () => {
    expect(rowBbox({ ...row, bbox_min_lat: null })).toBeNull();
    expect(rowBbox({ ...row, bbox_min_lng: '105' })).toBeNull();
    expect(toGeojsonFeature({ ...row, hotspot_count: null, method: undefined }).properties).toMatchObject({ hotspot_count: null, method: null });
  });
});
