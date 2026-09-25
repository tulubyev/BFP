import type { Indicator, RegionSummary } from '../frontend/src/api/regions';
import {
  NO_DATA, REGION_COLUMNS, columnKind, formatIndicatorNumber, formatIndicatorValue, groupByKind, nextSort, sortRegionRows,
} from '../frontend/src/utils/regions';

const ind = (id: string, value: number | null, extra: Partial<Indicator> = {}): Indicator => ({
  id, label: id, value, unit: 'шт.', period: '2024', source: 's', kind: 'satellite', definition: 'd', ...extra,
});
const region = (iso: string, name: string, baikal: boolean, value: number | null): RegionSummary => ({
  iso, name, areaKm2: 1, baikal, indicators: [ind('hotspots_vegetation', value)],
});

describe('formatIndicatorNumber / formatIndicatorValue', () => {
  it('shows «нет данных» for null, never 0', () => {
    expect(formatIndicatorNumber(ind('x', null))).toBe(NO_DATA);
    expect(formatIndicatorNumber(null)).toBe(NO_DATA);
    expect(formatIndicatorValue(ind('x', null, { reason: 'архив FIRMS ещё не собран' }))).toBe('нет данных: архив FIRMS ещё не собран');
  });
  it('shows a real zero as 0', () => {
    expect(formatIndicatorNumber(ind('x', 0))).toBe('0');
  });
  it('localizes and marks approximate values', () => {
    expect(formatIndicatorNumber(ind('x', 69420)).replace(/\s/g, ' ')).toBe('69 420');
    expect(formatIndicatorNumber(ind('x', 2.345, { approximate: true }))).toBe('≈ 2,35');
    expect(formatIndicatorValue(ind('x', 19.35, { unit: 'шт. / 10 000 км² / год' }))).toBe('19,35 шт. / 10 000 км² / год');
  });
  it('signs positive deviations', () => {
    expect(formatIndicatorNumber(ind('hotspots_deviation_5y', 12.5))).toBe('+12,5');
    expect(formatIndicatorNumber(ind('hotspots_deviation_5y', -50))).toBe('-50');
  });
});

describe('sortRegionRows', () => {
  const regions = [
    region('RU-IRK', 'Иркутская область', true, 5),
    region('RU-BU', 'Бурятия', true, null),
    region('RU-ZAB', 'Забайкальский край', true, 1),
    region('RU-TOM', 'Томская область', false, 10),
    region('RU-AD', 'Адыгея', false, null),
    region('RU-KYA', 'Красноярский край', false, 30),
    region('RU-AMU', 'Амурская область', false, 0),
  ];

  it('keeps the Baikal regions pinned on top in their order, whatever the sort', () => {
    for (const dir of ['asc', 'desc'] as const) {
      expect(sortRegionRows(regions, { key: 'hotspots_vegetation', dir }).slice(0, 3).map(r => r.iso)).toEqual(['RU-IRK', 'RU-BU', 'RU-ZAB']);
    }
  });

  it('sorts by value and always puts missing values last', () => {
    expect(sortRegionRows(regions, { key: 'hotspots_vegetation', dir: 'desc' }).slice(3).map(r => r.iso)).toEqual(['RU-KYA', 'RU-TOM', 'RU-AMU', 'RU-AD']);
    expect(sortRegionRows(regions, { key: 'hotspots_vegetation', dir: 'asc' }).slice(3).map(r => r.iso)).toEqual(['RU-AMU', 'RU-TOM', 'RU-KYA', 'RU-AD']);
  });

  it('sorts by Russian name', () => {
    expect(sortRegionRows(regions, { key: 'name', dir: 'asc' }).slice(3).map(r => r.iso)).toEqual(['RU-AD', 'RU-AMU', 'RU-KYA', 'RU-TOM']);
  });

  it('does not mutate its input', () => {
    const copy = [...regions];
    sortRegionRows(regions, { key: 'name', dir: 'desc' });
    expect(regions).toEqual(copy);
  });
});

describe('nextSort', () => {
  it('flips the same column and starts a new numeric column descending', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'oopt_share')).toEqual({ key: 'oopt_share', dir: 'desc' });
  });
});

describe('groupByKind / columnKind', () => {
  it('groups indicators by kind', () => {
    const g = groupByKind([ind('a', 1, { kind: 'official' }), ind('b', 1), ind('c', null, { kind: 'estimate' })]);
    expect([g.official.length, g.satellite.length, g.estimate.length]).toEqual([1, 1, 1]);
  });
  it('gives a column badge only when all regions agree on the kind', () => {
    const r = (kind: Indicator['kind']): RegionSummary => ({ iso: 'x', name: 'x', areaKm2: 1, baikal: false, indicators: [ind('cover_loss', 1, { kind })] });
    expect(columnKind([r('estimate'), r('estimate')], 'cover_loss')).toBe('estimate');
    expect(columnKind([r('estimate'), r('satellite')], 'cover_loss')).toBeNull();
  });
  it('has table columns for indicators the backend produces', () => {
    expect(REGION_COLUMNS.map(c => c.id)).toContain('hotspots_per_10k_km2');
    expect(REGION_COLUMNS.map(c => c.id)).toContain('loss_per_100k_ha');
  });
});
