import { CSV_BOM, csvCell, toCsv } from '../../backend/services/export/csv';
import {
  buildIncidentsExportQuery, buildIncidentsMetadata, dateOnly, fetchIncidentsForExport, incidentGeometry, INCIDENT_COLUMNS,
  incidentsToCsv, incidentsToGeoJson, incidentsToJson, incidentUrl, toIncidentExportRow,
} from '../../backend/services/export/incidentsExport';
import {
  asciiJson, EXPORT_LIMIT, exportDate, FIRMS_INCIDENTS_WARNING, loadSourceProvenance, METHODOLOGY_URL,
} from '../../backend/services/export/provenance';
import { buildRegionsMetadata, regionsToCsv, regionsToJson, REGION_COLUMNS, toRegionRows } from '../../backend/services/export/regionsExport';
import { buildForestChangesQuery } from '../../backend/services/forestChangesQuery';
import { INCIDENT_METHOD, WINDOW_HOURS } from '../../backend/services/firmsHistory/incidents';
import { CLUSTER_DISTANCE_KM } from '../../backend/services/firmsHistory/clusters';
import { STATIC_MASK_METHOD, STATIC_MIN_DAYS } from '../../backend/services/firmsHistory/staticSources';
import type { RegionsListResponse } from '../../backend/services/regions/service';

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF) — to check the files round-trip. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const firmsRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  change_type: 'fire',
  severity: 'medium',
  detected_date: new Date(2026, 8, 26), // node-postgres: DATE → local midnight
  area_ha: '28.12',
  confidence: '0.50',
  source: 'firms',
  satellite: 'N,N20',
  center_lat: '52.123456',
  center_lng: '104.654321',
  bbox_min_lat: '52.1',
  bbox_min_lng: '104.6',
  bbox_max_lat: '52.15',
  bbox_max_lng: '104.7',
  region: 'Иркутская область',
  metadata: {
    method: INCIDENT_METHOD, status: 'active', region: 'Иркутская область', region_iso: 'RU-IRK',
    hotspot_count: 3, frp_max: 12.4, first_seen: '2026-09-25T18:30:00.000Z', last_seen: '2026-09-26T04:12:00.000Z',
  },
  ...overrides,
});

describe('CSV serialization', () => {
  it('starts with a UTF-8 BOM and uses CRLF line endings', () => {
    const csv = toCsv(['a', 'b'] as const, [{ a: 'x', b: 1 }]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}a,b\r\nx,1\r\n`);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('quotes commas, quotes and line breaks per RFC 4180', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('plain text')).toBe('plain text');
    const parsed = parseCsv(toCsv(['v'] as const, [{ v: 'a,"b"\r\nc' }]).slice(1));
    expect(parsed).toEqual([['v'], ['a,"b"\r\nc']]);
  });

  it('escapes formula-looking text against CSV injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+7 999')).toBe("'+7 999");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe(`"'\rx"`);
  });

  it('keeps numbers as numbers — negative values are not escaped', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(0)).toBe('0');
  });

  it('writes null, undefined and NaN as an empty cell, never 0', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(toCsv(['a', 'b', 'c'] as const, [{ a: null, b: 0 }])).toBe(`${CSV_BOM}a,b,c\r\n,0,\r\n`);
  });
});

describe('incidents export query', () => {
  it('reuses the feed WHERE clause and params, with no pagination', () => {
    const raw = { change_type: 'fire', region: 'Иркутская область', start_date: '2026-09-01', end_date: '2026-09-30', sort: 'area_desc', static_sources: 'include', limit: '3', offset: '9' };
    const feed = buildForestChangesQuery(raw);
    const q = buildIncidentsExportQuery(raw);
    expect(q.dataQuery).toContain(feed.where);
    expect(q.params).toEqual(feed.params);
    expect(q.params).toEqual(['fire', 'Иркутская область', '2026-09-01', '2026-09-30']);
    expect(q.dataParams).toEqual([...feed.params, EXPORT_LIMIT + 1]);
    expect(q.dataQuery).toMatch(/ORDER BY fc\.area_ha DESC NULLS LAST, fc\.id DESC LIMIT \$5$/);
    expect(q.dataQuery).not.toContain('OFFSET');
    expect(q.countQuery).toBe(feed.countQuery);
    expect(q.filters).toEqual({ ...feed.filters, sort: 'area_desc' });
  });

  it('hides static sources by default, like the feed', () => {
    const q = buildIncidentsExportQuery({});
    expect(q.dataQuery).toContain("<> 'static_source'");
    expect(q.filters).toEqual({ static_sources: 'exclude', sort: 'date_desc' });
  });

  it('never interpolates the sort key', () => {
    const q = buildIncidentsExportQuery({ sort: 'date_desc; DROP TABLE gis.forest_changes' });
    expect(q.dataQuery).not.toContain('DROP');
  });
});

describe('fetchIncidentsForExport', () => {
  it('returns the rows when they fit', async () => {
    const query = jest.fn(async () => ({ rows: [firmsRow()] }));
    const result = await fetchIncidentsForExport({ query }, { region: 'Иркутская область' });
    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect((query.mock.calls[0] as any[])[1]).toEqual(['Иркутская область', EXPORT_LIMIT + 1]);
  });

  it('reports tooMany with the total instead of truncating', async () => {
    const query = jest.fn(async (text: string) => (text.startsWith('SELECT COUNT')
      ? { rows: [{ count: 7 }] }
      : { rows: Array.from({ length: 4 }, (_, i) => firmsRow({ id: i })) }));
    const result = await fetchIncidentsForExport({ query }, {}, 3);
    expect(result).toEqual({ ok: false, tooMany: true, total: 7, filters: { static_sources: 'exclude', sort: 'date_desc' } });
  });
});

describe('toIncidentExportRow', () => {
  it('maps a FIRMS incident to the flat export record', () => {
    const row = toIncidentExportRow(firmsRow());
    expect(Object.keys(row)).toEqual([...INCIDENT_COLUMNS]);
    expect(row).toMatchObject({
      id: 42, change_type: 'fire', status: 'active', region: 'Иркутская область', region_iso: 'RU-IRK',
      detected_date: '2026-09-26', first_seen: '2026-09-25T18:30:00.000Z', last_seen: '2026-09-26T04:12:00.000Z',
      center_lat: 52.123456, center_lon: 104.654321, bbox_min_lat: 52.1, bbox_max_lon: 104.7,
      area_ha: 28.12, area_note: 'оценка сверху, пиксели 375 м', hotspot_count: 3, frp_max: 12.4,
      satellites: 'N,N20', confidence: 0.5, source: 'firms', method: INCIDENT_METHOD,
      license: 'Открытые данные NASA (без ограничений)',
      url: 'https://forestwatch.ru/?lat=52.123456&lng=104.654321&incident=42',
    });
  });

  it('keeps missing values null and leaves the FIRMS area note off other incidents', () => {
    const row = toIncidentExportRow({ id: 5, change_type: 'logging', detected_date: '2026-01-02', metadata: null, area_ha: null });
    expect(row.area_ha).toBeNull();
    expect(row.area_note).toBeNull();
    expect(row.status).toBeNull();
    expect(row.frp_max).toBeNull();
    expect(row.license).toBeNull();
    expect(row.detected_date).toBe('2026-01-02');
    expect(row.url).toBe('https://forestwatch.ru/incidents?id=5');
  });

  it('carries static_source status', () => {
    const row = toIncidentExportRow(firmsRow({ metadata: { method: INCIDENT_METHOD, status: 'static_source' } }));
    expect(row.status).toBe('static_source');
  });

  it('formats dates', () => {
    expect(dateOnly(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateOnly('2026-02-03T00:00:00Z')).toBe('2026-02-03');
    expect(dateOnly(null)).toBeNull();
    expect(incidentUrl(1, null, 3)).toBe('https://forestwatch.ru/incidents?id=1');
  });
});

const sources = [{ id: 'firms' as const, name: 'FIRMS', owner: 'NASA', license: { name: 'open', url: 'u' }, homepage: 'h', lastSuccessfulLoad: '2026-09-27T10:00:05Z', lastSuccessfulHistoryWrite: '2026-09-27T10:00:09Z' }];
const incidentsMeta = () => buildIncidentsMetadata({
  generatedAt: '2026-09-27T12:00:00.000Z', filters: { static_sources: 'exclude', sort: 'date_desc' }, count: 1, sources, archiveCellsVersion: 2024,
});

describe('incidents metadata', () => {
  it('carries date, filters, sources, method versions, methodology and the warning', () => {
    const m = incidentsMeta();
    expect(m.generatedAt).toBe('2026-09-27T12:00:00.000Z');
    expect(m.filters).toEqual({ static_sources: 'exclude', sort: 'date_desc' });
    expect(m.limit).toBe(5000);
    expect(m.sources).toBe(sources);
    expect(m.methods.firmsIncidents).toMatchObject({ id: INCIDENT_METHOD, clusterDistanceKm: CLUSTER_DISTANCE_KM, windowHours: WINDOW_HOURS });
    expect(m.methods.firmsIncidents.regions).toEqual(['RU-IRK', 'RU-BU', 'RU-ZAB']);
    expect(m.methods.staticMask).toMatchObject({ id: STATIC_MASK_METHOD, minDays: STATIC_MIN_DAYS, archiveCellsVersion: 2024 });
    expect(m.methodology).toBe(METHODOLOGY_URL);
    expect(m.methodology).toBe('https://forestwatch.ru/methodology');
    expect(m.warnings[0]).toBe(FIRMS_INCIDENTS_WARNING);
    expect(m.warnings[0]).toContain('кластеры термоточек, не подтверждённые пожары');
  });

  it('fits in an ASCII header that parses back to the same object', () => {
    const m = incidentsMeta();
    const header = asciiJson(m);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(header)).toEqual(m);
    expect(header.length).toBeLessThan(8192);
    expect(exportDate(m.generatedAt)).toBe('2026-09-27');
  });
});

describe('incidents formats', () => {
  const rows = [toIncidentExportRow(firmsRow()), toIncidentExportRow(firmsRow({ id: 43, bbox_min_lat: null, region: '=cmd' }))];

  it('CSV has the columns, provenance in every row and escaped text', () => {
    const csv = incidentsToCsv(rows);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed[0]).toEqual([...INCIDENT_COLUMNS]);
    expect(parsed).toHaveLength(3);
    const col = (name: string) => parsed[0].indexOf(name);
    for (const line of parsed.slice(1)) {
      expect(line[col('source')]).toBe('firms');
      expect(line[col('method')]).toBe(INCIDENT_METHOD);
      expect(line[col('license')]).toBe('Открытые данные NASA (без ограничений)');
    }
    expect(parsed[2][col('region')]).toBe("'=cmd");
    expect(parsed[2][col('bbox_min_lat')]).toBe('');
  });

  it('JSON is { metadata, data }', () => {
    const m = incidentsMeta();
    expect(incidentsToJson(m, rows)).toEqual({ metadata: m, data: rows });
  });

  it('GeoJSON: bbox → polygon, no bbox → centre point, metadata as a foreign member', () => {
    const m = incidentsMeta();
    const fc = incidentsToGeoJson(m, rows);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.metadata).toBe(m);
    expect(fc.features[0].geometry).toEqual({
      type: 'Polygon', coordinates: [[[104.6, 52.1], [104.7, 52.1], [104.7, 52.15], [104.6, 52.15], [104.6, 52.1]]],
    });
    expect(fc.features[1].geometry).toEqual({ type: 'Point', coordinates: [104.654321, 52.123456] });
    expect(fc.features[0].properties.id).toBe(42);
    expect(fc.features[0].id).toBe(42);
  });

  it('uses the point for a zero-area bbox and null geometry without any location', () => {
    const point = toIncidentExportRow(firmsRow({ bbox_min_lat: '52.1', bbox_max_lat: '52.1' }));
    expect(incidentGeometry(point)?.type).toBe('Point');
    const nowhere = toIncidentExportRow({ id: 1, metadata: {} });
    expect(incidentGeometry(nowhere)).toBeNull();
  });
});

describe('loadSourceProvenance', () => {
  const run = (outcome: 'updated' | 'failed', finishedAt: string) => ({ startedAt: finishedAt, finishedAt, durationMs: 1, outcome });

  it('takes registry facts and the newest successful load from the journal', async () => {
    const read = jest.fn(async (source: string) => (source === 'firms'
      ? [run('failed', '2026-09-27T11:00:00Z'), run('updated', '2026-09-27T10:30:00Z')]
      : source === 'firms_history' ? [run('updated', '2026-09-27T10:31:00Z')] : []));
    const [firms, osm] = await loadSourceProvenance(['firms', 'osm_boundaries'], read, { osm_boundaries: 'ru-regions.2026-09.geojson' });
    expect(firms).toMatchObject({
      id: 'firms', license: { name: 'Открытые данные NASA (без ограничений)' },
      lastSuccessfulLoad: '2026-09-27T10:30:00Z', lastSuccessfulHistoryWrite: '2026-09-27T10:31:00Z',
    });
    expect(osm).toMatchObject({ id: 'osm_boundaries', license: { name: 'ODbL 1.0' }, lastSuccessfulLoad: null, version: 'ru-regions.2026-09.geojson' });
    expect(read).not.toHaveBeenCalledWith('osm_boundaries');
  });

  it('degrades to null load times when the journal cannot be read', async () => {
    const [firms] = await loadSourceProvenance(['firms'], async () => { throw new Error('redis down'); });
    expect(firms.lastSuccessfulLoad).toBeNull();
    expect(firms.lastSuccessfulHistoryWrite).toBeNull();
  });
});

const ind = (id: string, value: number | null, extra: Record<string, unknown> = {}) => ({
  id, label: id, value, unit: 'шт.', period: '2024', source: 'NASA FIRMS', kind: 'satellite' as const, definition: 'd', ...extra,
});

const regionsList = (): RegionsListResponse => ({
  generatedAt: '2026-09-27T06:00:00.000Z',
  boundariesFile: 'ru-regions.2026-09.geojson',
  archive: { file: 'firms-archive.2024.json', generatedAt: '2026-09-26T00:00:00Z', years: [2019, 2024], source: { name: 'NASA FIRMS', urls: [], license: 'NASA open data' } },
  regions: [
    { iso: 'RU-IRK', name: 'Иркутская область', areaKm2: 774846, baikal: true, indicators: [
      ind('hotspots_vegetation', 1500),
      ind('hotspots_deviation_5y', -12.5, { unit: '%' }),
      ind('cover_loss', null, { reason: 'нет региональной оценки', kind: 'estimate', approximate: true, period: null }),
    ] },
    { iso: 'RU-BU', name: 'Республика Бурятия', areaKm2: 351334, baikal: true, indicators: [ind('hotspots_vegetation', 0)] },
  ],
  diagnostics: { unmappedRosleshozNames: [], sourceErrors: [] },
});

describe('regions export', () => {
  it('long format: one row per region and indicator', () => {
    const rows = toRegionRows(regionsList());
    expect(rows).toHaveLength(4);
    expect(Object.keys(rows[0])).toEqual([...REGION_COLUMNS]);
    expect(rows[0]).toEqual({
      iso: 'RU-IRK', name: 'Иркутская область', baikal: true, indicator_id: 'hotspots_vegetation', label: 'hotspots_vegetation',
      value: 1500, unit: 'шт.', period: '2024', kind: 'satellite', approximate: false, source: 'NASA FIRMS', reason: null,
    });
    expect(rows[2]).toMatchObject({ indicator_id: 'cover_loss', value: null, period: null, reason: 'нет региональной оценки', approximate: true });
    expect(rows[3]).toMatchObject({ iso: 'RU-BU', value: 0 });
  });

  it('CSV: null → empty cell (never 0), a real zero stays 0, negatives are not escaped', () => {
    const parsed = parseCsv(regionsToCsv(toRegionRows(regionsList())).slice(1));
    const value = parsed[0].indexOf('value');
    const reason = parsed[0].indexOf('reason');
    expect(parsed[0]).toEqual([...REGION_COLUMNS]);
    expect(parsed[2][value]).toBe('-12.5');
    expect(parsed[3][value]).toBe('');
    expect(parsed[3][reason]).toBe('нет региональной оценки');
    expect(parsed[4][value]).toBe('0');
  });

  it('metadata names the data files, methods and sources', () => {
    const list = regionsList();
    const rows = toRegionRows(list);
    const m = buildRegionsMetadata({ generatedAt: '2026-09-27T12:00:00.000Z', list, count: rows.length, sources });
    expect(m).toMatchObject({
      dataset: 'regions', generatedAt: '2026-09-27T12:00:00.000Z', dataBuiltAt: '2026-09-27T06:00:00.000Z', count: 4, regionCount: 2,
      files: { boundaries: 'ru-regions.2026-09.geojson', firmsArchive: { file: 'firms-archive.2024.json' } },
      methods: { densityPerKm2: 10000, deviationBaselineYears: 5, gfwEstimateRegions: 14 },
      methodology: 'https://forestwatch.ru/methodology',
    });
    expect(regionsToJson(m, rows)).toEqual({ metadata: m, data: rows });
    expect(regionsToJson(m, rows).data[2].value).toBeNull();
    expect(asciiJson(m).length).toBeLessThan(8192);
  });
});
