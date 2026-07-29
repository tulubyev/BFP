/**
 * Overpass API Service — fetches ООПТ (protected areas) for Russia from OSM data.
 * Data is © OpenStreetMap contributors, ODbL licence.
 * https://www.openstreetmap.org/copyright
 */
import axios from 'axios';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

// Primary query: use OSM area filter for Russia (precise, no false positives).
// Fallback: bbox query with geographic post-filtering.
const QUERY_AREA = `[out:json][timeout:60];
area["ISO3166-1"="RU"][admin_level="2"]->.russia;
(
  relation(area.russia)["boundary"="national_park"]["name"];
  relation(area.russia)["boundary"="protected_area"]["protect_class"="1"]["name"];
);
out tags center qt;`;

const QUERY_BBOX = `[out:json][timeout:55][bbox:41,19,82,180];
(
  relation["boundary"="protected_area"]["protect_class"="1"]["name"];
  relation["boundary"="national_park"]["name"];
);
out tags center qt;`;

export interface OOPTFeature {
  id: number;
  name: string;
  name_ru: string | null;
  protect_class: string | null;
  boundary: string | null;
  lat: number;
  lon: number;
  wikidata: string | null;
  website: string | null;
  area_ha: number | null;
  osm_url: string;
}

interface CacheEntry {
  data: OOPTFeature[];
  fetchedAt: number;
  source: string;
}

const TTL = 12 * 60 * 60 * 1000; // 12 hours
let _cache: CacheEntry | null = null;

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
  const hasCyrillic = /[\u0400-\u04FF]/.test(nameRu) || /[\u0400-\u04FF]/.test(name);
  // Reject if primary name has Georgian, Armenian, or Latin-only script
  const hasGeorgian = /[\u10A0-\u10FF]/.test(name);
  const hasArmenian = /[\u0530-\u058F]/.test(name);
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

function parseFeatures(elements: any[]): OOPTFeature[] {
  return elements
    .filter(e => e.center && isLikelyRussia(e.center.lat, e.center.lon, e.tags || {}))
    .map(e => {
      const t: Record<string, string> = e.tags || {};
      return {
        id: e.id,
        name: t['name:ru'] || t.name || 'Без названия',
        name_ru: t['name:ru'] || null,
        protect_class: t.protect_class || null,
        boundary: t.boundary || null,
        lat: e.center.lat,
        lon: e.center.lon,
        wikidata: t.wikidata || null,
        website: t.website || t.url || null,
        area_ha: t['area:ha'] ? parseFloat(t['area:ha']) : null,
        osm_url: `https://www.openstreetmap.org/relation/${e.id}`,
      };
    });
}

export async function getOOPT(): Promise<{ features: OOPTFeature[]; source: string; fetchedAt: string }> {
  if (_cache && Date.now() - _cache.fetchedAt < TTL) {
    return { features: _cache.data, source: _cache.source, fetchedAt: new Date(_cache.fetchedAt).toISOString() };
  }

  const postOverpass = async (endpoint: string, query: string) => {
    const body = new URLSearchParams();
    body.set('data', query);
    const res = await axios.post(endpoint, body.toString(), {
      timeout: 65000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ForestGIS/1.0 (forest monitoring; contact@forestgis.ru)',
      },
    });
    if (typeof res.data === 'string' || res.data?.elements === undefined) {
      throw new Error('Unexpected response format');
    }
    return res.data.elements as any[];
  };

  let lastErr: Error = new Error('No endpoints tried');

  // Try area-filtered query first (precise, Russia-only), then bbox fallback
  for (const query of [QUERY_AREA, QUERY_BBOX]) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const elements = await postOverpass(endpoint, query);
        const features = parseFeatures(elements);
        _cache = { data: features, fetchedAt: Date.now(), source: endpoint };
        return { features, source: endpoint, fetchedAt: new Date(_cache.fetchedAt).toISOString() };
      } catch (err: any) {
        lastErr = err;
        console.warn(`Overpass ${endpoint} failed:`, err.message?.slice(0, 80));
      }
    }
  }

  // Return stale cache if available
  if (_cache) {
    console.warn('All Overpass endpoints failed, returning stale cache');
    return { features: _cache.data, source: _cache.source + ' (stale)', fetchedAt: new Date(_cache.fetchedAt).toISOString() };
  }

  throw lastErr;
}

export function ooptToGeoJSON(features: OOPTFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map(f => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: f,
    })),
  };
}
