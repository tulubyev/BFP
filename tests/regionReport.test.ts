import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RegionsApiError, fetchRegionDetail, type HotspotYear, type Indicator, type RegionDetailResponse, type RegionSummary } from '../frontend/src/api/regions';
import RegionReport from '../frontend/src/components/regions/RegionReport';
import RegionsTable from '../frontend/src/components/regions/RegionsTable';
import RegionReportPage, { ReportNotice, ReportToolbar } from '../frontend/src/pages/RegionReportPage';
import {
  CHART_SIZE, REGIONS_TABLE_PATH, REPORT_ISO_RE, REPORT_SOURCES, formatReportDateTime, hotspotChartGeometry, hotspotChartSummary,
  hotspotTableRows, niceCeil, parseReportIso, regionReportPath, reportDocumentTitle, reportFooterText, reportGroups,
  reportLimitations, reportRow, reportSources, seriesYearsLabel,
} from '../frontend/src/utils/regionReport';
import { ISO_RE } from '../backend/services/regions/registry';
import { getSourceDefinition } from '../backend/services/sourceRegistry';

// ─── Fixture: shape of GET /api/regions/RU-IRK (backend/services/regions/indicators.ts) ───────────

const ROSLESHOZ = 'Рослесхоз, открытые данные (rosleshoz.gov.ru/opendata), лицензия открытых данных РФ';
const FIRMS = 'NASA FIRMS, годовой архив VIIRS S-NPP (standard processing), NASA open data';

const ind = (id: string, value: number | null, extra: Partial<Indicator> = {}): Indicator => ({
  id, label: id, value, unit: 'шт.', period: '2024', source: FIRMS, kind: 'satellite', definition: `определение ${id}`, ...extra,
});

const year = (y: number, vegetation: number, stat: number, per10k: number | null = 1.5): HotspotYear => ({
  year: y, vegetation, static: stat, offshore: 0, frpVegetation: 0, vegetationPer10k: per10k,
});

function detail(overrides: Partial<RegionDetailResponse> = {}): RegionDetailResponse {
  return {
    iso: 'RU-IRK',
    name: 'Иркутская область',
    areaKm2: 774846,
    baikal: true,
    indicators: [
      ind('forestland_area', 69420, { label: 'Площадь лесных земель', unit: 'тыс. га', kind: 'official', source: `${ROSLESHOZ}; набор ForestlandArea`, period: '2023' }),
      ind('woodiness', 83.4, { label: 'Лесистость', unit: '%', kind: 'official', source: `${ROSLESHOZ}; набор ForestFund`, period: 'набор от 01.03.2024' }),
      ind('wood_volume', null, { label: 'Заготовка древесины', unit: 'тыс. м³', kind: 'official', source: `${ROSLESHOZ}; набор WoodVolume`, reason: 'набор «Заготовка» недоступен: HTTP 503' }),
      ind('hotspots_vegetation', 12345, { label: 'Термоточки растительности за год' }),
      ind('hotspots_deviation_5y', 12.5, { label: 'Отклонение от среднего за 5 лет', unit: '%', period: '2024 к 2019–2023' }),
      ind('hotspots_nrt_season', 0, { label: 'Термоточки за 30 дней (NRT)', period: '30.08.2026–29.09.2026', source: 'NASA FIRMS VIIRS NRT (S-NPP, NOAA-20, NOAA-21), история сайта gis.fire_hotspots' }),
      ind('oopt_share', 3.21, { label: 'Доля ООПТ', unit: '%', kind: 'estimate', approximate: true, source: 'OpenStreetMap (ODbL) через Overpass API: полигоны ООПТ и границы субъектов' }),
      ind('cover_loss', 123456, { label: 'Потеря древесного покрова', unit: 'га', kind: 'estimate', approximate: true, period: '2024', source: 'Hansen/UMD/Google/USGS/NASA via Global Forest Watch' }),
    ],
    extraIndicators: [
      ind('reforestation', null, { label: 'Лесовосстановление', unit: 'тыс. га', kind: 'official', period: null, source: `${ROSLESHOZ}; набор ReforestationArea (только итог по России)`, reason: 'нет региональных данных' }),
    ],
    hotspotSeries: [year(2023, 800, 40, 10.32), year(2019, 1200, 55), year(2024, 12345, 120, null)],
    hotspotSeriesReason: null,
    generatedAt: '2026-09-29T06:05:00.000Z',
    archive: {
      file: 'firms-archive.2019-2024.json',
      generatedAt: '2026-09-20T00:00:00.000Z',
      years: [2019, 2020, 2021, 2022, 2023, 2024],
      source: { name: 'NASA FIRMS', urls: ['https://firms.modaps.eosdis.nasa.gov/'], license: 'NASA open data' },
    },
    boundariesFile: 'ru-regions.2026-09.geojson',
    ...overrides,
  };
}

const PRINTED = new Date('2026-09-29T08:30:00.000Z');
const html = (d: RegionDetailResponse) => renderToStaticMarkup(createElement(RegionReport, { detail: d, printedAt: PRINTED, timeZone: 'UTC' }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[\s  ]+/g, ' ');

// ─── ISO validation and paths ─────────────────────────────────────────────────

describe('parseReportIso', () => {
  it('accepts ISO 3166-2 codes of Russia, trimmed and upper-cased', () => {
    expect(parseReportIso('RU-IRK')).toEqual({ ok: true, iso: 'RU-IRK' });
    expect(parseReportIso(' ru-bu ')).toEqual({ ok: true, iso: 'RU-BU' });
  });

  it('rejects anything else before a request is made', () => {
    for (const raw of [undefined, null, '', 'IRK', 'RU-', 'RU-I', 'RU-IRKK', 'US-CA', 'RU-IR1', 'RU-IRK/../x', '<script>']) {
      const check = parseReportIso(raw as string);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error).toContain('ISO 3166-2');
    }
  });

  it('uses the same format as the backend', () => {
    expect(REPORT_ISO_RE.source).toBe(ISO_RE.source);
  });

  it('builds the report path and document title', () => {
    expect(regionReportPath('RU-IRK')).toBe('/regions/RU-IRK/report');
    expect(reportDocumentTitle('Иркутская область')).toBe('Отчёт по региону: Иркутская область — forestwatch.ru');
    expect(REGIONS_TABLE_PATH).toBe('/analytics#regions');
  });
});

// ─── Formatters ───────────────────────────────────────────────────────────────

describe('formatReportDateTime', () => {
  it('formats in ru-RU with the given time zone', () => {
    expect(formatReportDateTime('2026-09-29T06:05:00.000Z', 'UTC')).toBe('29.09.2026, 06:05');
    expect(formatReportDateTime(new Date('2026-09-29T06:05:00.000Z'), 'Asia/Irkutsk')).toBe('29.09.2026, 14:05');
  });
  it('never invents a date', () => {
    expect(formatReportDateTime(null)).toBe('дата неизвестна');
    expect(formatReportDateTime('')).toBe('дата неизвестна');
    expect(formatReportDateTime('not a date')).toBe('дата неизвестна');
  });
});

describe('reportRow / reportGroups', () => {
  it('prints null as «нет данных: <причина>», never 0', () => {
    const row = reportRow(ind('x', null, { reason: 'архив FIRMS ещё не собран', period: null }));
    expect(row).toMatchObject({ value: 'нет данных: архив FIRMS ещё не собран', missing: true, period: 'период не указан' });
    expect(reportRow(ind('x', null)).value).toBe('нет данных: причина не указана');
    expect(reportRow(ind('x', null)).value).not.toMatch(/\b0\b/);
  });

  it('keeps a real zero, units, «≈» and the kind label', () => {
    expect(reportRow(ind('x', 0)).value).toBe('0 шт.');
    const est = reportRow(ind('oopt_share', 3.21, { unit: '%', kind: 'estimate', approximate: true }));
    expect(est.value).toBe('≈ 3,21 %');
    expect(est.kindLabel).toBe('оценка');
  });

  it('groups official → satellite → estimate, includes card-only indicators, drops empty groups', () => {
    const groups = reportGroups(detail());
    expect(groups.map(g => g.title)).toEqual(['Официальные данные', 'Спутниковые наблюдения', 'Оценки']);
    expect(groups[0].rows.map(r => r.id)).toEqual(['forestland_area', 'woodiness', 'wood_volume', 'reforestation']);
    const onlySatellite = reportGroups({ indicators: [ind('a', 1)], extraIndicators: [] });
    expect(onlySatellite.map(g => g.kind)).toEqual(['satellite']);
  });
});

describe('hotspot series', () => {
  it('table rows are localized; a missing density is «нет данных»', () => {
    const rows = hotspotTableRows([year(2024, 12345, 120, null), year(2023, 800, 40, 10.325)]);
    expect(rows.map(r => r.year)).toEqual([2023, 2024]);
    expect(rows[1].vegetation.replace(/\s/g, ' ')).toBe('12 345');
    expect(rows[1].per10k).toBe('нет данных');
    expect(rows[0].per10k).toBe('10,33');
  });

  it('year range label', () => {
    expect(seriesYearsLabel([2024, 2019, 2021])).toBe('2019–2024');
    expect(seriesYearsLabel([2024])).toBe('2024');
    expect(seriesYearsLabel([])).toBeNull();
  });

  it('niceCeil rounds the axis up to a readable value', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
    expect(niceCeil(NaN)).toBe(1);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(12345)).toBe(20000);
    expect(niceCeil(2200)).toBe(2500);
    expect(niceCeil(500)).toBe(500);
  });

  it('chart geometry: years sorted, two bars per year inside the plot, heights proportional', () => {
    const g = hotspotChartGeometry([year(2024, 1000, 250), year(2019, 500, 0)]);
    expect(g.width).toBe(CHART_SIZE.width);
    expect(g.years.map(y => y.year)).toEqual([2019, 2024]);
    expect(g.bars).toHaveLength(4);
    expect(g.max).toBe(1000);
    for (const b of g.bars) {
      expect(b.x).toBeGreaterThanOrEqual(g.plot.left);
      expect(b.x + b.width).toBeLessThanOrEqual(g.plot.right);
      expect(b.y + b.height).toBeCloseTo(g.plot.bottom);
      expect(b.height).toBeGreaterThanOrEqual(0);
    }
    const h = (y: number, s: string) => g.bars.find(b => b.year === y && b.series === s)!.height;
    expect(h(2024, 'vegetation')).toBeCloseTo(g.plot.bottom - g.plot.top);
    expect(h(2019, 'vegetation')).toBeCloseTo(h(2024, 'vegetation') / 2);
    expect(h(2024, 'static')).toBeCloseTo(h(2024, 'vegetation') / 4);
    expect(h(2019, 'static')).toBe(0);
    // Every bar is labelled with its value (black-and-white print)
    expect(g.bars.map(b => b.label)).toEqual(['500', '0', '1 000'.replace(' ', ' '), '250']);
    expect(g.ticks.map(t => t.value)).toEqual([0, 250, 500, 750, 1000]);
  });

  it('an all-zero series still has a valid axis', () => {
    const g = hotspotChartGeometry([year(2020, 0, 0)]);
    expect(g.max).toBe(1);
    expect(g.bars.every(b => Number.isFinite(b.y) && b.height === 0)).toBe(true);
  });

  it('text summary for screen readers', () => {
    expect(hotspotChartSummary([])).toBe('Термоточки по годам: нет данных');
    expect(hotspotChartSummary([year(2020, 5, 1)])).toBe('Термоточки по годам. 2020: растительность 5, статичные источники 1');
  });
});

describe('sources and limitations', () => {
  it('cites the sources the indicators use, with licenses matching the source registry', () => {
    const sources = reportSources(detail());
    expect(sources.map(s => s.id)).toEqual(['rosleshoz', 'firms', 'gfw', 'osm']);
    // FIRMS license from the archive metadata when it states one
    expect(sources.find(s => s.id === 'firms')!.license).toBe('NASA open data');
    expect(REPORT_SOURCES.rosleshoz.license).toBe(getSourceDefinition('rosleshoz')!.license.name);
    expect(REPORT_SOURCES.firms.license).toBe(getSourceDefinition('firms')!.license.name);
    expect(REPORT_SOURCES.gfw.license).toBe(getSourceDefinition('gfw_loss')!.license.name);
    expect(REPORT_SOURCES.osm.license).toBe(getSourceDefinition('osm_boundaries')!.license.name);
  });

  it('always cites OSM (boundaries give the area) and nothing unused', () => {
    const sources = reportSources({ indicators: [ind('forestland_area', 1, { source: ROSLESHOZ, kind: 'official' })], extraIndicators: [], archive: null });
    expect(sources.map(s => s.id)).toEqual(['rosleshoz', 'osm']);
    expect(reportSources({ indicators: [ind('x', 1, { source: FIRMS })], extraIndicators: [], archive: null })
      .find(s => s.id === 'firms')!.license).toBe(REPORT_SOURCES.firms.license);
  });

  it('limitations: loss ≠ illegal logging, no regional reforestation, GFW estimate without a key', () => {
    const items = reportLimitations(detail());
    expect(items.join('\n')).toContain('Потеря древесного покрова ≠ незаконная рубка');
    expect(items.join('\n')).toContain('Лесовосстановление по субъектам Рослесхоз не публикует');
    expect(items.join('\n')).toContain('оценка без ключа GFW API');
    expect(items.join('\n')).toContain('NRT');
    expect(items.join('\n')).not.toContain('архив FIRMS ещё не собран');
  });

  it('limitations follow the data: live GFW loss, missing archive, no NRT indicator', () => {
    const live = detail({
      indicators: [ind('cover_loss', 5, { kind: 'satellite', source: 'Hansen/UMD/Google/USGS/NASA via Global Forest Watch (GFW Data API)' })],
      extraIndicators: [],
      archive: null,
    });
    const items = reportLimitations(live).join('\n');
    expect(items).not.toContain('без ключа');
    expect(items).toContain('данные Global Forest Watch');
    expect(items).toContain('Годовой архив FIRMS ещё не собран');
    expect(items).not.toContain('NRT');
  });

  it('footer names the data date, archive and boundaries versions', () => {
    expect(reportFooterText(detail(), PRINTED, 'UTC')).toBe(
      'Данные собраны 29.09.2026, 06:05; архив FIRMS 2019–2024 (firms-archive.2019-2024.json, собран 20.09.2026, 00:00); '
      + 'границы — ru-regions.2026-09.geojson. Отчёт сформирован 29.09.2026, 08:30.',
    );
    expect(reportFooterText(detail({ archive: null }), PRINTED, 'UTC')).toContain('; архив FIRMS не собран;');
  });
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('RegionReport (react-dom/server)', () => {
  it('title, dates, all indicator groups with badges, periods, definitions and sources', () => {
    const t = text(html(detail()));
    expect(t).toContain('Отчёт по региону: Иркутская область');
    expect(t).toContain('Отчёт сформирован: 29.09.2026, 08:30');
    expect(t).toContain('Данные собраны: 29.09.2026, 06:05');
    expect(t).toContain('RU-IRK · байкальский регион');
    for (const title of ['Официальные данные', 'Спутниковые наблюдения', 'Оценки']) expect(t).toContain(title);
    expect(t).toContain('Площадь лесных земель');
    expect(t).toContain('69 420 тыс. га');
    expect(t).toContain('набор от 01.03.2024');
    expect(t).toContain('определение woodiness');
    expect(t).toContain('Источник: Рослесхоз');
    expect(t).toContain('≈ 123 456 га');
    for (const label of ['официально', 'спутник', 'оценка']) expect(t).toContain(label);
  });

  it('null values print as «нет данных: <причина>», not 0', () => {
    const markup = html(detail());
    const t = text(markup);
    expect(t).toContain('нет данных: набор «Заготовка» недоступен: HTTP 503');
    expect(t).toContain('нет данных: нет региональных данных');
    expect(t).toContain('период не указан');
    const woodRow = markup.split('<tr').find(r => r.includes('Заготовка древесины'))!;
    expect(text(woodRow)).not.toMatch(/ 0 тыс\. м³/);
  });

  it('hotspot chart: SVG with hatched static bars, value labels, legend and data table', () => {
    const markup = html(detail());
    expect(markup).toContain('<svg');
    expect(markup).toMatch(/<pattern id="hatch-[A-Za-z0-9_-]+"/);
    expect(markup).toMatch(/fill="url\(#hatch-[A-Za-z0-9_-]+\)"/);
    expect(markup).toContain('role="img"');
    const t = text(markup);
    expect(t).toContain('Термоточки по годам');
    expect(t).toContain('(2019–2024)');
    expect(t).toContain('сплошная заливка');
    expect(t).toContain('штриховка');
    expect(t).toContain('Ряд 2019–2024, шт.');
    expect(t).toContain('12 345');
    // Table rows in year order
    const table = text(markup.slice(markup.indexOf('Ряд 2019')));
    expect(table.indexOf(' 2019 ')).toBeLessThan(table.indexOf(' 2023 '));
    expect(table.indexOf(' 2023 ')).toBeLessThan(table.indexOf(' 2024 '));
  });

  it('empty series shows the reason instead of a chart', () => {
    const markup = html(detail({ hotspotSeries: [], hotspotSeriesReason: 'архив FIRMS ещё не собран', archive: null }));
    expect(markup).not.toContain('<svg viewBox');
    expect(text(markup)).toContain('Нет данных: архив FIRMS ещё не собран');
  });

  it('limitations with a link to /methodology, sources with licenses, footer with the data date', () => {
    const markup = html(detail());
    const t = text(markup);
    expect(t).toContain('Ограничения и методология');
    expect(markup).toContain('href="/methodology"');
    expect(t).toContain('Потеря древесного покрова ≠ незаконная рубка');
    expect(t).toContain('Источники и лицензии');
    expect(t).toContain('ODbL 1.0');
    expect(t).toContain('CC BY 4.0');
    expect(t).toContain('Открытые данные РФ (CC0)');
    expect(t).toContain('© участники OpenStreetMap');
    expect(markup).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(t).toContain('границы — ru-regions.2026-09.geojson');
  });

  it('API strings are text, not markup', () => {
    const markup = html(detail({ name: '<img src=x onerror=alert(1)>' }));
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img');
  });

  it('marks print-sensitive blocks for the print stylesheet', () => {
    const markup = html(detail());
    expect(markup).toContain('report-sheet');
    expect(markup).toContain('report-row');
    expect(markup).toContain('<thead>');
  });
});

describe('page shell', () => {
  const inRouter = (el: React.ReactElement, path = '/') => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, el));

  it('toolbar: print button and way back, both hidden in print', () => {
    const markup = inRouter(createElement(ReportToolbar, { ready: true }));
    expect(text(markup)).toContain('Печать / сохранить как PDF');
    expect(markup).toContain('print:hidden');
    expect(markup).toContain(`href="${REGIONS_TABLE_PATH}"`);
    expect(inRouter(createElement(ReportToolbar, { ready: false }))).toContain('disabled');
  });

  it('invalid ISO: message and link to the table, no request', () => {
    const fetchSpy = jest.fn();
    (globalThis as any).fetch = fetchSpy;
    const markup = inRouter(
      createElement(Routes, null, createElement(Route, { path: '/regions/:iso/report', element: createElement(RegionReportPage) })),
      '/regions/XX-1/report',
    );
    expect(text(markup)).toContain('Субъект не найден');
    expect(text(markup)).toContain('ожидается ISO 3166-2');
    expect(markup).toContain(`href="${REGIONS_TABLE_PATH}"`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('valid ISO renders the loading state first', () => {
    const markup = inRouter(
      createElement(Routes, null, createElement(Route, { path: '/regions/:iso/report', element: createElement(RegionReportPage) })),
      '/regions/RU-IRK/report',
    );
    expect(text(markup)).toContain('Загрузка отчёта');
  });

  it('notice escapes its message', () => {
    expect(inRouter(createElement(ReportNotice, { title: 't', message: '<b>x</b>' }))).toContain('&lt;b&gt;');
  });
});

describe('links to the report', () => {
  it('each table row links to its report', () => {
    const regions: RegionSummary[] = [
      { iso: 'RU-IRK', name: 'Иркутская область', areaKm2: 1, baikal: true, indicators: [] },
      { iso: 'RU-TOM', name: 'Томская область', areaKm2: 1, baikal: false, indicators: [] },
    ];
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RegionsTable, { regions, onSelect: () => {} })));
    expect(markup).toContain('href="/regions/RU-IRK/report"');
    expect(markup).toContain('href="/regions/RU-TOM/report"');
    expect(markup.match(/Отчёт для печати/g)).toHaveLength(2);
  });
});

describe('fetchRegionDetail errors', () => {
  afterEach(() => { delete (globalThis as any).fetch; });

  it('carries the status and the backend message', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Субъект RU-XX не входит в 83 субъекта сайта' }) });
    const err = await fetchRegionDetail('RU-XX').catch(e => e);
    expect(err).toBeInstanceOf(RegionsApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Субъект RU-XX не входит в 83 субъекта сайта');
  });

  it('falls back to the HTTP status when the body is not JSON', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => { throw new Error('html'); } });
    const err = await fetchRegionDetail('RU-IRK').catch(e => e);
    expect(err.status).toBe(503);
    expect(err.message).toBe('HTTP 503');
  });
});
