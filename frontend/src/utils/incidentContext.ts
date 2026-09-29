/** Pure helpers for the «Место» rows about nearby roads and settlements (tested in tests/incidentContextUi.test.ts). */
import type { IncidentContextResponse, NearestRoad, NearestSettlement } from '../api/incidentContext';

const HIGHWAY_LABELS: Record<string, string> = {
  motorway: 'автомагистраль',
  trunk: 'магистральная дорога',
  primary: 'дорога первого класса',
  secondary: 'дорога второго класса',
  tertiary: 'дорога третьего класса',
  unclassified: 'местная дорога',
  residential: 'улица',
  living_street: 'жилая улица',
  road: 'дорога',
  motorway_link: 'съезд автомагистрали',
  trunk_link: 'съезд',
  primary_link: 'съезд',
  secondary_link: 'съезд',
  tertiary_link: 'съезд',
  track: 'грунтовая или лесная дорога',
};

const PLACE_LABELS: Record<string, string> = {
  city: 'город',
  town: 'город или посёлок',
  village: 'село или посёлок',
  hamlet: 'малый населённый пункт',
};

export const highwayLabel = (highway: string) => HIGHWAY_LABELS[highway] ?? 'дорога';
export const placeLabel = (place: string) => PLACE_LABELS[place] ?? 'населённый пункт';

/** «3,2 км», «0,4 км», «12 км»; under 100 m — «менее 0,1 км» (the point is rounded to ≈ 100 m). */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km)) return '—';
  if (km < 0.1) return 'менее 0,1 км';
  return `${km.toLocaleString('ru-RU', { maximumFractionDigits: km < 10 ? 1 : 0 })} км`;
}

/** «Р-255 «Сибирь» (магистральная дорога)», «дорога третьего класса». */
export function roadName(road: NearestRoad): string {
  const label = highwayLabel(road.highway);
  const title = [road.ref, road.name ? `«${road.name}»` : null].filter(Boolean).join(' ');
  return title ? `${title} (${label})` : label;
}

function roadText(road: NearestRoad | null, radiusKm: number, what: string): string {
  if (!road) return `${what} в радиусе ${radiusKm} км по OSM не найдено`;
  return `${roadName(road)} в ${formatDistanceKm(road.distance_km)} (${road.direction})`;
}

export interface ContextRow {
  label: string;
  text: string;
  /** Link to the object in OSM, when there is one. */
  href?: string;
  /** Small print under the row. */
  hint?: string;
}

export function roadRow(road: NearestRoad | null, radiusKm: number): ContextRow {
  return { label: 'Ближайшая дорога', text: roadText(road, radiusKm, 'Дорог'), href: road?.osm_url };
}

export function pavedRoadRow(road: NearestRoad | null, radiusKm: number): ContextRow {
  const row: ContextRow = {
    label: 'Ближайшая дорога с твёрдым покрытием', text: roadText(road, radiusKm, 'Дорог с твёрдым покрытием'), href: road?.osm_url,
  };
  if (road?.paved_by_class) row.hint = 'покрытие в OSM не указано — принято по классу дороги';
  return row;
}

export function trackRow(road: NearestRoad | null, radiusKm: number): ContextRow {
  return { label: 'Ближайшая грунтовая дорога', text: roadText(road, radiusKm, 'Грунтовых и лесных дорог'), href: road?.osm_url };
}

export function settlementRow(place: NearestSettlement | null, radiusKm: number): ContextRow {
  if (!place) return { label: 'Ближайший населённый пункт', text: `Населённых пунктов в радиусе ${radiusKm} км по OSM не найдено` };
  const name = place.name ? `${placeLabel(place.place)} «${place.name}»` : `${placeLabel(place.place)} без названия`;
  return {
    label: 'Ближайший населённый пункт',
    text: `${name} в ${formatDistanceKm(place.distance_km)} (${place.direction})`,
    href: place.osm_url,
  };
}

/** The rows in display order: road, paved road, track, settlement. */
export function contextRows(data: IncidentContextResponse): ContextRow[] {
  return [
    roadRow(data.nearest_road, data.radius_km),
    pavedRoadRow(data.nearest_paved_road, data.radius_km),
    trackRow(data.nearest_track, data.radius_km),
    settlementRow(data.nearest_settlement, data.radius_km),
  ];
}

/** «По OSM, приблизительно: … · данные OSM на 28.09.2026 · © участники OpenStreetMap, ODbL 1.0». */
export function contextNote(data: IncidentContextResponse): string {
  const d = new Date(data.data_date);
  const date = Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
  const note = data.note ? data.note.charAt(0).toUpperCase() + data.note.slice(1) : '';
  return [note, date ? `данные OSM на ${date}` : null, data.license].filter(Boolean).join(' · ');
}
