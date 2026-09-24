/**
 * Overpass API Service — fetches ООПТ (protected areas) for Russia from OSM data as polygons.
 * Data is © OpenStreetMap contributors, ODbL licence.
 * https://www.openstreetmap.org/copyright
 *
 * Query design: `out geom` on the relations directly (no separate `>` recursion query) — Overpass
 * embeds each way member's coordinates inline in the relation's `members` array whenever it has
 * them, which is the case for these boundary relations. Ring assembly and simplification then
 * happen here (see osmRings.ts / geoSimplify.ts) rather than pulling in osmtogeojson.
 */
import axios from 'axios';
import { cached, warm } from '../utils/cache';
import { buildMultiPolygon, type WayGeometryMember } from '../utils/osmRings';
import { simplifyFeatureGeometry } from '../utils/geoSimplify';
import area from '@turf/area';
import pointOnFeature from '@turf/point-on-feature';

// overpass.openstreetmap.fr answers 403 or empty results; the bbox query pulled in non-Russian parks
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
// v2: polygons instead of point centers — bumped so an old point-shaped cache entry is never reused
export const OOPT_KEY = 'oopt:ru:v2';
const OOPT_TTL_SEC = 3 * 24 * 60 * 60; // refreshed daily in the background
// Keeps ~150 features' worth of polygons under ~1.5 MB gzipped; see geoSimplify.ts
const MAX_VERTICES_PER_RING = 300;

// OSM area filter for Russia (precise, no false positives).
const QUERY_AREA = `[out:json][timeout:180];
area["ISO3166-1"="RU"][admin_level="2"]->.russia;
(
  relation(area.russia)["boundary"="national_park"]["name"];
  relation(area.russia)["boundary"="protected_area"]["protect_class"="1"]["name"];
);
out geom qt;`;

export interface OOPTFeature {
  id: number;
  name: string;
  name_ru: string | null;
  protect_class: string | null;
  boundary: string | null;
  /** Label point, guaranteed to fall inside the geometry — used for the low-zoom marker. */
  lat: number;
  lon: number;
  wikidata: string | null;
  website: string | null;
  area_ha: number | null;
  osm_url: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point;
}

export interface OOPTResult {
  features: OOPTFeature[];
  source: string;
  fetchedAt: string;
}

/**
 * Filter to Russian territory.
 * Russia's borders are complex — we use a combination of bbox + heuristics.
 * Main rule: must have a Russian-language name AND be within Russia's approximate shape.
 */
function isLikelyRussia(lat: number, lon: number, tags: Record<string, string>): boolean {
  if (lat > 82 || lat < 41) return false;
  if (lon < 19 || lon > 180) return false;

  const nameRu = tags['name:ru'] || '';
  const name = tags['name'] || '';
  const hasCyrillic = /[Ѐ-ӿ]/.test(nameRu) || /[Ѐ-ӿ]/.test(name);
  // Reject if primary name has Georgian, Armenian, or Latin-only script
  const hasGeorgian = /[Ⴀ-ჿ]/.test(name);
  const hasArmenian = /[԰-֏]/.test(name);
  if (hasGeorgian || hasArmenian) return false;

  // South Caucasus exclusion zone: lat < 44, lon 37-51 → Georgia, Armenia, Azerbaijan
  if (lat < 44 && lon >= 37 && lon <= 51) return false;
  // Exclude Baltic states / Belarus / Ukraine (west, lat 48-60, lon 19-37)
  if (lat < 60 && lon < 37 && !hasCyrillic) return false;
  // Exclude Norway/Scandinavia (high lat, very low lon)
  if (lat > 68 && lon < 26) return false;
  // Far south (< 43) must be clearly Cyrillic Russia (Caucasus border region)
  if (lat < 43 && !hasCyrillic) return false;
  // Require Cyrillic name for southern belt (lat < 50) to avoid Balkans/Central Asia bleed
  if (lat < 50 && !hasCyrillic) return false;

  return true;
}

/**
 * Assembles a relation's members into a polygon. Falls back to the centroid of whatever
 * coordinates are available as a Point when the members can't form a ring at all (e.g. a way
 * missing geometry) — degraded, but keeps the reserve on the map instead of dropping it.
 */
function buildGeometry(members: any[]): OOPTFeature['geometry'] | null {
  const ways: Array<{ role: string; geometry: Array<{ lat: number; lon: number }> }> = members
    .filter((m: any) => m?.type === 'way' && Array.isArray(m.geometry) && m.geometry.length > 0)
    .map((m: any) => ({ role: m.role || '', geometry: m.geometry }));

  const ringWays: WayGeometryMember[] = ways.filter(w => w.geometry.length >= 2);
  const polygon = buildMultiPolygon(ringWays);
  if (polygon) return polygon;

  const points = ways.flatMap(w => w.geometry);
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return { type: 'Point', coordinates: [lon, lat] };
}

function labelPoint(geometry: OOPTFeature['geometry']): { lat: number; lon: number } {
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates;
    return { lat, lon };
  }
  const [lon, lat] = pointOnFeature({ type: 'Feature', properties: {}, geometry }).geometry.coordinates;
  return { lat, lon };
}

function areaHaFromGeometry(geometry: OOPTFeature['geometry']): number | null {
  if (geometry.type === 'Point') return null;
  try {
    const ha = area({ type: 'Feature', properties: {}, geometry }) / 10000;
    return Math.round(ha * 10) / 10;
  } catch {
    return null;
  }
}

function parseFeatures(elements: any[]): OOPTFeature[] {
  const features: OOPTFeature[] = [];
  for (const e of elements) {
    if (e?.type !== 'relation' || !e.tags || !Array.isArray(e.members)) continue;

    const geometry = buildGeometry(e.members);
    if (!geometry) continue;

    const { lat, lon } = labelPoint(geometry);
    const t: Record<string, string> = e.tags;
    if (!isLikelyRussia(lat, lon, t)) continue;

    const shaped = geometry.type === 'Point' ? geometry : simplifyFeatureGeometry(geometry, MAX_VERTICES_PER_RING);
    features.push({
      id: e.id,
      name: t['name:ru'] || t.name || 'Без названия',
      name_ru: t['name:ru'] || null,
      protect_class: t.protect_class || null,
      boundary: t.boundary || null,
      lat,
      lon,
      wikidata: t.wikidata || null,
      website: t.website || t.url || null,
      area_ha: t['area:ha'] ? parseFloat(t['area:ha']) : areaHaFromGeometry(shaped),
      osm_url: `https://www.openstreetmap.org/relation/${e.id}`,
      geometry: shaped,
    });
  }
  return features;
}

export async function getOOPT(): Promise<OOPTResult> {
  // An empty answer (Overpass overload) never replaces the last good list
  return cached(OOPT_KEY, OOPT_TTL_SEC, () => fetchOOPT(1), { isValid: hasFeatures });
}

/** Background refresh: Overpass often answers 504 under load, so retry a few times. */
export function refreshOOPT(): Promise<boolean> {
  return warm(OOPT_KEY, OOPT_TTL_SEC, () => fetchOOPT(3), { isValid: hasFeatures });
}

const hasFeatures = (r: OOPTResult) => r.features.length > 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchOOPT(attempts: number): Promise<OOPTResult> {
  let lastErr: Error = new Error('No attempts made');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const body = new URLSearchParams({ data: QUERY_AREA });
      // Full-geometry responses are much larger than the old points-only query, so both the
      // Overpass-side timeout above and this client timeout are generous.
      const res = await axios.post(OVERPASS_ENDPOINT, body.toString(), {
        timeout: 200000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'forestwatch.ru/1.0 (+https://forestwatch.ru)',
        },
      });
      if (typeof res.data === 'string' || res.data?.elements === undefined) throw new Error('Unexpected response format');
      const features = parseFeatures(res.data.elements);
      if (features.length === 0) throw new Error('empty result');
      return { features, source: OVERPASS_ENDPOINT, fetchedAt: new Date().toISOString() };
    } catch (err: any) {
      lastErr = err;
      console.warn(`Overpass attempt ${attempt}/${attempts} failed:`, err.message?.slice(0, 80));
      if (attempt < attempts) await sleep(30000);
    }
  }
  throw lastErr;
}

export function ooptToGeoJSON(features: OOPTFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map(({ geometry, ...properties }) => ({
      type: 'Feature',
      geometry,
      properties,
    })),
  };
}
