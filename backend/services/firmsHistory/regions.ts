/**
 * Region lookup for FIRMS incidents: point-in-polygon against the OSM region boundaries that the
 * frontend already ships (public/data/boundaries/ru-regions.<YYYY-MM>.geojson).
 * Pure helpers plus a small file loader; only the Baikal regions are kept in memory.
 */
import fs from 'fs';
import path from 'path';

/** Regions whose hotspots become incidents (future.md: Baikal focus). */
export const BAIKAL_REGION_ISOS = ['RU-IRK', 'RU-BU', 'RU-ZAB'] as const;

type Ring = number[][];
type PolygonCoords = Ring[];

export interface RegionShape {
  iso: string;
  name: string;
  /** Polygons of the region, each as [outer ring, ...holes] with [lon, lat] positions. */
  polygons: PolygonCoords[];
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
}

export interface LatLonBbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Ray casting; `ring` is a closed or open list of [lon, lat]. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, polygon: PolygonCoords): boolean {
  if (!polygon.length || !pointInRing(lon, lat, polygon[0])) return false;
  return !polygon.slice(1).some(hole => pointInRing(lon, lat, hole));
}

function bboxOf(polygons: PolygonCoords[]): LatLonBbox {
  const b = { minLat: Infinity, minLon: Infinity, maxLat: -Infinity, maxLon: -Infinity };
  for (const poly of polygons) {
    for (const [lon, lat] of poly[0] ?? []) {
      b.minLat = Math.min(b.minLat, lat);
      b.maxLat = Math.max(b.maxLat, lat);
      b.minLon = Math.min(b.minLon, lon);
      b.maxLon = Math.max(b.maxLon, lon);
    }
  }
  return b;
}

/** Extracts the wanted regions (by `properties.iso`) from a boundaries FeatureCollection. */
export function regionsFromGeoJSON(collection: any, isos: readonly string[] = BAIKAL_REGION_ISOS): RegionShape[] {
  const wanted = new Set(isos);
  const shapes: RegionShape[] = [];
  for (const f of collection?.features ?? []) {
    const iso = f?.properties?.iso;
    if (!wanted.has(iso)) continue;
    const g = f.geometry;
    const polygons: PolygonCoords[] = g?.type === 'Polygon' ? [g.coordinates]
      : g?.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polygons.length) continue;
    shapes.push({ iso, name: String(f.properties.name ?? iso), polygons, bbox: bboxOf(polygons) });
  }
  return shapes;
}

export function findRegion(lat: number, lon: number, regions: RegionShape[]): RegionShape | null {
  for (const r of regions) {
    const b = r.bbox;
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) continue;
    if (r.polygons.some(p => pointInPolygon(lon, lat, p))) return r;
  }
  return null;
}

/** Bounding box around all regions — the cheap prefilter for the database query. */
export function unionBbox(regions: RegionShape[]): LatLonBbox | null {
  if (!regions.length) return null;
  return regions.reduce<LatLonBbox>((acc, r) => ({
    minLat: Math.min(acc.minLat, r.bbox.minLat),
    minLon: Math.min(acc.minLon, r.bbox.minLon),
    maxLat: Math.max(acc.maxLat, r.bbox.maxLat),
    maxLon: Math.max(acc.maxLon, r.bbox.maxLon),
  }), { ...regions[0].bbox });
}

const REGIONS_FILE_RE = /^ru-regions\.(\d{4}-\d{2})\.geojson$/;

/** Newest `ru-regions.<YYYY-MM>.geojson` among file names, or null. */
export function pickNewestRegionsFile(names: string[]): string | null {
  const matches = names.filter(n => REGIONS_FILE_RE.test(n)).sort();
  return matches.length ? matches[matches.length - 1] : null;
}

/**
 * Where the boundaries live: `public/` next to `dist/` in the Docker image (vite build output),
 * `frontend/public/` in a dev checkout.
 */
export const BOUNDARY_DIRS = [
  path.resolve(__dirname, '../../../public/data/boundaries'),
  path.resolve(__dirname, '../../../frontend/public/data/boundaries'),
];

let loaded: { file: string; regions: RegionShape[] } | null = null;

/** Loads (once) the Baikal regions from the newest boundaries file in `dirs`; throws if none is found. */
export function loadBaikalRegions(dirs: string[] = BOUNDARY_DIRS): { file: string; regions: RegionShape[] } {
  if (loaded) return loaded;
  let best: { name: string; file: string } | null = null;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const newest = pickNewestRegionsFile(names);
    if (newest && (!best || newest > best.name)) best = { name: newest, file: path.join(dir, newest) };
  }
  if (!best) throw new Error(`ru-regions.*.geojson not found in ${dirs.join(', ')}`);
  const regions = regionsFromGeoJSON(JSON.parse(fs.readFileSync(best.file, 'utf8')));
  if (regions.length !== BAIKAL_REGION_ISOS.length) {
    throw new Error(`${best.name}: expected ${BAIKAL_REGION_ISOS.join(', ')}, found ${regions.map(r => r.iso).join(', ') || 'none'}`);
  }
  loaded = { file: best.file, regions };
  return loaded;
}
