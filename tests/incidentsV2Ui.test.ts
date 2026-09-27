/** Incidents feed and card, part K of spec 2026-09-27-incidents-v2-map-state-design. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_SORT, SORTS, feedFilters, feedStateFromParams, hasActiveFilters, parseDate, parsePeriod, parseSort, parseSource,
  parseStatus, periodRange, sourceLabel, updateFeedParams,
} from '../frontend/src/utils/incidentFeed';
import { buildIncidentQuery, type Incident } from '../frontend/src/api/incidents';
import { incidentsExportUrl } from '../frontend/src/api/export';
import { incidentTitle, probableCause } from '../frontend/src/utils/incidents';
import {
  bigMapUrl, hotspotRows, hotspotsCaption, incidentBounds, miniMapBounds, ooptLine, satelliteName,
} from '../frontend/src/utils/incidentHotspots';
import type { OoptProximity } from '../frontend/src/api/incidentHotspots';
import IncidentCard from '../frontend/src/components/IncidentCard';
import { FOREST_CHANGES_SORT_COLUMNS, SOURCE_RE } from '../backend/services/forestChangesQuery';

const NOW = new Date('2026-09-27T10:00:00Z');
const params = (q: string) => new URLSearchParams(q);

describe('feed URL parsing', () => {
  it('offers exactly the sorts the API whitelists', () => {
    expect(SORTS.map(s => s.value)).toEqual(Object.keys(FOREST_CHANGES_SORT_COLUMNS));
    expect(parseSort('confidence_desc')).toBe('confidence_desc');
    expect(parseSort('bogus')).toBe(DEFAULT_SORT);
    expect(parseSort(null)).toBe(DEFAULT_SORT);
  });

  it('drops invalid values', () => {
    expect(parsePeriod('30')).toBe('30');
    expect(parsePeriod('31')).toBeUndefined();
    expect(parseStatus('inactive')).toBe('inactive');
    expect(parseStatus('static_source')).toBeUndefined();
    expect(parseSource('firms')).toBe('firms');
    expect(parseSource("firms' --")).toBeUndefined();
    for (const s of ['firms', 'Sentinel-2 L2A', 'gfw.dist', '', ' ', "a'b", 'x'.repeat(51), 'огонь']) {
      expect(parseSource(s) !== undefined).toBe(SOURCE_RE.test(s.trim()));
    }
    expect(parseDate('2026-02-29')).toBeUndefined();
    expect(parseDate('2028-02-29')).toBe('2028-02-29');
  });

  it('turns the last N days into a start date that includes today (UTC)', () => {
    expect(periodRange('7', undefined, undefined, NOW)).toEqual({ startDate: '2026-09-21' });
    expect(periodRange('30', undefined, undefined, NOW)).toEqual({ startDate: '2026-08-29' });
    expect(periodRange('90', undefined, undefined, NOW)).toEqual({ startDate: '2026-06-30' });
    expect(periodRange(undefined, '2026-01-01', undefined, NOW)).toEqual({});
  });

  it('uses from/to for a custom period, swapping a reversed pair', () => {
    expect(periodRange('custom', '2026-09-01', '2026-09-10', NOW)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-10' });
    expect(periodRange('custom', '2026-09-10', '2026-09-01', NOW)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-10' });
    expect(periodRange('custom', '2026-09-01', undefined, NOW)).toEqual({ startDate: '2026-09-01', endDate: undefined });
  });

  it('maps the whole page URL to API filters', () => {
    const state = feedStateFromParams(params('type=fire&region=Бурятия&sort=confidence_desc&period=7&status=active&source=firms&static=include&page=3&id=5'));
    expect(state.page).toBe(3);
    expect(feedFilters(state, NOW)).toEqual({
      type: 'fire', region: 'Бурятия', sort: 'confidence_desc', status: 'active', source: 'firms', staticSources: 'include',
      startDate: '2026-09-21',
    });
    expect(hasActiveFilters(state)).toBe(true);
    expect(hasActiveFilters(feedStateFromParams(params('sort=area_desc&page=2')))).toBe(false);
  });
});

describe('the feed and its export share the filters', () => {
  const state = feedStateFromParams(params('period=custom&from=2026-09-01&to=2026-09-20&status=inactive&source=firms&sort=confidence_asc&region=Иркутская область'));
  const filters = feedFilters(state, NOW);

  it('sends every filter to the API under its API name', () => {
    const q = buildIncidentQuery({ ...filters, page: 2, limit: 12 });
    expect(Object.fromEntries(q)).toEqual({
      region: 'Иркутская область', start_date: '2026-09-01', end_date: '2026-09-20', status: 'inactive', source: 'firms',
      sort: 'confidence_asc', limit: '12', offset: '12',
    });
  });

  it('builds the export URL from the same filters, without pagination', () => {
    const url = new URL(incidentsExportUrl('csv', filters), 'https://forestwatch.ru');
    const feed = buildIncidentQuery(filters);
    feed.delete('limit');
    feed.delete('offset');
    expect(url.pathname).toBe('/api/export/incidents.csv');
    expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(feed));
    expect(url.searchParams.get('status')).toBe('inactive');
    expect(url.searchParams.get('start_date')).toBe('2026-09-01');
  });

  it('asks for one incident by id', () => {
    expect(buildIncidentQuery({ id: 42, staticSources: 'include', limit: 1 }).get('id')).toBe('42');
  });
});

describe('updateFeedParams', () => {
  it('sets and clears values, returns to page 1 and keeps the open card', () => {
    const next = updateFeedParams(params('page=3&id=7&status=active'), 'status', '');
    expect(next.toString()).toBe('id=7');
    expect(updateFeedParams(params('page=3'), 'page', '4').get('page')).toBe('4');
  });

  it('drops custom dates when leaving the custom period', () => {
    const next = updateFeedParams(params('period=custom&from=2026-09-01&to=2026-09-10'), 'period', '30');
    expect(next.toString()).toBe('period=30');
    expect(updateFeedParams(params('period=custom&from=2026-09-01'), 'to', '2026-09-10').toString())
      .toBe('period=custom&from=2026-09-01&to=2026-09-10');
  });
});

const firms = (over: Partial<Incident> = {}, meta: Record<string, unknown> = {}): Incident => ({
  id: 42, forest_area_id: null, change_type: 'fire', detected_date: '2026-09-25', region: 'Иркутская область',
  confidence: '0.40', area_ha: '28.12', source: 'firms', satellite: 'N20,N21', center_lat: '52.3', center_lng: '104.2',
  bbox_min_lat: '52.29', bbox_min_lng: '104.19', bbox_max_lat: '52.31', bbox_max_lng: '104.21',
  metadata: { method: 'firms-cluster-v1', status: 'active', first_seen: '2026-09-25T02:10:00Z', last_seen: '2026-09-25T05:00:00Z', hotspot_count: 4, ...meta },
  ...over,
});

describe('neutral title', () => {
  it('calls a FIRMS cluster hotspots, with region and date', () => {
    expect(incidentTitle(firms(), 'Пожар')).toBe('Термоточки NASA FIRMS, Иркутская область, 25.09.2026');
    expect(incidentTitle(firms({ region: null }), 'Пожар')).toBe('Термоточки NASA FIRMS, 25.09.2026');
  });

  it('keeps the type label for other incidents', () => {
    const seed = { ...firms(), metadata: {} } as Incident;
    expect(incidentTitle(seed, 'Вырубка')).toBe('Вырубка');
    expect(probableCause(seed)).toBeNull();
  });

  it('gives the probable cause by status', () => {
    expect(probableCause(firms())).toContain('пожар растительности');
    expect(probableCause(firms({}, { status: 'inactive' }))).toContain('пожар растительности');
    expect(probableCause(firms({}, { status: 'static_source' }))).toContain('постоянный источник тепла');
  });

  it('is what the feed card shows instead of «Пожар»', () => {
    const html = renderToStaticMarkup(createElement(IncidentCard, { incident: firms(), onClick: () => undefined }));
    expect(html).toContain('Термоточки NASA FIRMS');
    expect(html).not.toContain('>Пожар<');
    expect(html).toContain('40%');
  });
});

describe('mini-map helpers', () => {
  it('reads the bbox and fits bbox, centre and hotspots together', () => {
    expect(incidentBounds(firms())).toEqual([[52.29, 104.19], [52.31, 104.21]]);
    expect(incidentBounds(firms({ bbox_max_lng: null }))).toBeNull();
    const h = { lat: 52.35, lon: 104.1, satellite: 'N', acquired_at: '2026-09-25T02:10:00Z', confidence: 'h', frp: 5 };
    expect(miniMapBounds(firms(), [h])).toEqual([[52.29, 104.1], [52.35, 104.21]]);
    expect(miniMapBounds(firms({ bbox_min_lat: null, center_lat: null }))).toBeNull();
  });

  it('describes a hotspot: satellite, UTC time, FRP, confidence', () => {
    expect(satelliteName('N')).toBe('Suomi NPP');
    expect(satelliteName('N21')).toBe('NOAA-21');
    const rows = hotspotRows({ lat: 1, lon: 2, satellite: 'N20', acquired_at: '2026-09-25T02:10:00Z', confidence: 'h', frp: 12.5 });
    expect(rows[0]).toEqual(['Спутник', 'NOAA-20 VIIRS']);
    expect(rows[1][1]).toMatch(/02:10.*UTC$/);
    expect(rows[2]).toEqual(['FRP', '12,5 МВт']);
    expect(rows[3]).toEqual(['Достоверность', 'высокая']);
    expect(hotspotRows({ lat: 1, lon: 2, satellite: 'X', acquired_at: 'bad', confidence: null, frp: null })).toEqual([
      ['Спутник', 'X VIIRS'], ['Время', '—'], ['FRP', '—'],
    ]);
  });

  it('captions the list, saying when it was cut', () => {
    expect(hotspotsCaption(42, false, 500)).toBe('Термоточек на карте: 42');
    expect(hotspotsCaption(500, true, 500)).toBe('Показаны первые 500 термоточек (по времени)');
    expect(hotspotsCaption(0, false, 500)).toBe('Термоточек в пределах контура не найдено');
  });

  it('links to the big map with the current /?lat&lng&incident format', () => {
    expect(bigMapUrl(firms())).toBe('/?lat=52.3&lng=104.2&incident=42');
    expect(bigMapUrl(firms({ center_lat: null }))).toBeNull();
  });
});

describe('OOPT line', () => {
  const base = { data_date: '2026-09-26T03:00:00.000Z', note: 'по границам OSM, приблизительно', source: 'OSM', point: 'center' as const };
  const ref = { id: 1, name: 'Прибайкальский', osm_url: 'u', protect_class: '2', boundary: 'national_park' };

  it('says inside / N km from / none within 50 km, with the data date and the note', () => {
    const inside = ooptLine({ ...base, result: { relation: 'inside', ...ref } });
    expect(inside.text).toBe('Внутри ООПТ «Прибайкальский»');
    expect(inside.note).toContain('данные ООПТ на 26.09.2026');
    expect(inside.note).toContain('по границам OSM, приблизительно');
    expect(ooptLine({ ...base, result: { relation: 'near', distance_km: 3.2, ...ref } }).text).toBe('В 3,2 км от ООПТ «Прибайкальский»');
    expect(ooptLine({ ...base, result: { relation: 'near', distance_km: 27.6, ...ref } }).text).toBe('В 28 км от ООПТ «Прибайкальский»');
    expect(ooptLine({ ...base, result: { relation: 'none', radius_km: 50 } } as OoptProximity).text).toBe('ООПТ в радиусе 50 км нет');
  });

  it('says «нет данных» without data, never a guess', () => {
    expect(ooptLine(null, 'Данные об ООПТ временно недоступны')).toEqual({ text: 'Нет данных', note: 'Данные об ООПТ временно недоступны' });
    expect(ooptLine(undefined).text).toBe('Нет данных');
  });
});

describe('source filter labels', () => {
  it('names known sources and shows unknown ones as stored', () => {
    expect(sourceLabel('firms')).toBe('NASA FIRMS (термоточки)');
    expect(sourceLabel('Sentinel-2')).toBe('Sentinel-2');
  });
});
