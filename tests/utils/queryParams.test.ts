import { HOTSPOT_DAYS_DEFAULT, HOTSPOT_DAYS_MAX, YEAR_MAX, YEAR_MIN, parseDays, parseYear } from '../../backend/utils/queryParams';

describe('parseDays', () => {
  it('accepts integers and clamps them to [1, max]', () => {
    expect(parseDays('3')).toBe(3);
    expect(parseDays(14)).toBe(14);
    expect(parseDays('0')).toBe(1);
    expect(parseDays('365')).toBe(HOTSPOT_DAYS_MAX);
  });

  it('falls back to the default for anything that is not a plain integer', () => {
    for (const v of [undefined, '', 'abc', '1.5', '-3', ['2', '3'].join(','), {}, null]) {
      expect(parseDays(v)).toBe(HOTSPOT_DAYS_DEFAULT);
    }
  });

  it('never lets SQL through', () => {
    expect(parseDays("1 days'; DELETE FROM gis.forest_changes; --")).toBe(HOTSPOT_DAYS_DEFAULT);
    expect(parseDays("7' OR '1'='1")).toBe(HOTSPOT_DAYS_DEFAULT);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseDays(['5', '9'])).toBe(5);
  });
});

describe('parseYear', () => {
  it('accepts 4-digit years and clamps them to [YEAR_MIN, YEAR_MAX]', () => {
    expect(parseYear('2019', 2001)).toBe(2019);
    expect(parseYear(2020, 2001)).toBe(2020);
    expect(parseYear('1990', 2023)).toBe(YEAR_MIN);
    expect(parseYear('9999', 2023)).toBe(YEAR_MAX);
  });

  it('falls back for anything else, so year loops stay short', () => {
    for (const v of [undefined, '', 'abc', '0', '-2001', '1e12', '999999999999', '2019.5', {}, null]) {
      expect(parseYear(v, 2023)).toBe(2023);
    }
    expect(parseYear(['2010', '2020'], 2023)).toBe(2010);
    expect(parseYear('2019; DROP TABLE x', 2023)).toBe(2023);
  });
});
