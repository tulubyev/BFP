import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXPORT_LIMIT, filenameFromDisposition, incidentsExportUrl, regionsExportUrl } from '../frontend/src/api/export';
import MethodologySections from '../frontend/src/methodology/MethodologySections';
import { METHODOLOGY, STATIC_HISTORY_DAYS } from '../frontend/src/methodology/params';
import SourcesList from '../frontend/src/methodology/SourcesList';
import { freshnessText, type MethodologySource } from '../frontend/src/methodology/sources';
import { SourcesSection } from '../frontend/src/pages/MethodologyPage';
import { EXPORT_LIMIT as BACKEND_EXPORT_LIMIT } from '../backend/services/export/provenance';
import { CLUSTER_DISTANCE_KM, VIIRS_PIXEL_HA, VIIRS_PIXEL_KM } from '../backend/services/firmsHistory/clusters';
import {
  INACTIVE_AFTER_HOURS, INCIDENT_METHOD, MATCH_DISTANCE_KM, WINDOW_HOURS,
} from '../backend/services/firmsHistory/incidents';
import { BAIKAL_REGION_ISOS } from '../backend/services/firmsHistory/regions';
import {
  STATIC_MASK_METHOD, STATIC_MIN_DAYS, STATIC_MIN_SPAN_DAYS, STATIC_RADIUS_KM, STATIC_WINDOW_DAYS,
} from '../backend/services/firmsHistory/staticSources';
import { GFW_CODE_TO_ISO } from '../backend/services/regions/gfwRegions';
import { DEFINITIONS } from '../backend/services/regions/indicators';
import { DEVIATION_WINDOW_YEARS, PER_AREA_KM2 } from '../backend/services/regions/math';
import { BAIKAL_ISOS, EXPECTED_REGION_COUNT } from '../backend/services/regions/registry';
import { SOURCE_REGISTRY } from '../backend/services/sourceRegistry';
import { AOI_MARGIN, MAX_AOI_KM, MIN_AOI_KM } from '../backend/services/imagery/geometry';
import {
  DNBR_THRESHOLDS, INDEX_PIXEL_M, MIN_VALID_FRACTION, NDVI_RENDER_MAX, NDVI_RENDER_MIN, SITE_PAD_KM,
} from '../backend/services/imagery/indices';
import { SWIR_MAX_REFLECTANCE } from '../backend/services/imagery/render';
import {
  BEFORE_DAYS, MAX_CANDIDATES, MAX_NODATA_FRACTION, MAX_SEARCH_CLOUD_COVER, MIN_CLEAR_FRACTION,
} from '../backend/services/imagery/selection';
import {
  SERIES_FIRST_YEAR, SUMMER_LABEL, SUMMER_WINDOW, YEAR_TTL_CURRENT_SEC, YEAR_TTL_PAST_SEC,
} from '../backend/services/imagery/series';

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('methodology numbers match the code', () => {
  it('FIRMS incidents', () => {
    expect(METHODOLOGY.firms.method).toBe(INCIDENT_METHOD);
    expect(METHODOLOGY.firms.incidentRegions).toEqual([...BAIKAL_REGION_ISOS]);
    expect(METHODOLOGY.firms.incidentRegions).toEqual(BAIKAL_ISOS);
    expect(METHODOLOGY.firms.clusterDistanceKm).toBe(CLUSTER_DISTANCE_KM);
    expect(METHODOLOGY.firms.matchDistanceKm).toBe(MATCH_DISTANCE_KM);
    expect(METHODOLOGY.firms.windowHours).toBe(WINDOW_HOURS);
    expect(METHODOLOGY.firms.inactiveAfterHours).toBe(INACTIVE_AFTER_HOURS);
    expect(METHODOLOGY.firms.pixelM).toBe(VIIRS_PIXEL_KM * 1000);
    expect(METHODOLOGY.firms.pixelHa).toBe(VIIRS_PIXEL_HA);
    expect(SOURCE_REGISTRY.find(s => s.id === 'firms')?.coverage).toContain(`окно ${METHODOLOGY.firms.mapLayerHours} часа`);
  });

  it('static source mask', () => {
    expect(METHODOLOGY.staticMask.method).toBe(STATIC_MASK_METHOD);
    expect(METHODOLOGY.staticMask.minDays).toBe(STATIC_MIN_DAYS);
    expect(METHODOLOGY.staticMask.windowDays).toBe(STATIC_WINDOW_DAYS);
    expect(METHODOLOGY.staticMask.minSpanDays).toBe(STATIC_MIN_SPAN_DAYS);
    expect(METHODOLOGY.staticMask.radiusM).toBe(STATIC_RADIUS_KM * 1000);
    expect(STATIC_HISTORY_DAYS).toBe(8);
  });

  it('regional analytics and export', () => {
    expect(METHODOLOGY.regions.count).toBe(EXPECTED_REGION_COUNT);
    expect(METHODOLOGY.regions.densityPerKm2).toBe(PER_AREA_KM2);
    expect(METHODOLOGY.regions.deviationYears).toBe(DEVIATION_WINDOW_YEARS);
    expect(METHODOLOGY.regions.gfwEstimateRegions).toBe(Object.keys(GFW_CODE_TO_ISO).length);
    expect(DEFINITIONS.coverLoss).toContain(`среднее ${METHODOLOGY.regions.gfwShareYears}`);
    expect(METHODOLOGY.export.limit).toBe(BACKEND_EXPORT_LIMIT);
    expect(EXPORT_LIMIT).toBe(BACKEND_EXPORT_LIMIT);
  });

  it('Sentinel-2 scenes, indices and the summer series', () => {
    const m = METHODOLOGY.imagery;
    expect(m.beforeDays).toBe(BEFORE_DAYS);
    expect(m.maxSearchCloudPct).toBe(MAX_SEARCH_CLOUD_COVER);
    expect(m.maxCandidates).toBe(MAX_CANDIDATES);
    expect(m.minClearPct).toBe(MIN_CLEAR_FRACTION * 100);
    expect(m.maxNodataPct).toBe(MAX_NODATA_FRACTION * 100);
    expect(m.aoiMinKm).toBe(MIN_AOI_KM);
    expect(m.aoiMaxKm).toBe(MAX_AOI_KM);
    expect(AOI_MARGIN).toBeGreaterThan(1); // «с запасом»
    expect(m.swirMax).toBe(SWIR_MAX_REFLECTANCE);
    expect(m.indexPixelM).toBe(INDEX_PIXEL_M);
    expect(m.minValidPct).toBe(MIN_VALID_FRACTION * 100);
    expect(m.dnbr).toEqual(DNBR_THRESHOLDS);
    expect(m.ndviMin).toBe(NDVI_RENDER_MIN);
    expect(m.ndviMax).toBe(NDVI_RENDER_MAX);
    expect(m.seriesFirstYear).toBe(SERIES_FIRST_YEAR);
    expect(m.seriesWindow).toBe(SUMMER_LABEL);
    expect(SUMMER_WINDOW).toEqual({ start: '07-01', end: '08-31' });
    expect(m.yearCachePastDays).toBe(YEAR_TTL_PAST_SEC / 86_400);
    expect(m.yearCacheCurrentDays).toBe(YEAR_TTL_CURRENT_SEC / 86_400);
    // «расширенный на половину пикселя VIIRS»
    expect(SITE_PAD_KM * 2 * 1000).toBe(METHODOLOGY.firms.pixelM);
  });
});

describe('methodology sections', () => {
  const html = text(renderToStaticMarkup(createElement(MethodologySections)));

  it('quotes the method parameters from METHODOLOGY', () => {
    expect(html).toContain('firms-cluster-v1');
    expect(html).toContain('static-mask-v1');
    expect(html).toContain('RU-IRK, RU-BU, RU-ZAB');
    expect(html).toContain(`последние ${WINDOW_HOURS} ч`);
    expect(html).toContain(`не дальше ${CLUSTER_DISTANCE_KM} км`);
    expect(html).toContain(`через ${INACTIVE_AFTER_HOURS} ч без новых точек`);
    expect(html).toContain('375 м × 14,06 га');
    expect(html).toContain(`радиусе ${STATIC_RADIUS_KM * 1000} м`);
    expect(html).toContain(`в ${STATIC_MIN_DAYS} и более разных дня за последние ${STATIC_WINDOW_DAYS} дней`);
    expect(html).toContain(`не меньше ${STATIC_MIN_SPAN_DAYS} дней`);
    expect(html).toContain(`не меньше ${STATIC_MIN_SPAN_DAYS + 1} дней накопленной истории`);
    expect(html).toContain('type = 2');
    expect(html).toContain(`Слой термоточек за ${METHODOLOGY.firms.mapLayerHours} ч`);
    expect(html).toContain(`${EXPECTED_REGION_COUNT} субъекта`);
    expect(html).toMatch(/на 10\s000 км²/);
    expect(html).toContain(`за ${DEVIATION_WINDOW_YEARS} предыдущих полных лет`);
    expect(html).toContain(`для ${Object.keys(GFW_CODE_TO_ISO).length} лесных субъектов`);
    expect(html).toMatch(/не больше\s+5\s000 записей/);
  });

  it('describes Sentinel-2 scenes, indices and the series with the code numbers', () => {
    const m = METHODOLOGY.imagery;
    expect(html).toContain('Снимки и индексы Sentinel-2');
    expect(html).toContain(`не меньше ${MIN_AOI_KM} км`);
    expect(html).toContain(`квадрат ${MAX_AOI_KM} км`);
    expect(html).toContain(`за ${BEFORE_DAYS} дней до первой термоточки`);
    expect(html).toContain(`меньше ${MAX_SEARCH_CLOUD_COVER} %`);
    expect(html).toContain(`до ${MAX_CANDIDATES} кандидатов`);
    expect(html).toContain(`не меньше ${MIN_CLEAR_FRACTION * 100} % чистых пикселей`);
    expect(html).toContain(`не больше ${MAX_NODATA_FRACTION * 100} %`);
    expect(html).toContain('до 0,4 растянуто');
    expect(html).toContain('NDVI = (B8A − B04) / (B8A + B04)');
    expect(html).toContain('NBR = (B8A − B12) / (B8A + B12)');
    expect(html).toContain('dNBR = NBR до − NBR после');
    expect(html).toContain(`одной сетке ${INDEX_PIXEL_M} м`);
    expect(html).toContain(`меньше ${MIN_VALID_FRACTION * 100} %`);
    expect(html).toContain('меньше 0,10 — не горело');
    expect(html).toContain('0,10–0,27 — низкая');
    expect(html).toContain('0,27–0,44 — умеренно-низкая');
    expect(html).toContain('0,44–0,66 — умеренно-высокая');
    expect(html).toContain('0,66 и больше — высокая');
    expect(html).toContain('от −0,20 (коричневый)');
    expect(html).toContain('до 0,90');
    expect(html).toContain(`с ${SERIES_FIRST_YEAR} по текущий`);
    expect(html).toContain(`за ${SUMMER_LABEL}`);
    expect(html).toContain(`хранятся ${m.yearCachePastDays} дней, текущий — ${m.yearCacheCurrentDays} дней`);
    expect(html).toContain('не полевое обследование');
    expect(html).not.toContain('раздел будет дополнен');
  });

  it('says what the data does not mean', () => {
    expect(html).toContain('Термоточка — не подтверждённый пожар');
    expect(html).toContain('Потеря покрова ≠ незаконная рубка');
    expect(html).toContain('Крым, Севастополь и регионы 2022 г. не включены');
    expect(html).toContain('Индексы — спутниковая оценка для проверки, а не полевые данные');
  });

  it('has no number that is not a known parameter', () => {
    const m = METHODOLOGY.imagery;
    const allowed = new Set([
      '375', '14,06', '72', '2', '48', '500', '4', '14', '7', '8', '83', '10 000', '5', '2015', '2022', '5 000', '20', '30',
      // «Suomi NPP, NOAA-20, NOAA-21», «type = 2», «регионы 2022 г.», «× 100 %»
      '21', '100', '24',
      // Sentinel-2 section: every number from METHODOLOGY.imagery; «Sentinel-2», «Collection 1», «1 июля – 31 августа»
      ...[m.beforeDays, m.maxSearchCloudPct, m.maxCandidates, m.minClearPct, m.maxNodataPct, m.aoiMinKm, m.aoiMaxKm,
        m.indexPixelM, m.minValidPct, m.seriesFirstYear, m.yearCachePastDays, m.yearCacheCurrentDays].map(String),
      ...[...Object.values(m.dnbr), m.ndviMin, m.ndviMax].map(v => Math.abs(v).toFixed(2).replace('.', ',')),
      '0,4', '1', '31',
    ]);
    const numbers = html
      .replace(/NOAA-2[01]|firms-cluster-v1|static-mask-v1|B04|B08|B8A|B12|Sentinel-2/g, '')
      .match(/\d[\d\s,]*\d|\d/g) ?? [];
    const unknown = numbers.map(n => n.trim()).filter(n => !allowed.has(n.replace(/\s/g, ' ')));
    expect(unknown).toEqual([]);
  });
});

const fixture: MethodologySource[] = [
  {
    id: 'firms', name: 'NASA FIRMS — тепловые точки VIIRS', owner: 'NASA / University of Maryland',
    license: { name: 'Открытые данные NASA (без ограничений)', url: 'https://firms.modaps.eosdis.nasa.gov/' },
    homepage: 'https://firms.modaps.eosdis.nasa.gov/', updateFrequency: 'каждые ~3 часа', spatialResolution: 'VIIRS 375 м',
    coverage: 'Россия', limitations: ['Возможны ложные срабатывания'], cadence: null, state: 'fresh',
    freshness: { timestamp: '2026-09-27T11:40:00Z', ageMs: 20 * 60 * 1000 },
  },
  {
    id: 'osm_boundaries', name: 'Административные границы — OpenStreetMap', owner: 'OpenStreetMap contributors',
    license: { name: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' }, homepage: 'https://download.geofabrik.de/',
    updateFrequency: 'ежеквартально', spatialResolution: 'полигоны', coverage: '83 субъекта', limitations: [],
    cadence: null, state: 'unknown', freshness: null,
  },
];

describe('sources section', () => {
  it('renders every source of the fixture with license, owner and freshness', () => {
    const html = renderToStaticMarkup(createElement(SourcesList, { sources: fixture }));
    expect(html).toContain('NASA FIRMS — тепловые точки VIIRS');
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain('ODbL 1.0');
    expect(html).toContain('OpenStreetMap contributors');
    expect(html).toContain('Возможны ложные срабатывания');
    expect(html).toContain('данные актуальны, 20 мин назад');
    expect(html).toContain('свежесть не отслеживается');
    expect((html.match(/<li id="source-/g) ?? []).length).toBe(2);
  });

  it('shows loading and «нет данных» states instead of an empty list', () => {
    expect(text(renderToStaticMarkup(createElement(SourcesSection, { state: { status: 'loading' } })))).toContain('Загрузка реестра источников');
    expect(text(renderToStaticMarkup(createElement(SourcesSection, { state: { status: 'error', message: 'HTTP 500' } }))))
      .toContain('Нет данных: реестр источников недоступен (HTTP 500)');
    expect(renderToStaticMarkup(createElement(SourcesSection, { state: { status: 'ready', sources: fixture } }))).toContain('source-firms');
  });

  it('the fixture has the shape of the real registry', () => {
    const keys = ['id', 'name', 'owner', 'license', 'homepage', 'updateFrequency', 'spatialResolution', 'coverage', 'limitations'];
    for (const def of SOURCE_REGISTRY) for (const key of keys) expect(def).toHaveProperty(key);
    expect(freshnessText({ ...fixture[0], state: 'failed', freshness: null })).toBe('источник недоступен');
  });
});

describe('export URLs', () => {
  it('carry the page filters without pagination', () => {
    const url = incidentsExportUrl('geojson', { type: 'fire', region: 'Иркутская область', sort: 'area_desc', staticSources: 'include', page: 3, limit: 12 });
    const [path, query] = url.split('?');
    expect(path).toBe('/api/export/incidents.geojson');
    const params = new URLSearchParams(query);
    expect(Object.fromEntries(params)).toEqual({ change_type: 'fire', region: 'Иркутская область', static_sources: 'include', sort: 'area_desc' });
    expect(incidentsExportUrl('csv')).toBe('/api/export/incidents.csv?sort=date_desc');
    expect(regionsExportUrl('json')).toBe('/api/export/regions.json');
  });

  it('reads the file name from Content-Disposition', () => {
    expect(filenameFromDisposition('attachment; filename="forestwatch-incidents-2026-09-27.csv"', 'x.csv')).toBe('forestwatch-incidents-2026-09-27.csv');
    expect(filenameFromDisposition(null, 'x.csv')).toBe('x.csv');
  });
});
