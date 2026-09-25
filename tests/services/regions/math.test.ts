import { deviationFromMean, lossPer100kHa, perArea, round, sharePercent } from '../../../backend/services/regions/math';

describe('perArea (hotspots per 10 000 km²)', () => {
  it('normalizes a count by area', () => {
    expect(perArea(1500, 775_000)).toBeCloseTo(19.3548, 4);
    expect(perArea(10, 10_000)).toBe(10);
    expect(perArea(3, 1_000, 100)).toBeCloseTo(0.3);
  });
  it('keeps a real zero count', () => {
    expect(perArea(0, 50_000)).toBe(0);
  });
  it('returns null, never 0, for a missing count or area', () => {
    expect(perArea(null, 10_000)).toBeNull();
    expect(perArea(undefined, 10_000)).toBeNull();
    expect(perArea(5, 0)).toBeNull();
    expect(perArea(5, null)).toBeNull();
    expect(perArea(NaN, 10)).toBeNull();
  });
});

describe('deviationFromMean (year vs mean of 5 previous complete years)', () => {
  const years = [2019, 2020, 2021, 2022, 2023, 2024];
  const series = { 2019: 1000, 2020: 2000, 2021: 3000, 2022: 4000, 2023: 5000, 2024: 1500 };

  it('computes (x − mean) / mean × 100 over exactly the 5 preceding years', () => {
    const r = deviationFromMean(series, 2024, years);
    expect(r.value).toBeCloseTo(-50);
    if (r.value === null) throw new Error('unexpected null');
    expect(r.baselineMean).toBe(3000);
    expect(r.baselineYears).toEqual([2019, 2020, 2021, 2022, 2023]);
  });

  it('is positive above the mean', () => {
    expect(deviationFromMean({ ...series, 2024: 4500 }, 2024, years).value).toBeCloseTo(50);
  });

  it('is null when a baseline year is missing from the archive', () => {
    const r = deviationFromMean(series, 2023, years);
    expect(r.value).toBeNull();
    expect(r).toMatchObject({ reason: expect.stringContaining('2018') });
  });

  it('is null when a baseline year is not complete, even if a value exists', () => {
    const r = deviationFromMean(series, 2024, [2020, 2021, 2022, 2023, 2024]);
    expect(r.value).toBeNull();
  });

  it('is null when the target year itself is incomplete (partial current year)', () => {
    expect(deviationFromMean({ ...series, 2025: 10 }, 2025, years).value).toBeNull();
  });

  it('is null when a baseline value is null (not treated as 0)', () => {
    expect(deviationFromMean({ ...series, 2021: null }, 2024, years).value).toBeNull();
  });

  it('is null instead of Infinity when the baseline mean is zero', () => {
    const zero = { 2019: 0, 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 10 };
    const r = deviationFromMean(zero, 2024, years);
    expect(r.value).toBeNull();
    expect(r).toMatchObject({ reason: expect.stringContaining('нулю') });
  });

  it('supports a custom window', () => {
    expect(deviationFromMean(series, 2024, years, 2).value).toBeCloseTo((1500 - 4500) / 4500 * 100);
  });
});

describe('lossPer100kHa', () => {
  it('divides loss (ha) by forest fund (thousand ha) per 100 000 ha', () => {
    // 8 470 ha of loss in 71 500 thousand ha = 71.5 Mha → 11.846 ha per 100 000 ha
    expect(lossPer100kHa(8470, 71_500)).toBeCloseTo(11.846, 3);
    expect(lossPer100kHa(1000, 100)).toBe(1000);
  });
  it('returns null without a loss value or forest fund', () => {
    expect(lossPer100kHa(null, 100)).toBeNull();
    expect(lossPer100kHa(10, 0)).toBeNull();
    expect(lossPer100kHa(10, null)).toBeNull();
  });
});

describe('sharePercent / round', () => {
  it('clamps sampling overshoot to 100 %', () => {
    expect(sharePercent(101, 100)).toBe(100);
    expect(sharePercent(25, 100)).toBe(25);
    expect(sharePercent(0, 100)).toBe(0);
    expect(sharePercent(1, 0)).toBeNull();
  });
  it('rounds and keeps null', () => {
    expect(round(1.2345, 2)).toBe(1.23);
    expect(round(null)).toBeNull();
  });
});
