import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IncidentContextResponse, NearestRoad, NearestSettlement } from '../frontend/src/api/incidentContext';
import { incidentContextUrl } from '../frontend/src/api/incidentContext';
import { ContextBody } from '../frontend/src/components/IncidentContext';
import {
  contextNote, contextRows, formatDistanceKm, highwayLabel, pavedRoadRow, placeLabel, roadName, roadRow, settlementRow, trackRow,
} from '../frontend/src/utils/incidentContext';

const road = (o: Partial<NearestRoad> = {}): NearestRoad => ({
  osm_id: 1001, osm_url: 'https://www.openstreetmap.org/way/1001', highway: 'tertiary', name: 'Ключевская', ref: null,
  surface: 'gravel', paved: false, paved_by_class: false, distance_km: 2, bearing_deg: 90, direction: 'на восток', ...o,
});
const village: NearestSettlement = {
  osm_id: 2001, osm_type: 'node', osm_url: 'https://www.openstreetmap.org/node/2001', place: 'village', name: 'Ключи',
  distance_km: 4.8, bearing_deg: 43, direction: 'на северо-восток',
};
const data = (o: Partial<IncidentContextResponse> = {}): IncidentContextResponse => ({
  success: true, incident_id: 42, point: { lat: 52.3, lon: 104.2 }, radius_km: 15,
  nearest_road: road(),
  nearest_paved_road: road({ osm_id: 1003, osm_url: 'https://www.openstreetmap.org/way/1003', highway: 'primary', name: null, ref: '25К-011', surface: null, paved: true, paved_by_class: true, distance_km: 6.1, bearing_deg: 180, direction: 'на юг' }),
  nearest_track: road({ osm_id: 1004, highway: 'track', name: null, distance_km: 0.3, direction: 'на запад' }),
  nearest_settlement: village,
  data_date: '2026-09-28T21:14:03Z', fetched_at: '2026-09-29T10:00:00.000Z',
  source: 'OpenStreetMap через Overpass API', license: '© участники OpenStreetMap, ODbL 1.0',
  note: 'по OSM, приблизительно: расстояние по прямой от центра события', ...o,
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('labels and distances', () => {
  it('formats distances in Russian, never below the rounding of the point', () => {
    expect(formatDistanceKm(3.2)).toBe('3,2 км');
    expect(formatDistanceKm(12.4)).toBe('12 км');
    expect(formatDistanceKm(0.3)).toBe('0,3 км');
    expect(formatDistanceKm(0)).toBe('менее 0,1 км');
    expect(formatDistanceKm(NaN)).toBe('—');
  });

  it('names road classes and settlement types in Russian with a fallback', () => {
    expect(highwayLabel('trunk')).toBe('магистральная дорога');
    expect(highwayLabel('track')).toBe('грунтовая или лесная дорога');
    expect(highwayLabel('weird')).toBe('дорога');
    expect(placeLabel('village')).toBe('село или посёлок');
    expect(placeLabel('x')).toBe('населённый пункт');
  });

  it('road name: ref and name, else the class', () => {
    expect(roadName(road({ highway: 'trunk', ref: 'Р-255', name: 'Сибирь' }))).toBe('Р-255 «Сибирь» (магистральная дорога)');
    expect(roadName(road({ ref: null, name: 'Ключевская' }))).toBe('«Ключевская» (дорога третьего класса)');
    expect(roadName(road({ ref: null, name: null, highway: 'track' }))).toBe('грунтовая или лесная дорога');
  });
});

describe('rows', () => {
  it('«Ближайшая дорога: … в N км (на …)» with an OSM link', () => {
    expect(roadRow(road(), 15)).toEqual({
      label: 'Ближайшая дорога', text: '«Ключевская» (дорога третьего класса) в 2 км (на восток)', href: 'https://www.openstreetmap.org/way/1001',
    });
  });

  it('paved road taken by class says so', () => {
    const row = pavedRoadRow(data().nearest_paved_road, 15);
    expect(row.text).toBe('25К-011 (дорога первого класса) в 6,1 км (на юг)');
    expect(row.hint).toMatch(/покрытие в OSM не указано/);
    expect(pavedRoadRow(road({ paved: true, surface: 'asphalt' }), 15).hint).toBeUndefined();
  });

  it('settlement with type, name, distance and direction; unnamed ones are not invented', () => {
    expect(settlementRow(village, 15).text).toBe('село или посёлок «Ключи» в 4,8 км (на северо-восток)');
    expect(settlementRow({ ...village, name: null, place: 'hamlet' }, 15).text).toBe('малый населённый пункт без названия в 4,8 км (на северо-восток)');
  });

  it('nothing nearby: «не найдено по OSM» within the radius, no numbers and no link', () => {
    for (const row of [roadRow(null, 15), pavedRoadRow(null, 15), trackRow(null, 15), settlementRow(null, 15)]) {
      expect(row.text).toMatch(/в радиусе 15 км по OSM не найдено$/);
      expect(row.href).toBeUndefined();
    }
  });

  it('four rows in order and a note with the OSM date and licence', () => {
    expect(contextRows(data()).map(r => r.label)).toEqual([
      'Ближайшая дорога', 'Ближайшая дорога с твёрдым покрытием', 'Ближайшая грунтовая дорога', 'Ближайший населённый пункт',
    ]);
    expect(contextNote(data())).toBe('По OSM, приблизительно: расстояние по прямой от центра события · данные OSM на 28.09.2026 · © участники OpenStreetMap, ODbL 1.0');
    expect(contextNote(data({ data_date: 'bad' }))).not.toMatch(/данные OSM на/);
  });
});

describe('ContextBody', () => {
  it('loading and error states like the other rows of «Место»', () => {
    expect(text(renderToStaticMarkup(createElement(ContextBody, { state: { status: 'loading' } })))).toContain('Ищем ближайшие дороги и населённые пункты');
    const html = text(renderToStaticMarkup(createElement(ContextBody, { state: { status: 'error', error: 'Сервис OpenStreetMap (Overpass) не ответил вовремя' } })));
    expect(html).toContain('Дороги и населённые пункты: нет данных (Сервис OpenStreetMap (Overpass) не ответил вовремя)');
    expect(html).not.toMatch(/\d+ км/);
  });

  it('renders the rows with OSM links opened safely', () => {
    const html = renderToStaticMarkup(createElement(ContextBody, { state: { status: 'ready', data: data() } }));
    const t = text(html);
    expect(t).toContain('Ближайшая дорога: «Ключевская» (дорога третьего класса) в 2 км (на восток)');
    expect(t).toContain('Ближайший населённый пункт: село или посёлок «Ключи» в 4,8 км (на северо-восток)');
    expect(t).toContain('покрытие в OSM не указано');
    expect(t).toContain('ODbL');
    expect(html).toContain('href="https://www.openstreetmap.org/node/2001"');
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(4);
  });

  it('escapes names from OSM (text nodes, no HTML injection)', () => {
    const html = renderToStaticMarkup(createElement(ContextBody, {
      state: { status: 'ready', data: data({ nearest_settlement: { ...village, name: '<img src=x onerror=alert(1)>' } }) },
    }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('asks the right endpoint', () => {
    expect(incidentContextUrl(42)).toBe('/api/monitoring/forest-changes/42/context');
  });
});
