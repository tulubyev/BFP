/**
 * Registry of the 83 regions the site covers, read from the newest ru-regions.<YYYY-MM>.geojson
 * (the same file the map ships). Crimea, Sevastopol and the 2022 regions are not in that file —
 * the owner's decision (CLAUDE.md).
 */
import fs from 'fs';
import path from 'path';
import area from '@turf/area';
import { pickNewestRegionsFile, regionsFromGeoJSON, type RegionShape } from '../firmsHistory/regions';

export interface RegionEntry {
  iso: string;
  /** Short OSM name, e.g. «Бурятия». */
  name: string;
  /** Polygon area (@turf/area, geodesic) in km², rounded to 1 km². */
  areaKm2: number;
  shape: RegionShape;
}

export interface RegionRegistry {
  /** Boundaries file name, e.g. ru-regions.2026-09.geojson. */
  file: string;
  regions: RegionEntry[];
  byIso: Map<string, RegionEntry>;
}

export const EXPECTED_REGION_COUNT = 83;

/** Regions pinned on top of every list (future.md: Baikal focus). */
export const BAIKAL_ISOS = ['RU-IRK', 'RU-BU', 'RU-ZAB'];

/** ISO 3166-2:RU code shape; checked before any registry lookup. */
export const ISO_RE = /^RU-[A-Z]{2,3}$/;

export function registryFromGeoJSON(file: string, collection: any): RegionRegistry {
  const isos: string[] = (collection?.features ?? [])
    .map((f: any) => f?.properties?.iso)
    .filter((iso: unknown): iso is string => typeof iso === 'string' && ISO_RE.test(iso));
  const shapes = regionsFromGeoJSON(collection, isos);
  const regions = shapes.map(shape => {
    const geometry: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: shape.polygons };
    return {
      iso: shape.iso,
      name: shape.name,
      areaKm2: Math.round(area({ type: 'Feature', properties: {}, geometry }) / 1e6),
      shape,
    };
  });
  return { file, regions, byIso: new Map(regions.map(r => [r.iso, r])) };
}

/** Same locations as the other boundary readers: Docker image first, then the dev checkout. */
export const BOUNDARY_DIRS = [
  path.resolve(__dirname, '../../../public/data/boundaries'),
  path.resolve(__dirname, '../../../frontend/public/data/boundaries'),
];

let loaded: RegionRegistry | null = null;

/** Loads (once) the newest boundaries file; throws when none is found or it lacks regions. */
export function loadRegionRegistry(dirs: string[] = BOUNDARY_DIRS): RegionRegistry {
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
  const registry = registryFromGeoJSON(best.name, JSON.parse(fs.readFileSync(best.file, 'utf8')));
  if (registry.regions.length !== EXPECTED_REGION_COUNT) {
    throw new Error(`${best.name}: expected ${EXPECTED_REGION_COUNT} regions, found ${registry.regions.length}`);
  }
  loaded = registry;
  return loaded;
}
