import {
  buildForestChangesQuery,
  forestChangesCacheKey,
  DEFAULT_SORT,
  MAX_LIMIT,
  notStaticSourceSql,
  parseIsoDate,
  FOREST_CHANGES_SORT_COLUMNS,
} from '../../backend/services/forestChangesQuery';

describe('buildForestChangesQuery', () => {
  it('defaults to date_desc, limit 12, offset 0 with no filters', () => {
    const built = buildForestChangesQuery({});
    expect(built.sort).toBe(DEFAULT_SORT);
    expect(built.orderBy).toBe('fc.detected_date DESC');
    expect(built.limit).toBe(12);
    expect(built.offset).toBe(0);
    expect(built.where).toBe(" WHERE 1=1 AND COALESCE(fc.metadata->>'status', '') <> 'static_source'");
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
    expect(built.dataQuery).toContain("COALESCE(fa.region, fc.metadata->>'region') = $2");
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
    expect(built.where).toBe(buildForestChangesQuery({}).where);
    expect(built.params).toEqual([]);
  });
});

describe('static heat sources (FIRMS gas flares)', () => {
  it('hides incidents with metadata.status static_source by default, in data and count queries', () => {
    const built = buildForestChangesQuery({});
    expect(built.filters.static_sources).toBe('exclude');
    expect(built.dataQuery).toContain("COALESCE(fc.metadata->>'status', '') <> 'static_source'");
    expect(built.countQuery).toContain("COALESCE(fc.metadata->>'status', '') <> 'static_source'");
  });

  it('shows them with static_sources=include and only them with static_sources=only', () => {
    const include = buildForestChangesQuery({ static_sources: 'include' });
    expect(include.where).toBe(' WHERE 1=1');
    const only = buildForestChangesQuery({ static_sources: 'only', change_type: 'fire' });
    expect(only.where).toContain("fc.metadata->>'status' = 'static_source'");
    expect(only.params).toEqual(['fire']);
  });

  it('falls back to hiding them for unknown values, never interpolating the value', () => {
    const built = buildForestChangesQuery({ static_sources: "include' OR 1=1 --" });
    expect(built.filters.static_sources).toBe('exclude');
    expect(built.dataQuery).not.toContain('OR 1=1');
  });

  it('keeps separate cache entries per mode', () => {
    const keys = new Set(['exclude', 'include', 'only'].map(m => forestChangesCacheKey({ static_sources: m })));
    expect(keys.size).toBe(3);
    expect(forestChangesCacheKey({})).toBe(forestChangesCacheKey({ static_sources: 'exclude' }));
    expect(forestChangesCacheKey({})).toContain('static_sources=exclude');
  });

  it('builds the same condition for the GeoJSON route (table alias)', () => {
    expect(notStaticSourceSql('forest_changes')).toBe("COALESCE(forest_changes.metadata->>'status', '') <> 'static_source'");
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

describe('region of FIRMS incidents', () => {
  it('falls back to metadata.region when the incident has no forest area', () => {
    const built = buildForestChangesQuery({});
    expect(built.dataQuery).toContain("COALESCE(fa.region, fc.metadata->>'region') AS region");
  });
});

describe('incidents v2 filters (spec 2026-09-27-incidents-v2, part K)', () => {
  it('sorts by confidence with NULLS LAST and a date tie-break, from the whitelist', () => {
    expect(buildForestChangesQuery({ sort: 'confidence_desc' }).orderBy).toBe('fc.confidence DESC NULLS LAST, fc.detected_date DESC');
    expect(buildForestChangesQuery({ sort: 'confidence_asc' }).orderBy).toBe('fc.confidence ASC NULLS LAST, fc.detected_date DESC');
    expect(Object.keys(FOREST_CHANGES_SORT_COLUMNS)).toEqual(
      ['date_desc', 'date_asc', 'area_desc', 'area_asc', 'confidence_desc', 'confidence_asc'],
    );
    expect(buildForestChangesQuery({ sort: 'confidence' }).sort).toBe('date_desc');
  });

  it('filters the FIRMS status through a whitelist, as a placeholder', () => {
    const active = buildForestChangesQuery({ status: 'active' });
    expect(active.where).toContain("fc.metadata->>'status' = $1");
    expect(active.params).toEqual(['active']);
    expect(active.filters.status).toBe('active');
    expect(buildForestChangesQuery({ status: 'inactive' }).params).toEqual(['inactive']);
    for (const bad of ['static_source', 'ACTIVE', "active' OR '1'='1", ['x', 'active']]) {
      const built = buildForestChangesQuery({ status: bad });
      expect(built.params).toEqual([]);
      expect(built.filters.status).toBeUndefined();
      expect(built.dataQuery).not.toContain("'1'='1");
    }
    // first value of a repeated parameter, like the other filters
    expect(buildForestChangesQuery({ status: ['inactive', 'active'] }).params).toEqual(['inactive']);
  });

  it('filters the source as a placeholder, accepting only plain source names', () => {
    const built = buildForestChangesQuery({ source: 'firms' });
    expect(built.where).toContain('fc.source = $1');
    expect(built.params).toEqual(['firms']);
    expect(buildForestChangesQuery({ source: 'Sentinel-2 L2A' }).params).toEqual(['Sentinel-2 L2A']);
    const injection = buildForestChangesQuery({ source: "firms'; DROP TABLE gis.forest_changes; --" });
    expect(injection.params).toEqual([]);
    expect(injection.dataQuery).not.toContain('DROP');
    expect(buildForestChangesQuery({ source: 'x'.repeat(51) }).params).toEqual([]);
  });

  it('accepts only real YYYY-MM-DD dates for the period', () => {
    expect(parseIsoDate('2026-09-01')).toBe('2026-09-01');
    expect(parseIsoDate(['2026-02-28', 'x'])).toBe('2026-02-28');
    for (const bad of ['2026-02-30', '2026-9-1', '01.09.2026', "2026-09-01' OR 1=1", '', undefined, 20260901]) {
      expect(parseIsoDate(bad)).toBeUndefined();
    }
    const built = buildForestChangesQuery({ start_date: '2026-09-01', end_date: 'yesterday' });
    expect(built.params).toEqual(['2026-09-01']);
    expect(built.filters).toEqual({ static_sources: 'exclude', start_date: '2026-09-01' });
  });

  it('opens one incident by id (int4 range only)', () => {
    const built = buildForestChangesQuery({ id: '42', static_sources: 'include' });
    expect(built.where).toBe(' WHERE 1=1 AND fc.id = $1');
    expect(built.params).toEqual([42]);
    for (const bad of ['0', '-1', '1.5', '2147483648', '42 OR 1=1', 'abc']) {
      expect(buildForestChangesQuery({ id: bad }).params).toEqual([]);
    }
    expect(buildForestChangesQuery({ id: '2147483647' }).params).toEqual([2147483647]);
  });

  it('numbers placeholders in order with all filters combined', () => {
    const built = buildForestChangesQuery({
      id: '7', change_type: 'fire', severity: 'high', region: 'Бурятия', status: 'active', source: 'firms',
      start_date: '2026-09-01', end_date: '2026-09-27', limit: '5', offset: '10', sort: 'confidence_desc',
    });
    expect(built.params).toEqual([7, 'fire', 'high', 'Бурятия', 'active', 'firms', '2026-09-01', '2026-09-27']);
    const placeholders = [...built.where.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
    expect(placeholders).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(built.dataParams).toEqual([...built.params, 5, 10]);
    expect(built.dataQuery).toMatch(/ORDER BY fc\.confidence DESC NULLS LAST, fc\.detected_date DESC LIMIT \$9 OFFSET \$10$/);
  });

  it('keeps a separate cache entry per new filter value, under the v2 key', () => {
    const keys = [
      {}, { status: 'active' }, { status: 'inactive' }, { source: 'firms' }, { source: 'gfw' },
      { start_date: '2026-09-01' }, { end_date: '2026-09-01' }, { sort: 'confidence_desc' }, { sort: 'confidence_asc' }, { id: '5' },
    ].map(q => forestChangesCacheKey(q));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(k => k.startsWith('incidents:forest-changes:v2:'))).toBe(true);
    // ignored values do not create entries of their own
    expect(forestChangesCacheKey({ status: 'bogus', start_date: 'nope' })).toBe(forestChangesCacheKey({}));
    expect(forestChangesCacheKey({ status: 'active', source: 'firms' })).toBe(forestChangesCacheKey({ source: 'firms', status: 'active' }));
  });
});
