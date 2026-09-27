import { HOTSPOT_DAYS_DEFAULT, HOTSPOT_DAYS_MAX, parseDays } from '../../backend/utils/queryParams';

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
