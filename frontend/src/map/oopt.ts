/**
 * ООПТ (protected areas, OSM/Overpass, ODbL): pure helpers shared by the Leaflet layer and tests.
 * Geometry itself (Polygon/MultiPolygon, occasionally a Point fallback for degraded relations)
 * comes from the API — this module only covers styling and popup content.
 */

export type OoptKind = 'strict_reserve' | 'national_park';

export interface OoptProps {
  id: number;
  name: string;
  name_ru: string | null;
  protect_class: string | null;
  boundary: string | null;
  /** Label point, guaranteed to fall inside the geometry. */
  lat: number;
  lon: number;
  wikidata: string | null;
  website: string | null;
  area_ha: number | null;
  osm_url: string;
}

export interface OoptStyle {
  color: string;
  weight: number;
  opacity: number;
  fill: boolean;
  fillColor: string;
  fillOpacity: number;
}

/** Below this zoom a reserve's polygon can be only a few pixels across — a marker keeps it visible. */
export const OOPT_MARKER_MAX_ZOOM = 6;

export function ooptKind(p: Pick<OoptProps, 'boundary'>): OoptKind {
  return p.boundary === 'national_park' ? 'national_park' : 'strict_reserve';
}

export function ooptColor(kind: OoptKind): string {
  return kind === 'national_park' ? '#8b5cf6' : '#10b981';
}

export function ooptStyle(p: Pick<OoptProps, 'boundary'>): OoptStyle {
  const color = ooptColor(ooptKind(p));
  return { color, weight: 1.6, opacity: 0.85, fill: true, fillColor: color, fillOpacity: 0.18 };
}

export function ooptMarkerVisible(zoom: number): boolean {
  return zoom < OOPT_MARKER_MAX_ZOOM;
}

/** #rrggbb → rgba(r,g,b,alpha), for the marker's inline styles (matches the polygon color). */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function describeOopt(p: OoptProps): { title: string; typeLabel: string; classLabel: string; areaText: string | null } {
  const typeLabel = ooptKind(p) === 'national_park' ? '🌿 Национальный парк' : '🏔 Заповедник';
  const classLabel =
    p.protect_class === '1' ? 'Ia/Ib (строго охраняемый)' : p.protect_class === '2' ? 'II (нацпарк)' : p.protect_class ?? '—';
  const areaText = p.area_ha ? `${Math.round(p.area_ha).toLocaleString('ru-RU')} га` : null;
  return { title: p.name, typeLabel, classLabel, areaText };
}
