import { extractRegional, parseRosleshozNumber, ROSLESHOZ_SPECS } from '../../../backend/services/regions/rosleshozRegional';

describe('parseRosleshozNumber', () => {
  it.each([
    ['1234.5', 1234.5], ['1 234,5', 1234.5], ['1 234', 1234], ['0', 0], ['-3', -3], ['.5', 0.5],
  ])('%s → %s', (raw, expected) => expect(parseRosleshozNumber(raw)).toBe(expected));

  it.each(['', ' ', '-', '—', 'н/д', 'abc', '12abc'])('%j → null (not 0)', raw => {
    expect(parseRosleshozNumber(raw)).toBeNull();
  });

  it('is null for undefined', () => expect(parseRosleshozNumber(undefined)).toBeNull());
});

describe('extractRegional', () => {
  it('maps long Rosleshoz names to ISO and skips totals and excluded regions', () => {
    const rows = [
      { subjects: 'Российская Федерация', area: '1000000' },
      { subjects: 'Сибирский федеральный округ', area: '300000' },
      { subjects: 'Республика Бурятия', area: '27 550,4' },
      { subjects: 'Иркутская область', area: '69420' },
      { subjects: 'Республика Крым', area: '300' },
    ];
    const { byIso, unmapped } = extractRegional(rows, ROSLESHOZ_SPECS.forestlandArea);
    expect([...byIso.keys()].sort()).toEqual(['RU-BU', 'RU-IRK']);
    expect(byIso.get('RU-BU')).toEqual({ value: 27550.4, year: null });
    expect(unmapped).toEqual([]);
  });

  it('keeps an empty value as null for that region', () => {
    const { byIso } = extractRegional([{ region: 'Забайкальский край', volume: '' }], ROSLESHOZ_SPECS.woodVolume);
    expect(byIso.get('RU-ZAB')).toEqual({ value: null, year: null });
  });

  it('takes the newest year with a value when the dataset has a year column', () => {
    const rows = [
      { region: 'Иркутская область', volume: '30000', year: '2023' },
      { region: 'Иркутская область', volume: '31000', year: '2025' },
      { region: 'Иркутская область', volume: '', year: '2026' },
      { region: 'Иркутская область', volume: '29000', year: '2024' },
    ];
    expect(extractRegional(rows, ROSLESHOZ_SPECS.woodVolume).byIso.get('RU-IRK')).toEqual({ value: 31000, year: 2025 });
  });

  it('collects unknown names for the log and journal', () => {
    const rows = [{ region: 'Лесничество Минобороны', total_materials: '5' }, { region: 'Лесничество Минобороны', total_materials: '6' }];
    expect(extractRegional(rows, ROSLESHOZ_SPECS.forestFundTotal).unmapped).toEqual(['Лесничество Минобороны']);
  });

  it('falls back to alternative column names', () => {
    const { byIso } = extractRegional([{ region: 'Томская область', total: '28 700' }], ROSLESHOZ_SPECS.forestFundTotal);
    expect(byIso.get('RU-TOM')?.value).toBe(28700);
  });
});
