/**
 * Administrative boundaries (OSM, ODbL): pure helpers shared by the Leaflet layer and tests.
 * Data files are built by scripts/boundaries/build.sh.
 */

export type BoundaryKind = 'region' | 'district';

export interface BoundaryProps {
  osm_id: number;
  name: string;
  kind: BoundaryKind;
  iso?: string;
  parent?: string;
  parent_iso?: string;
  /** Label anchor [lon, lat], guaranteed inside the polygon. */
  label: [number, number];
}

export type BoundaryFile = 'ru-regions' | 'baikal-districts';

export interface BoundaryStyle {
  color: string;
  weight: number;
  opacity: number;
  dashArray?: string;
  fill: boolean;
  fillColor: string;
  fillOpacity: number;
}

const DISTRICTS_MIN_ZOOM = 6;
const LABEL_MIN_ZOOM: Record<BoundaryKind, number> = { region: 5, district: 8 };

export function districtsVisible(zoom: number): boolean {
  return zoom >= DISTRICTS_MIN_ZOOM;
}

export function labelVisible(kind: BoundaryKind, zoom: number): boolean {
  return zoom >= LABEL_MIN_ZOOM[kind];
}

export function boundaryStyle(kind: BoundaryKind, hovered = false): BoundaryStyle {
  // fill stays on (transparent) so the whole polygon reacts to hover and click
  const base: BoundaryStyle = kind === 'region'
    ? { color: '#e2e8f0', weight: 1.4, opacity: 0.75, fill: true, fillColor: '#facc15', fillOpacity: 0 }
    : { color: '#94a3b8', weight: 0.9, opacity: 0.8, dashArray: '4 3', fill: true, fillColor: '#facc15', fillOpacity: 0 };
  return hovered ? { ...base, color: '#facc15', weight: base.weight + 1.2, opacity: 1, fillOpacity: 0.06 } : base;
}

export function describeBoundary(p: BoundaryProps): { title: string; rows: Array<[string, string]>; osmUrl: string | null } {
  const rows: Array<[string, string]> = p.kind === 'region'
    ? [['Тип', 'Субъект РФ'], ['Код ISO', p.iso ?? '—']]
    : [['Тип', 'Муниципальное образование'], ['Субъект РФ', p.parent ?? '—']];
  const osmUrl = Number.isInteger(p.osm_id) && p.osm_id > 0
    ? `https://www.openstreetmap.org/relation/${p.osm_id}`
    : null;
  return { title: p.name, rows, osmUrl };
}

export function boundaryFileUrl(base: string, file: BoundaryFile, version: string): string {
  return `${base.replace(/\/+$/, '')}/data/boundaries/${file}.${version}.geojson`;
}
