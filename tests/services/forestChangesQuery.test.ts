import {
  buildForestChangesQuery,
  forestChangesCacheKey,
  DEFAULT_SORT,
  MAX_LIMIT,
} from '../../backend/services/forestChangesQuery';

describe('buildForestChangesQuery', () => {
  it('defaults to date_desc, limit 12, offset 0 with no filters', () => {
    const built = buildForestChangesQuery({});
    expect(built.sort).toBe(DEFAULT_SORT);
    expect(built.orderBy).toBe('fc.detected_date DESC');
    expect(built.limit).toBe(12);
    expect(built.offset).toBe(0);
    expect(built.where).toBe(' WHERE 1=1');
    expect(built.params).toEqual([]);
  });

  it('only accepts whitelisted sort keys, falling back to the default for anything else', () => {
    expect(buildForestChangesQuery({ sort: 'area_asc' }).orderBy).toBe('fc.area_ha ASC NULLS LAST');
    expect(buildForestChangesQuery({ sort: 'area_desc' }).orderBy).toBe('fc.area_ha DESC NULLS LAST');
    expect(buildForestChangesQuery({ sort: 'date_asc' }).orderBy).toBe('fc.detected_date ASC');
    expect(buildForestChangesQuery({ sort: 'bogus' }).orderBy).toBe('fc.detected_date DESC');
    // A SQL-injection attempt through `sort` never reaches the query string.
    const built = buildForestChangesQuery({ sort: "date_desc; DROP TABLE gis.forest_changes;--" });
    expect(built.orderBy).toBe('fc.detected_date DESC');
    expect(built.dataQuery).not.toContain('DROP TABLE');
  });

  it('clamps limit to [1, 100] and rounds down', () => {
    expect(buildForestChangesQuery({ limit: '0' }).limit).toBe(1);
    expect(buildForestChangesQuery({ limit: '-5' }).limit).toBe(1);
    expect(buildForestChangesQuery({ limit: '5.9' }).limit).toBe(5);
    expect(buildForestChangesQuery({ limit: '9999' }).limit).toBe(MAX_LIMIT);
    expect(buildForestChangesQuery({ limit: 'nan' }).limit).toBe(12);
    expect(buildForestChangesQuery({}).limit).toBe(12);
  });

  it('rejects negative or non-numeric offsets, defaulting to 0', () => {
    expect(buildForestChangesQuery({ offset: '-10' }).offset).toBe(0);
    expect(buildForestChangesQuery({ offset: 'nan' }).offset).toBe(0);
    expect(buildForestChangesQuery({ offset: '30.7' }).offset).toBe(30);
    expect(buildForestChangesQuery({ offset: '30' }).offset).toBe(30);
  });

  it('parameterizes every filter value instead of interpolating it into the SQL text', () => {
    const injection = "fire'; DROP TABLE gis.forest_changes; --";
    const built = buildForestChangesQuery({ change_type: injection, region: 'Иркутская область' });
    expect(built.dataQuery).not.toContain('DROP TABLE');
    expect(built.dataQuery).not.toContain(injection);
    expect(built.params).toEqual([injection, 'Иркутская область']);
    expect(built.dataQuery).toContain('fc.change_type = $1');
    expect(built.dataQuery).toContain('fa.region = $2');
  });

  it('appends limit/offset placeholders after the filter params', () => {
    const built = buildForestChangesQuery({ change_type: 'fire', limit: '5', offset: '10' });
    expect(built.dataParams).toEqual(['fire', 5, 10]);
    expect(built.dataQuery).toMatch(/LIMIT \$2 OFFSET \$3$/);
    expect(built.countQuery).not.toMatch(/LIMIT|OFFSET/);
  });

  it('produces non-overlapping, gap-free pages for a fixed limit', () => {
    const limit = 12;
    for (let page = 1; page <= 5; page++) {
      const offset = (page - 1) * limit;
      const built = buildForestChangesQuery({ limit: String(limit), offset: String(offset) });
      expect(built.offset).toBe(offset);
      expect(built.limit).toBe(limit);
    }
  });

  it('ignores unknown/empty filter values', () => {
    const built = buildForestChangesQuery({ change_type: '', region: undefined, severity: '   ' });
    expect(built.where).toBe(' WHERE 1=1');
    expect(built.params).toEqual([]);
  });
});

describe('forestChangesCacheKey', () => {
  it('is stable for equivalent queries regardless of key order', () => {
    const a = forestChangesCacheKey({ change_type: 'fire', region: 'Бурятия', sort: 'date_desc' });
    const b = forestChangesCacheKey({ region: 'Бурятия', change_type: 'fire', sort: 'date_desc' });
    expect(a).toBe(b);
  });

  it('differs when filters differ', () => {
    const a = forestChangesCacheKey({ change_type: 'fire' });
    const b = forestChangesCacheKey({ change_type: 'logging' });
    expect(a).not.toBe(b);
  });

  it('differs across sort/limit/offset even with identical filters', () => {
    const base = { change_type: 'fire' };
    const keys = new Set([
      forestChangesCacheKey({ ...base, sort: 'date_desc' }),
      forestChangesCacheKey({ ...base, sort: 'area_asc' }),
      forestChangesCacheKey({ ...base, limit: '5' }),
      forestChangesCacheKey({ ...base, offset: '5' }),
    ]);
    expect(keys.size).toBe(4);
  });

  it('does not collide between different filter fields holding the same value', () => {
    const a = forestChangesCacheKey({ change_type: 'fire' });
    const b = forestChangesCacheKey({ severity: 'fire' });
    expect(a).not.toBe(b);
  });
});
