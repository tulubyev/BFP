import {
  checkGfwLossRows, checkGfwStatistics, distVersionProblem, MIN_PNG_BYTES, STATISTICS_FIELDS, tileProblem,
} from '../../../backend/services/quality/gfw';
import { TRANSPARENT_PNG } from '../../../backend/services/gfwTiles';

const NOW = new Date('2026-09-29T12:00:00Z');
const lossAnswer = (rows: unknown[]) => ({ data: rows, status: 'success' });
const years = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, area_ha: 1000 + i, emissions_Mg_CO2: 148000 }));

describe('checkGfwLossRows', () => {
  it('accepts a normal Data API answer (numbers may come as strings)', () => {
    const { rows, result } = checkGfwLossRows(lossAnswer([{ year: '2024', area_ha: '812.5', emissions_Mg_CO2: null }, ...years(2001, 2023)]), 'data-api-loss', NOW);
    expect(result).toMatchObject({ source: 'gfw_loss', ok: true, total: 24, rejected: 0 });
    expect(rows[0]).toEqual({ year: 2024, area_ha: 812.5, emissions_Mg_CO2: 0 });
  });

  it('drops a single bad row with a count', () => {
    const { rows, result } = checkGfwLossRows(lossAnswer([...years(2001, 2024), { year: 2025, area_ha: -1 }]), 'x', NOW);
    expect(rows).toHaveLength(24);
    expect(result).toMatchObject({ ok: true, rejected: 1 });
    expect(result.reason).toMatch(/area_ha=/);
  });

  it.each([
    ['year before 2001', { year: 2000, area_ha: 1 }],
    ['year after the current one', { year: 2027, area_ha: 1 }],
    ['fractional year', { year: 2020.5, area_ha: 1 }],
    ['missing year', { area_ha: 1 }],
    ['missing area_ha', { year: 2020 }],
    ['negative area_ha', { year: 2020, area_ha: -5 }],
    ['infinite area_ha', { year: 2020, area_ha: 'Infinity' }],
    ['negative emissions', { year: 2020, area_ha: 5, emissions_Mg_CO2: -1 }],
  ])('rejects the answer when every row has %s', (_label, row) => {
    const { rows, result } = checkGfwLossRows(lossAnswer([row, row, row]), 'data-api-loss', NOW);
    expect(rows).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/3 of 3 rows are invalid/);
  });

  it.each([
    ['no data array', { status: 'failed', message: 'Unauthorized' }, /no "data" array/],
    ['an HTML page', '<html><body>502 Bad Gateway</body></html>', /HTML page/],
    ['a truncated JSON string', '{"data":[{"year":2020,', /no "data" array/],
  ])('rejects %s as a format change', (_label, body, reason) => {
    const { result } = checkGfwLossRows(body, 'data-api-loss', NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it('an empty data array is a valid «no rows» answer (the caller falls back to the estimate)', () => {
    expect(checkGfwLossRows(lossAnswer([]), 'x', NOW).result).toMatchObject({ ok: true, total: 0 });
  });
});

describe('checkGfwStatistics', () => {
  const full = Object.fromEntries(STATISTICS_FIELDS.map((f, i) => [f, 10 + i]));

  it('accepts a row with every field', () => {
    const { row, result } = checkGfwStatistics({ data: [full] });
    expect(result.ok).toBe(true);
    expect(row?.area__ha).toBe(10);
  });

  it('rejects a missing field instead of turning it into 0', () => {
    const { umd_tree_cover_gain__ha: _gone, ...partial } = full;
    const { row, result } = checkGfwStatistics({ data: [partial] });
    expect(row).toBeNull();
    expect(result.reason).toMatch(/umd_tree_cover_gain__ha/);
  });

  it('rejects negative values, no rows and a changed format', () => {
    expect(checkGfwStatistics({ data: [{ ...full, area__ha: -1 }] }).result.ok).toBe(false);
    expect(checkGfwStatistics({ data: [] }).result.reason).toMatch(/no data rows/);
    expect(checkGfwStatistics({ rows: [full] }).result.reason).toMatch(/no "data" array/);
  });
});

describe('tileProblem', () => {
  it('accepts a PNG served as image/png (with parameters) or as octet-stream', () => {
    expect(tileProblem('image/png', TRANSPARENT_PNG)).toBeNull();
    expect(tileProblem('image/png; charset=binary', TRANSPARENT_PNG)).toBeNull();
    expect(tileProblem('application/octet-stream', TRANSPARENT_PNG)).toBeNull();
  });

  it.each([
    ['an HTML page', 'text/html; charset=utf-8', Buffer.from('<html><body>Maintenance</body></html>'), /content type "text\/html" instead of image\/png/],
    ['a JSON error', 'application/json', Buffer.from('{"status":"failed"}'), /application\/json/],
    ['no content type', undefined, TRANSPARENT_PNG, /content type "none"/],
    ['an empty body', 'image/png', Buffer.alloc(0), /empty body/],
    ['a truncated PNG', 'image/png', TRANSPARENT_PNG.subarray(0, 20), /too small/],
    ['HTML labelled image/png', 'image/png', Buffer.from('<!DOCTYPE html><html><head><title>Error</title></head></html>'), /not a PNG/],
    ['a JPEG served as octet-stream', 'application/octet-stream', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]), /not a PNG/],
  ])('rejects %s', (_label, type, body, reason) => {
    expect(tileProblem(type, body)).toMatch(reason);
  });

  it('knows the smallest possible PNG', () => {
    expect(TRANSPARENT_PNG.length).toBeGreaterThanOrEqual(MIN_PNG_BYTES);
  });
});

describe('distVersionProblem', () => {
  it('accepts a recent vYYYYMMDD', () => {
    expect(distVersionProblem('v20260919', NOW)).toBeNull();
  });

  it.each([
    ['latest', /not vYYYYMMDD/],
    ['v2026091', /not vYYYYMMDD/],
    ['v20261332', /not a real date/],
    ['v20260231', /not a real date/],
    ['v20271001', /in the future/],
    ['v19990101', /older than DIST-ALERT/],
    [undefined, /not vYYYYMMDD/],
  ])('rejects %s', (version, reason) => {
    expect(distVersionProblem(version, NOW)).toMatch(reason);
  });
});
