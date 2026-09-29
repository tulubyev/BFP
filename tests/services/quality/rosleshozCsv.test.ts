/**
 * Rosleshoz CSV quality gate on fixtures shaped like the real tables (column names as in
 * regions/rosleshozRegional tests: ForestlandArea `subjects,area`, WoodVolume `region,volume,year`,
 * ForestFund `region,total_materials,…,woodiness`) — rosleshoz.gov.ru is not reachable from CI.
 */
import {
  checkRosleshozCsv, MAX_BAD_ROW_SHARE, MAX_SUBJECTS, MIN_SUBJECTS, parseCsvLine,
} from '../../../backend/services/quality/rosleshozCsv';

/** 98 names like the 2026 ForestlandArea: total, 8 federal districts, 89 subjects. */
const NAMES = [
  'Российская Федерация',
  ...Array.from({ length: 8 }, (_, i) => `Федеральный округ ${i + 1}`),
  'Иркутская область', 'Республика Бурятия', 'Забайкальский край',
  ...Array.from({ length: 86 }, (_, i) => `Субъект ${i + 1}`),
];

const csv = (header: string, rows: string[]) => [header, ...rows].join('\r\n') + '\r\n';
const forestland = (value = (i: number) => String(1000 + i)) =>
  csv('subjects,area', NAMES.map((n, i) => `"${n}",${value(i)}`));

describe('checkRosleshozCsv — per-region tables', () => {
  it('accepts a normal ForestlandArea table and keeps every row', () => {
    const { rows, result } = checkRosleshozCsv('forestlandArea', forestland());
    expect(result).toMatchObject({ source: 'rosleshoz', check: 'forestlandArea', ok: true, total: 98, rejected: 0 });
    expect(rows).toHaveLength(98);
    expect(rows[9]).toEqual({ subjects: 'Иркутская область', area: '1009' });
  });

  it('accepts Russian number formatting and «no value» placeholders (they stay empty, not errors)', () => {
    const { rows, result } = checkRosleshozCsv('forestlandArea', forestland(i => (i === 9 ? '"69 420,5"' : i === 10 ? '-' : i === 11 ? '' : '5')));
    expect(result.ok).toBe(true);
    expect(result.rejected).toBe(0);
    expect(rows.find(r => r.subjects === 'Республика Бурятия')?.area).toBe('-');
  });

  it('drops rows with a negative number, counting them, and keeps the dataset', () => {
    const { rows, result } = checkRosleshozCsv('forestlandArea', forestland(i => (i === 9 ? '-5' : '10')));
    expect(result.ok).toBe(true);
    expect(result.rejected).toBe(1);
    expect(result.reason).toMatch(/area=-5 < 0/);
    expect(rows.some(r => r.subjects === 'Иркутская область')).toBe(false);
  });

  it('rejects the dataset when the value column was renamed', () => {
    const { rows, result } = checkRosleshozCsv('forestlandArea', forestland().replace('subjects,area', 'subjects,square'));
    expect(rows).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/header lacks column\(s\) area\|value/);
  });

  it('rejects the dataset when the name column was renamed', () => {
    const { result } = checkRosleshozCsv('woodVolume', csv('territory,volume,year', NAMES.map(n => `${n},10,2025`)));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/region\|subjects\|subject\|name/);
  });

  it('rejects a table with too few subjects (3, not ≈ 98)', () => {
    const { result } = checkRosleshozCsv('forestlandArea', csv('subjects,area', ['Иркутская область,1', 'Республика Бурятия,2', 'Российская Федерация,3']));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(new RegExp(`3 distinct subjects.*${MIN_SUBJECTS}–${MAX_SUBJECTS}`));
  });

  it('rejects a table with far too many subjects (3000 municipal rows)', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => `Район ${i},1`);
    const { result } = checkRosleshozCsv('forestlandArea', csv('subjects,area', rows));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/3000 distinct subjects/);
  });

  it('counts distinct subjects, not rows (a table with several years per subject is fine)', () => {
    const rows = NAMES.flatMap(n => ['2023', '2024', '2025'].map(y => `"${n}",100,${y}`));
    const { result } = checkRosleshozCsv('woodVolume', csv('region,volume,year', rows));
    expect(result).toMatchObject({ ok: true, total: 294, rejected: 0 });
  });

  it('rejects implausible units: forest area in hectares instead of thousand ha', () => {
    const { result } = checkRosleshozCsv('forestlandArea', forestland(i => String(250_000_000 + i)));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/rows are invalid.*thousand ha.*format changed/);
  });

  it('rejects woodiness outside 0–100 % as a unit change when it affects many rows', () => {
    const rows = NAMES.map(n => `"${n}",1000,${n.startsWith('Субъект') ? '0.64' : '64'}`);
    expect(checkRosleshozCsv('forestFund', csv('region,total_materials,woodiness', rows)).result.ok).toBe(true);
    const permille = NAMES.map(n => `"${n}",1000,640`);
    const { result } = checkRosleshozCsv('forestFund', csv('region,total_materials,woodiness', permille));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/woodiness=640 > 100 %/);
  });

  it('drops a row whose value is text (shifted columns) and rejects the file past the bad-row share', () => {
    const shiftedRows = Math.ceil(NAMES.length * MAX_BAD_ROW_SHARE) + 1;
    const { result } = checkRosleshozCsv('forestlandArea', forestland(i => (i < shiftedRows ? 'Сибирский ФО' : '10')));
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe(shiftedRows);
    expect(result.reason).toMatch(/is not a number/);
  });

  it('drops a row with more fields than the header (broken quoting)', () => {
    const { result } = checkRosleshozCsv('forestlandArea', forestland(i => (i === 20 ? '1,2' : '10')));
    expect(result).toMatchObject({ ok: true, rejected: 1 });
    expect(result.reason).toMatch(/3 fields for 2 columns/);
  });
});

describe('checkRosleshozCsv — one-column tables (real FireCover, MineralizedStrips, ForesFundFiresArea)', () => {
  it('a dataset without a schema may have a single column', () => {
    const { rows, result } = checkRosleshozCsv('fireCover', 'area\n"1,5"\n');
    expect(result.ok).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('a dataset the app reads by column is still rejected when its columns are missing', () => {
    const { result } = checkRosleshozCsv('woodVolume', 'region\nИркутская область\n');
    expect(result.ok).toBe(false);
  });
});

describe('checkRosleshozCsv — any dataset', () => {
  it.each([
    ['HTML page', '<!DOCTYPE html><html><body>Сайт на реконструкции</body></html>', /HTML page instead of CSV/],
    ['empty body', '   \n', /empty response/],
    ['JSON object (axios parsed an error answer)', { error: 'Not found' }, /not CSV text/],
    ['header only', 'region,volume\n', /header only/],
    ['an unnamed column in the header', 'region,\nИркутская область,1\n', /bad header/],
  ])('rejects %s', (_label, body, reason) => {
    const { rows, result } = checkRosleshozCsv('woodChecks', body);
    expect(rows).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it('only checks the structure of tables whose columns the app does not read', () => {
    const { rows, result } = checkRosleshozCsv('woodChecks', csv('period,checks,violations', ['2025,-3,x', '2024,5,6']));
    expect(result.ok).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('strips a UTF-8 BOM before reading the header', () => {
    const { rows } = checkRosleshozCsv('woodChecks', '﻿period,checks\n2025,3\n');
    expect(Object.keys(rows[0])).toEqual(['period', 'checks']);
  });

  it('ReforestationArea is a Russia-wide total: no subject count, but year and area are checked', () => {
    const ok = checkRosleshozCsv('reforestationArea', csv('year,area', ['2024,1234.5', '2025,1300']));
    expect(ok.result).toMatchObject({ ok: true, total: 2, rejected: 0 });
    const future = checkRosleshozCsv('reforestationArea', csv('year,area', ['2024,1234.5', '2999,1300']));
    expect(future.result).toMatchObject({ ok: true, rejected: 1 });
    expect(future.rows).toEqual([{ year: '2024', area: '1234.5' }]);
    expect(checkRosleshozCsv('reforestationArea', csv('year,square', ['2024,1'])).result.ok).toBe(false);
  });
});

describe('parseCsvLine', () => {
  it('keeps commas inside quotes', () => {
    expect(parseCsvLine('"Ханты-Мансийский автономный округ, Югра",1 234,5')).toEqual(['Ханты-Мансийский автономный округ, Югра', '1 234', '5']);
  });
});
