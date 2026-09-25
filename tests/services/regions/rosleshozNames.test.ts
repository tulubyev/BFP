import path from 'path';
import {
  classifyRosleshozName, MAPPED_ISOS, normalizeRegionName, REGION_ALIASES,
} from '../../../backend/services/regions/rosleshozNames';
import { loadRegionRegistry } from '../../../backend/services/regions/registry';

const registry = loadRegionRegistry([path.resolve(__dirname, '../../../frontend/public/data/boundaries')]);

/** Official names of the 83 subjects as Rosleshoz lists them (Constitution art. 65 spelling). */
const OFFICIAL_NAMES: Record<string, string> = {
  'RU-AD': 'Республика Адыгея (Адыгея)', 'RU-AL': 'Республика Алтай', 'RU-BA': 'Республика Башкортостан',
  'RU-BU': 'Республика Бурятия', 'RU-DA': 'Республика Дагестан', 'RU-IN': 'Республика Ингушетия',
  'RU-KB': 'Кабардино-Балкарская Республика', 'RU-KL': 'Республика Калмыкия', 'RU-KC': 'Карачаево-Черкесская Республика',
  'RU-KR': 'Республика Карелия', 'RU-KO': 'Республика Коми', 'RU-ME': 'Республика Марий Эл', 'RU-MO': 'Республика Мордовия',
  'RU-SA': 'Республика Саха (Якутия)', 'RU-SE': 'Республика Северная Осетия - Алания', 'RU-TA': 'Республика Татарстан (Татарстан)',
  'RU-TY': 'Республика Тыва', 'RU-UD': 'Удмуртская Республика', 'RU-KK': 'Республика Хакасия', 'RU-CE': 'Чеченская Республика',
  'RU-CU': 'Чувашская Республика - Чувашия', 'RU-ALT': 'Алтайский край', 'RU-ZAB': 'Забайкальский край',
  'RU-KAM': 'Камчатский край', 'RU-KDA': 'Краснодарский край', 'RU-KYA': 'Красноярский край', 'RU-PER': 'Пермский край',
  'RU-PRI': 'Приморский край', 'RU-STA': 'Ставропольский край', 'RU-KHA': 'Хабаровский край', 'RU-AMU': 'Амурская область',
  'RU-ARK': 'Архангельская область', 'RU-AST': 'Астраханская область', 'RU-BEL': 'Белгородская область',
  'RU-BRY': 'Брянская область', 'RU-VLA': 'Владимирская область', 'RU-VGG': 'Волгоградская область',
  'RU-VLG': 'Вологодская область', 'RU-VOR': 'Воронежская область', 'RU-IVA': 'Ивановская область',
  'RU-IRK': 'Иркутская область', 'RU-KGD': 'Калининградская область', 'RU-KLU': 'Калужская область',
  'RU-KEM': 'Кемеровская область - Кузбасс', 'RU-KIR': 'Кировская область', 'RU-KOS': 'Костромская область',
  'RU-KGN': 'Курганская область', 'RU-KRS': 'Курская область', 'RU-LEN': 'Ленинградская область',
  'RU-LIP': 'Липецкая область', 'RU-MAG': 'Магаданская область', 'RU-MOS': 'Московская область',
  'RU-MUR': 'Мурманская область', 'RU-NIZ': 'Нижегородская область', 'RU-NGR': 'Новгородская область',
  'RU-NVS': 'Новосибирская область', 'RU-OMS': 'Омская область', 'RU-ORE': 'Оренбургская область',
  'RU-ORL': 'Орловская область', 'RU-PNZ': 'Пензенская область', 'RU-PSK': 'Псковская область',
  'RU-ROS': 'Ростовская область', 'RU-RYA': 'Рязанская область', 'RU-SAM': 'Самарская область',
  'RU-SAR': 'Саратовская область', 'RU-SAK': 'Сахалинская область', 'RU-SVE': 'Свердловская область',
  'RU-SMO': 'Смоленская область', 'RU-TAM': 'Тамбовская область', 'RU-TVE': 'Тверская область',
  'RU-TOM': 'Томская область', 'RU-TUL': 'Тульская область', 'RU-TYU': 'Тюменская область',
  'RU-ULY': 'Ульяновская область', 'RU-CHE': 'Челябинская область', 'RU-YAR': 'Ярославская область',
  'RU-MOW': 'г. Москва', 'RU-SPE': 'г. Санкт-Петербург', 'RU-YEV': 'Еврейская автономная область',
  'RU-NEN': 'Ненецкий автономный округ', 'RU-KHM': 'Ханты-Мансийский автономный округ - Югра',
  'RU-CHU': 'Чукотский автономный округ', 'RU-YAN': 'Ямало-Ненецкий автономный округ',
};

describe('Rosleshoz name table completeness', () => {
  const registryIsos = registry.regions.map(r => r.iso).sort();

  it('covers exactly the 83 regions of the boundaries file', () => {
    expect(registryIsos).toHaveLength(83);
    expect(MAPPED_ISOS).toEqual(registryIsos);
  });

  it('maps the official name of every one of the 83 regions', () => {
    expect(Object.keys(OFFICIAL_NAMES).sort()).toEqual(registryIsos);
    const wrong = Object.entries(OFFICIAL_NAMES)
      .filter(([iso, name]) => {
        const m = classifyRosleshozName(name);
        return m.kind !== 'region' || m.iso !== iso;
      })
      .map(([iso, name]) => `${iso}: ${name}`);
    expect(wrong).toEqual([]);
  });

  it('maps the short OSM name of every region (the registry names)', () => {
    const wrong = registry.regions
      .filter(r => {
        const m = classifyRosleshozName(r.name);
        return m.kind !== 'region' || m.iso !== r.iso;
      })
      .map(r => `${r.iso}: ${r.name}`);
    expect(wrong).toEqual([]);
  });

  it('never maps one alias to two regions', () => {
    const seen = new Map<string, string>();
    for (const [iso, aliases] of Object.entries(REGION_ALIASES)) {
      for (const alias of aliases) {
        const key = normalizeRegionName(alias);
        expect(seen.get(key) ?? iso).toBe(iso);
        seen.set(key, iso);
      }
    }
  });
});

describe('classifyRosleshozName: odd spellings', () => {
  it.each([
    ['Ханты-Мансийский автономный округ – Югра', 'RU-KHM'],
    ['Ханты-Мансийский автономный округ—Югра', 'RU-KHM'],
    ['Ханты - Мансийский   автономный округ - Югра', 'RU-KHM'],
    ['  Республика  Бурятия ', 'RU-BU'],
    ['Республика Бурятия', 'RU-BU'],
    ['РЕСПУБЛИКА САХА (ЯКУТИЯ)', 'RU-SA'],
    ['Республика Саха(Якутия)', 'RU-SA'],
    ['Республика Северная Осетия — Алания', 'RU-SE'],
    ['Чувашская Республика – Чувашия', 'RU-CU'],
    ['Кемеровская область – Кузбасс', 'RU-KEM'],
    ['Кемеровская область', 'RU-KEM'],
    ['г.Москва', 'RU-MOW'],
    ['город федерального значения Санкт-Петербург', 'RU-SPE'],
    ['Санкт - Петербург', 'RU-SPE'],
    ['Тюменская область (без автономных округов)', 'RU-TYU'],
    ['Архангельская область (без НАО)', 'RU-ARK'],
    ['«Республика Татарстан»', 'RU-TA'],
    ['Удмуртская Республика.', 'RU-UD'],
    ['Забайкальский  край', 'RU-ZAB'],
    ['Ханты-Мансийский автономный округ - Югра (Тюменская область)', 'RU-KHM'],
    ['Ненецкий автономный округ (Архангельская область)', 'RU-NEN'],
  ])('%s → %s', (name, iso) => {
    expect(classifyRosleshozName(name)).toEqual({ kind: 'region', iso });
  });
});

describe('classifyRosleshozName: explicit exclusions', () => {
  it.each([
    'Российская Федерация', 'Всего по Российской Федерации', 'Итого', 'ВСЕГО',
    'Центральный федеральный округ', 'Северо-Западный федеральный округ', 'Южный федеральный округ',
    'Северо-Кавказский федеральный округ', 'Приволжский федеральный округ', 'Уральский федеральный округ',
    'Сибирский федеральный округ', 'Дальневосточный федеральный округ', 'Дальневосточный ФО', 'СФО',
    'Республика Крым', 'г. Севастополь', 'город федерального значения Севастополь',
    'Донецкая Народная Республика', 'Луганская Народная Республика', 'Запорожская область', 'Херсонская область',
    'г. Байконур',
  ])('%s is excluded, not mapped', name => {
    expect(classifyRosleshozName(name).kind).toBe('excluded');
  });
});

describe('classifyRosleshozName: unknown names', () => {
  it('reports a name it has never seen as unmapped (callers log and journal it)', () => {
    expect(classifyRosleshozName('Лесничество Минобороны')).toEqual({ kind: 'unmapped' });
    expect(classifyRosleshozName('Бурятская область')).toEqual({ kind: 'unmapped' });
  });
  it('treats an empty name as excluded, not as a region', () => {
    expect(classifyRosleshozName('   ').kind).toBe('excluded');
  });
});
