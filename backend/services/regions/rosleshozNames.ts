/**
 * Rosleshoz subject names → ISO 3166-2 codes of the 83 regions in ru-regions.<version>.geojson.
 *
 * Rosleshoz open data uses official long names («Республика Бурятия», «Ханты-Мансийский
 * автономный округ - Югра»), sometimes with odd spacing, dashes or a trailing «(Якутия)»; the OSM
 * boundaries use short names («Бурятия»). Names are normalized first, then looked up in the alias
 * table. Totals, federal districts, Crimea, Sevastopol, Baikonur and the 2022 regions are excluded
 * explicitly — they are not among the 83 regions the site covers (CLAUDE.md).
 */

/** Lowercase, «ё»→«е», every dash/hyphen → "-", no spaces around dashes, single spaces, no quotes. */
export function normalizeRegionName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[   \t\r\n]/g, ' ')
    .replace(/[‐-―−­]/g, '-')
    .replace(/["«»“”„']/g, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ') ')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:\s]+$/, '')
    .trim();
}

/** Strips a leading «г.»/«город»/«город федерального значения» (Moscow, St Petersburg). */
function stripCityPrefix(name: string): string {
  return name.replace(/^(г\.\s?|город федерального значения |город )/, '').trim();
}

/** Drops parenthesized parts: «республика саха (якутия)» → «республика саха». */
function stripParens(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * All accepted spellings per ISO code (before normalization — the table is normalized on load).
 * The first entry is the official name from the Constitution (art. 65).
 */
export const REGION_ALIASES: Record<string, string[]> = {
  'RU-AD': ['Республика Адыгея (Адыгея)', 'Республика Адыгея', 'Адыгея'],
  'RU-AL': ['Республика Алтай'],
  'RU-BA': ['Республика Башкортостан', 'Башкортостан', 'Башкирия'],
  'RU-BU': ['Республика Бурятия', 'Бурятия'],
  'RU-DA': ['Республика Дагестан', 'Дагестан'],
  'RU-IN': ['Республика Ингушетия', 'Ингушетия'],
  'RU-KB': ['Кабардино-Балкарская Республика', 'Кабардино-Балкария'],
  'RU-KL': ['Республика Калмыкия', 'Калмыкия'],
  'RU-KC': ['Карачаево-Черкесская Республика', 'Карачаево-Черкесия'],
  'RU-KR': ['Республика Карелия', 'Карелия'],
  'RU-KO': ['Республика Коми', 'Коми'],
  'RU-ME': ['Республика Марий Эл', 'Марий Эл'],
  'RU-MO': ['Республика Мордовия', 'Мордовия'],
  'RU-SA': ['Республика Саха (Якутия)', 'Республика Саха', 'Якутия', 'Саха (Якутия)'],
  'RU-SE': ['Республика Северная Осетия - Алания', 'Республика Северная Осетия', 'Северная Осетия - Алания', 'Северная Осетия'],
  'RU-TA': ['Республика Татарстан (Татарстан)', 'Республика Татарстан', 'Татарстан'],
  'RU-TY': ['Республика Тыва', 'Тыва', 'Тува'],
  'RU-UD': ['Удмуртская Республика', 'Удмуртия'],
  'RU-KK': ['Республика Хакасия', 'Хакасия'],
  'RU-CE': ['Чеченская Республика', 'Чечня'],
  'RU-CU': ['Чувашская Республика - Чувашия', 'Чувашская Республика', 'Чувашия'],
  'RU-ALT': ['Алтайский край'],
  'RU-ZAB': ['Забайкальский край'],
  'RU-KAM': ['Камчатский край'],
  'RU-KDA': ['Краснодарский край'],
  'RU-KYA': ['Красноярский край'],
  'RU-PER': ['Пермский край'],
  'RU-PRI': ['Приморский край'],
  'RU-STA': ['Ставропольский край'],
  'RU-KHA': ['Хабаровский край'],
  'RU-AMU': ['Амурская область'],
  'RU-ARK': ['Архангельская область', 'Архангельская область без Ненецкого автономного округа', 'Архангельская область (без НАО)'],
  'RU-AST': ['Астраханская область'],
  'RU-BEL': ['Белгородская область'],
  'RU-BRY': ['Брянская область'],
  'RU-VLA': ['Владимирская область'],
  'RU-VGG': ['Волгоградская область'],
  'RU-VLG': ['Вологодская область'],
  'RU-VOR': ['Воронежская область'],
  'RU-IVA': ['Ивановская область'],
  'RU-IRK': ['Иркутская область'],
  'RU-KGD': ['Калининградская область'],
  'RU-KLU': ['Калужская область'],
  'RU-KEM': ['Кемеровская область - Кузбасс', 'Кемеровская область', 'Кузбасс'],
  'RU-KIR': ['Кировская область'],
  'RU-KOS': ['Костромская область'],
  'RU-KGN': ['Курганская область'],
  'RU-KRS': ['Курская область'],
  'RU-LEN': ['Ленинградская область'],
  'RU-LIP': ['Липецкая область'],
  'RU-MAG': ['Магаданская область'],
  'RU-MOS': ['Московская область'],
  'RU-MUR': ['Мурманская область'],
  'RU-NIZ': ['Нижегородская область'],
  'RU-NGR': ['Новгородская область'],
  'RU-NVS': ['Новосибирская область'],
  'RU-OMS': ['Омская область'],
  'RU-ORE': ['Оренбургская область'],
  'RU-ORL': ['Орловская область'],
  'RU-PNZ': ['Пензенская область'],
  'RU-PSK': ['Псковская область'],
  'RU-ROS': ['Ростовская область'],
  'RU-RYA': ['Рязанская область'],
  'RU-SAM': ['Самарская область'],
  'RU-SAR': ['Саратовская область'],
  'RU-SAK': ['Сахалинская область'],
  'RU-SVE': ['Свердловская область'],
  'RU-SMO': ['Смоленская область'],
  'RU-TAM': ['Тамбовская область'],
  'RU-TVE': ['Тверская область'],
  'RU-TOM': ['Томская область'],
  'RU-TUL': ['Тульская область'],
  'RU-TYU': ['Тюменская область', 'Тюменская область без автономных округов', 'Тюменская область (без автономных округов)', 'Тюменская область (без АО)'],
  'RU-ULY': ['Ульяновская область'],
  'RU-CHE': ['Челябинская область'],
  'RU-YAR': ['Ярославская область'],
  'RU-MOW': ['Москва', 'г. Москва', 'город Москва', 'город федерального значения Москва'],
  'RU-SPE': ['Санкт-Петербург', 'г. Санкт-Петербург', 'город Санкт-Петербург', 'город федерального значения Санкт-Петербург'],
  'RU-YEV': ['Еврейская автономная область', 'ЕАО'],
  'RU-NEN': ['Ненецкий автономный округ', 'Ненецкий АО', 'НАО'],
  'RU-KHM': ['Ханты-Мансийский автономный округ - Югра', 'Ханты-Мансийский автономный округ', 'Ханты-Мансийский АО - Югра', 'Ханты-Мансийский АО', 'ХМАО - Югра', 'ХМАО', 'Югра'],
  'RU-CHU': ['Чукотский автономный округ', 'Чукотский АО', 'Чукотка'],
  'RU-YAN': ['Ямало-Ненецкий автономный округ', 'Ямало-Ненецкий АО', 'ЯНАО'],
};

/** Whole-name exclusions (after normalization), with the reason shown in diagnostics. */
const EXCLUDED_EXACT: Record<string, string> = {
  'российская федерация': 'итог по стране',
  'россия': 'итог по стране',
  'рф': 'итог по стране',
  'республика крым': 'Крым не входит в 83 субъекта сайта (решение владельца)',
  'крым': 'Крым не входит в 83 субъекта сайта (решение владельца)',
  'севастополь': 'Севастополь не входит в 83 субъекта сайта (решение владельца)',
  'донецкая народная республика': 'регион 2022 г. не входит в 83 субъекта сайта',
  'днр': 'регион 2022 г. не входит в 83 субъекта сайта',
  'луганская народная республика': 'регион 2022 г. не входит в 83 субъекта сайта',
  'лнр': 'регион 2022 г. не входит в 83 субъекта сайта',
  'запорожская область': 'регион 2022 г. не входит в 83 субъекта сайта',
  'херсонская область': 'регион 2022 г. не входит в 83 субъекта сайта',
  'байконур': 'не субъект РФ',
  'цфо': 'федеральный округ', 'сзфо': 'федеральный округ', 'юфо': 'федеральный округ',
  'скфо': 'федеральный округ', 'пфо': 'федеральный округ', 'уфо': 'федеральный округ',
  'сфо': 'федеральный округ', 'дфо': 'федеральный округ',
};

/** Prefix/substring exclusions: totals and federal districts in any spelling. */
// JS `\b` is ASCII-only, so word edges are spelled out as (^|\s) / (\s|$)
const EXCLUDED_PATTERNS: Array<[RegExp, string]> = [
  [/^(всего|итого)(\s|$)/, 'строка итога'],
  [/(^|\s)по (российской федерации|рф|россии)$/, 'итог по стране'],
  [/федеральн(ый|ого) округ|(^|\s)фо$/, 'федеральный округ'],
];

const ISO_BY_NAME: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [iso, aliases] of Object.entries(REGION_ALIASES)) {
    for (const alias of aliases) {
      const key = normalizeRegionName(alias);
      const existing = map.get(key);
      if (existing && existing !== iso) throw new Error(`alias «${alias}» maps to both ${existing} and ${iso}`);
      map.set(key, iso);
    }
  }
  return map;
})();

export type NameMatch =
  | { kind: 'region'; iso: string }
  | { kind: 'excluded'; reason: string }
  | { kind: 'unmapped' };

/**
 * Classifies one subject name from a Rosleshoz dataset. 'unmapped' means a name we have never
 * seen: callers must log it (and record it in the journal) rather than silently drop it.
 */
export function classifyRosleshozName(raw: string): NameMatch {
  const name = normalizeRegionName(raw);
  if (!name) return { kind: 'excluded', reason: 'пустое название' };
  const candidates = [name, stripCityPrefix(name), stripParens(name), stripParens(stripCityPrefix(name))];
  for (const candidate of candidates) {
    const excluded = EXCLUDED_EXACT[candidate];
    if (excluded) return { kind: 'excluded', reason: excluded };
  }
  for (const [pattern, reason] of EXCLUDED_PATTERNS) {
    if (pattern.test(name)) return { kind: 'excluded', reason };
  }
  for (const candidate of candidates) {
    const iso = ISO_BY_NAME.get(candidate);
    if (iso) return { kind: 'region', iso };
  }
  return { kind: 'unmapped' };
}

/** Every ISO code the table maps to (must equal the 83 regions of the boundaries file). */
export const MAPPED_ISOS: string[] = Object.keys(REGION_ALIASES).sort();
