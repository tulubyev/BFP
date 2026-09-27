/** Pure helpers for the incident card's mini-map and OOPT line (tested in tests/incidentCardUi.test.ts). */
import type { Incident } from '../api/incidents';
import type { IncidentHotspot, OoptProximity } from '../api/incidentHotspots';

const SATELLITES: Record<string, string> = {
  N: 'Suomi NPP',
  N20: 'NOAA-20',
  N21: 'NOAA-21',
};

const CONFIDENCE: Record<string, string> = {
  h: 'высокая', high: 'высокая', n: 'средняя', nominal: 'средняя', l: 'низкая', low: 'низкая',
};

export const satelliteName = (code: string) => SATELLITES[code] ?? (code || '—');

const dateTimeUtc = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
};

/** Tooltip rows of one hotspot: satellite, time (UTC as FIRMS gives it), FRP, confidence. */
export function hotspotRows(h: IncidentHotspot): [string, string][] {
  const rows: [string, string][] = [
    ['Спутник', `${satelliteName(h.satellite)} VIIRS`],
    ['Время', dateTimeUtc(h.acquired_at)],
    ['FRP', h.frp == null ? '—' : `${h.frp.toLocaleString('ru-RU')} МВт`],
  ];
  if (h.confidence) rows.push(['Достоверность', CONFIDENCE[h.confidence.toLowerCase()] ?? h.confidence]);
  return rows;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type LatLngTuple = [number, number];

/** Incident bbox as Leaflet bounds [[south, west], [north, east]], or null. */
export function incidentBounds(incident: Incident): [LatLngTuple, LatLngTuple] | null {
  const [s, w, n, e] = [incident.bbox_min_lat, incident.bbox_min_lng, incident.bbox_max_lat, incident.bbox_max_lng].map(num);
  if (s === null || w === null || n === null || e === null) return null;
  return [[s, w], [n, e]];
}

export function incidentCenter(incident: Incident): LatLngTuple | null {
  const lat = num(incident.center_lat);
  const lng = num(incident.center_lng);
  return lat === null || lng === null ? null : [lat, lng];
}

/** Bounds to fit: bbox, hotspots and centre together; null with nothing to show. */
export function miniMapBounds(incident: Incident, hotspots: IncidentHotspot[] = []): [LatLngTuple, LatLngTuple] | null {
  const points: LatLngTuple[] = hotspots.map(h => [h.lat, h.lon]);
  const bbox = incidentBounds(incident);
  if (bbox) points.push(...bbox);
  const center = incidentCenter(incident);
  if (center) points.push(center);
  if (!points.length) return null;
  const lats = points.map(p => p[0]);
  const lngs = points.map(p => p[1]);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}

const formatKm = (km: number) =>
  `${km.toLocaleString('ru-RU', { maximumFractionDigits: km < 10 ? 1 : 0 })} км`;

const quoted = (name: string) => `«${name}»`;

/**
 * The OOPT line of the card: «Внутри ООПТ «…»», «В 3,2 км от ООПТ «…»» or «ООПТ в радиусе 50 км
 * нет», always with the data date and the approximate-borders note. «нет данных» without data.
 */
export function ooptLine(oopt: OoptProximity | null | undefined, error?: string): { text: string; note: string } {
  if (!oopt) return { text: 'Нет данных', note: error ?? 'Данные об ООПТ временно недоступны' };
  const d = new Date(oopt.data_date);
  const date = Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU');
  const note = [date ? `данные ООПТ на ${date}` : null, `${oopt.note}; расстояние от центра события`]
    .filter(Boolean).join(', ');
  const r = oopt.result;
  if (r.relation === 'inside') return { text: `Внутри ООПТ ${quoted(r.name)}`, note };
  if (r.relation === 'near') return { text: `В ${formatKm(r.distance_km)} от ООПТ ${quoted(r.name)}`, note };
  return { text: `ООПТ в радиусе ${r.radius_km} км нет`, note };
}

/** «Термоточек: 42» or «Показаны первые 500 термоточек» when the list was cut. */
export function hotspotsCaption(count: number, truncated: boolean, limit: number): string {
  if (truncated) return `Показаны первые ${limit} термоточек (по времени)`;
  return count ? `Термоточек на карте: ${count}` : 'Термоточек в пределах контура не найдено';
}

/** Link to the incident on the big map (map state in the URL, part L keeps /?lat&lng&incident working). */
export function bigMapUrl(incident: Incident): string | null {
  const center = incidentCenter(incident);
  if (!center) return null;
  const params = new URLSearchParams({ lat: String(center[0]), lng: String(center[1]), incident: String(incident.id) });
  return `/?${params}`;
}
