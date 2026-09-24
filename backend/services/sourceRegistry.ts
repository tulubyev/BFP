/**
 * Registry of the external (and one internal) data sources actually integrated by the app.
 * Static metadata only — freshness and load history live in sourceStatus.ts / utils/journal.ts.
 */

export type SourceId =
  | 'firms'
  | 'oopt'
  | 'rosleshoz'
  | 'gfw_loss'
  | 'gfw_dist'
  | 'gfw_cover'
  | 'osm_boundaries'
  | 'postgis';

export interface SourceLicense {
  name: string;
  url: string;
}

export interface SourceDefinition {
  id: SourceId;
  name: string;
  owner: string;
  license: SourceLicense;
  homepage: string;
  updateFrequency: string;
  spatialResolution: string;
  coverage: string;
  limitations: string[];
  /** Has a runtime freshness signal (sourceStatus.ts can compute an age); static sources don't. */
  monitored: boolean;
}

export const SOURCE_REGISTRY: SourceDefinition[] = [
  {
    id: 'firms',
    name: 'NASA FIRMS — тепловые точки VIIRS',
    owner: 'NASA / University of Maryland',
    license: { name: 'Открытые данные NASA (без ограничений)', url: 'https://firms.modaps.eosdis.nasa.gov/' },
    homepage: 'https://firms.modaps.eosdis.nasa.gov/',
    updateFrequency: 'Публичные CSV обновляются NASA каждые ~3 часа; фон приложения — раз в 30 минут',
    spatialResolution: 'VIIRS 375 м',
    coverage: 'Suomi NPP, NOAA-20, NOAA-21; окно 24 часа; вся территория России (bbox 19–190° в.д., 40–82° с.ш.)',
    limitations: [
      'Публичные CSV не проходят повторную калибровку — возможны ложные срабатывания на промышленных объектах и бликах',
      'При недоступности всех трёх CSV сервис отдаёт последний удачный набор из Redis, а не пустой список',
    ],
    monitored: true,
  },
  {
    id: 'oopt',
    name: 'ООПТ России — OpenStreetMap / Overpass API',
    owner: 'OpenStreetMap contributors',
    license: { name: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' },
    homepage: 'https://overpass-api.de/',
    updateFrequency: 'OSM меняется непрерывно; фон приложения запрашивает Overpass раз в сутки',
    spatialResolution: 'Точки (центроиды границ)',
    coverage: '~150 заповедников и национальных парков России (area-запрос по ISO3166-1=RU)',
    limitations: [
      'overpass-api.de часто перегружен и отвечает 504 — фон делает до 3 попыток с задержкой 20с',
      'Пустой ответ Overpass никогда не заменяет последний удачный список',
      'Названия и границы — как в OSM, могут отличаться от официального реестра Минприроды',
    ],
    monitored: true,
  },
  {
    id: 'rosleshoz',
    name: 'Рослесхоз — открытые данные',
    owner: 'Федеральное агентство лесного хозяйства',
    license: { name: 'Открытые данные РФ (CC0)', url: 'https://rosleshoz.gov.ru/opendata/' },
    homepage: 'https://rosleshoz.gov.ru/opendata/',
    updateFrequency: 'Наборы обновляются Рослесхозом нерегулярно; фон приложения перескачивает их раз в 12 часов',
    spatialResolution: 'Табличные данные по субъектам РФ (не пространственные)',
    coverage: '13 CSV-наборов: заготовка древесины, лесной фонд, лесовосстановление, пожары, санитарные рубки и др.',
    limitations: [
      'Актуальный файл каждого набора резолвится через meta.csv на каждый запрос; при недоступности meta.csv используется последний известный файл',
      'Наборы о пожарах (ForesFundFires, ForesFundFiresArea, RegisterForestFires, FireCover, MineralizedStrips) не обновлялись источником с 2024-05',
    ],
    monitored: true,
  },
  {
    id: 'gfw_loss',
    name: 'Global Forest Watch — потери лесного покрова (Hansen/UMD)',
    owner: 'University of Maryland / Google / USGS / NASA, через Global Forest Watch',
    license: { name: 'CC BY 4.0', url: 'https://www.globalforestwatch.org/' },
    homepage: 'https://www.globalforestwatch.org/',
    updateFrequency: 'Ежегодно (GFW публикует новый год потерь)',
    spatialResolution: '30 м, растровые плитки 512 px',
    coverage: 'v1.13, годы 2001–2025 (кодируются как B = год − 2000)',
    limitations: [
      'Версия набора (v1.13) зашита в коде — переход на новый год требует ручного обновления после публикации GFW',
      'Показывает только годовые потери, без внутригодовой динамики',
    ],
    monitored: false,
  },
  {
    id: 'gfw_dist',
    name: 'Global Forest Watch — DIST-ALERT (нарушения лесного покрова)',
    owner: 'University of Maryland, через Global Forest Watch',
    license: { name: 'CC BY 4.0', url: 'https://www.globalforestwatch.org/' },
    homepage: 'https://www.globalforestwatch.org/',
    updateFrequency: 'Обновляется еженедельно; версия резолвится раз в 6 часов через редирект latest → vYYYYMMDD',
    spatialResolution: '~30 м, растровые плитки 256 px',
    coverage: 'Глобально, скользящее окно ~2 года',
    limitations: [
      'Хранит только последние ~2 года наблюдений — более старые нарушения этим источником не восстановить',
      'Если GFW не отдаёт редирект на новую версию, прокси продолжает использовать последнюю известную версию',
    ],
    monitored: true,
  },
  {
    id: 'gfw_cover',
    name: 'Global Forest Watch — сомкнутость лесного покрова 2000 г. (Hansen/UMD)',
    owner: 'University of Maryland, через Global Forest Watch',
    license: { name: 'CC BY 4.0', url: 'https://www.globalforestwatch.org/' },
    homepage: 'https://www.globalforestwatch.org/',
    updateFrequency: 'Статичный базовый год, не обновляется',
    spatialResolution: '30 м, растровые плитки 512 px',
    coverage: 'Глобально, порог сомкнутости ≥30% (tcd_30), версия v1.8',
    limitations: ['Показывает состояние 2000 года — используется только как подложка для слоя потерь, не как текущие данные'],
    monitored: false,
  },
  {
    id: 'osm_boundaries',
    name: 'Административные границы — OpenStreetMap (Geofabrik)',
    owner: 'OpenStreetMap contributors',
    license: { name: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' },
    homepage: 'https://download.geofabrik.de/russia.html',
    updateFrequency: 'Пересобираются ежеквартально (scripts/boundaries/build.sh)',
    spatialResolution: 'Векторные полигоны, упрощение 1e-4, ≤300 КБ gzip на файл',
    coverage: '83 субъекта РФ (admin_level 4) + районы Иркутской области, Бурятии и Забайкальского края (admin_level 6)',
    limitations: [
      'Собираются офлайн из выгрузки Geofabrik, а не запросом в реальном времени — свежесть ограничена частотой пересборки',
      'Крым, Севастополь и регионы 2022 года не включены (решение владельца)',
    ],
    monitored: false,
  },
  {
    id: 'postgis',
    name: 'Локальная база — PostgreSQL/PostGIS',
    owner: 'ForestWatch (собственная база, схема gis)',
    license: { name: 'Внутренние данные проекта', url: 'https://forestwatch.ru' },
    homepage: 'https://forestwatch.ru',
    updateFrequency: 'По мере записи (сиды и операции мониторинга)',
    spatialResolution: 'Полигоны/точки как загружены в таблицы gis.*',
    coverage: 'forest_areas, forest_changes, fire_hotspots, monitoring_zones, alerts, reports и справочники',
    limitations: ['Не внешний источник со своей свежестью — хранилище собственных данных и результатов расчётов'],
    monitored: false,
  },
];

export function getSourceDefinition(id: string): SourceDefinition | undefined {
  return SOURCE_REGISTRY.find(s => s.id === id);
}
