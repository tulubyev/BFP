/**
 * SQL guard (spec 2026-09-27-security-hardening, §1): no request value may be interpolated into SQL
 * text anywhere in backend/. Values go as `$n` placeholders; numbers through clamping parsers
 * (utils/queryParams.ts); sort keys and other enumerations through fixed whitelists.
 *
 * A new `${…}` in SQL fails this test. If it really is a constant or a whitelisted fragment, add it
 * to ALLOWLIST below with the reason — never a value that comes from a request.
 */
import path from 'path';
import { scanDirectory, scanSource, type Allowlist } from './sqlGuard';

const ROOT = path.resolve(__dirname, '../..');

export const ALLOWLIST: Allowlist = {
  // Map layer GeoJSON reuses the feed's query builder: WHERE with placeholders, constant columns
  'backend/services/forestChangesGeojson.ts': ['GEOJSON_COLUMNS', 'REGION_EXPR', 'FOREST_CHANGES_FROM', 'built.where'],
  // Export reuses the feed's query builder: WHERE with placeholders, ORDER BY from the sort whitelist
  'backend/services/export/incidentsExport.ts': ['REGION_EXPR', 'FOREST_CHANGES_FROM', 'built.where', 'built.orderBy'],
  // Constant column lists, placeholders computed from row/column indexes
  'backend/services/firmsHistory/hotspotRows.ts': ['columns', 'values', 'keyMatch', "OBSERVATION_KEY.join(', ')"],
  'backend/services/firmsHistory/store.ts': [
    "INCIDENT_COLUMNS.join(', ')",
    "INCIDENT_COLUMNS.map((c, i) => `$${i + 1}${c === 'metadata' ? '::jsonb' : ''}`).join(', ')",
    "INCIDENT_COLUMNS.map((c, i) => `${c} = $${i + 2}${c === 'metadata' ? '::jsonb' : ''}`).join(', ')",
    'INCIDENT_METHOD', // 'firms-cluster-v1'
    'STATIC_SOURCE_STATUS', // 'static_source'
    'HOTSPOT_SELECT',
  ],
  // Constant fragments; `where` holds only placeholders, `orderBy` comes from FOREST_CHANGES_SORT_COLUMNS
  'backend/services/forestChangesQuery.ts': ['notStaticSourceSql()', 'REGION_EXPR', 'from', 'where', 'orderBy'],
  // SQL sent to the GFW Data API (not our database): adm1 from RUSSIAN_FOREST_REGIONS, years from
  // parseYear(); fetchAdm1LossFromGFW() rejects non-integers
  'backend/services/globalForestWatch.ts': ['adm1', 'startYear', 'endYear'],
};

describe('SQL guard: backend sources', () => {
  const result = scanDirectory(ROOT, path.join(ROOT, 'backend'), ALLOWLIST);

  it('interpolates nothing but placeholders and allowlisted constants into SQL', () => {
    const report = result.findings.map(f => `${f.file}:${f.line}  \${${f.expression}}`);
    expect(report).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const stale = Object.entries(ALLOWLIST)
      .flatMap(([file, exprs]) => exprs.map(e => `${file}: ${e}`))
      .filter(entry => !result.used.has(entry));
    expect(stale).toEqual([]);
  });
});

describe('SQL guard: scanner', () => {
  const scan = (code: string, allow: string[] = []) =>
    scanSource('x.ts', code, { 'x.ts': allow }).findings.map(f => f.expression);

  it('catches the ?days= injection fixed in 22e82b7', () => {
    const code = "pool.query(`SELECT * FROM gis.fire_hotspots WHERE acquisition_date >= CURRENT_DATE - INTERVAL '${days} days'`);";
    expect(scan(code)).toEqual(['days']);
  });

  it('catches table names and request values in templates and concatenations', () => {
    expect(scan('pool.query(`SELECT * FROM gis.${table} ORDER BY id`);')).toEqual(['table']);
    expect(scan("query += ' AND source = ' + req.query.source;")).toEqual(['req.query.source']);
    expect(scan("const q = 'SELECT * FROM t WHERE a = ' + a + ' LIMIT ' + String(limit);")).toEqual(['a', 'String(limit)']);
    expect(scan('const q = `SELECT 1` + ` WHERE a = ${a}`;')).toEqual(['a']);
    expect(scan('const q = `UPDATE t SET name = \'${name}\' WHERE id = $1`;')).toEqual(['name']);
  });

  it('accepts placeholders, allowlisted constants and non-SQL text', () => {
    expect(scan('query += ` AND region = $${paramIndex++}`;')).toEqual([]);
    expect(scan('const q = `SELECT * FROM t LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;')).toEqual([]);
    expect(scan('const q = `SELECT ${REGION_EXPR} FROM t`;', ['REGION_EXPR'])).toEqual([]);
    expect(scan("const msg = `Под фильтры попадает ${total} записей`;")).toEqual([]);
    expect(scan("const msg = `select a region: ${name}`;")).toEqual([]);
    expect(scan("const q = 'SELECT 1' + ' FROM t';")).toEqual([]);
  });

  it('does not treat a value after `$` as a placeholder unless it is arithmetic', () => {
    expect(scan('const q = `SELECT * FROM t WHERE a = $${req.query.n}`;')).toEqual(['req.query.n']);
    expect(scan('const q = `SELECT * FROM t WHERE a = $${String(n)}`;')).toEqual(['String(n)']);
  });
});
