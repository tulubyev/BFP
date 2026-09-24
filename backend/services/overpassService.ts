/**
 * Overpass API Service — fetches ООПТ (protected areas) for Russia from OSM data.
 * Data is © OpenStreetMap contributors, ODbL licence.
 * https://www.openstreetmap.org/copyright
 */
import axios from 'axios';
import { cached, warm } from '../utils/cache';

// overpass.openstreetmap.fr answers 403 or empty results; the bbox query pulled in non-Russian parks
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OOPT_KEY = 'oopt:ru';
const OOPT_TTL_SEC = 3 * 24 * 60 * 60; // refreshed daily in the background

// OSM area filter for Russia (precise, no false positives).
const QUERY_AREA = `[out:json][timeout:60];
area["ISO3166-1"="RU"][admin_level="2"]->.russia;
(
  relation(area.russia)["boundary"="national_park"]["name"];
  relation(area.russia)["boundary"="protected_area"]["protect_class"="1"]["name"];
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

interface OOPTResult {
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
      const res = await axios.post(OVERPASS_ENDPOINT, body.toString(), {
        timeout: 65000,
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
      if (attempt < attempts) await sleep(20000);
    }
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
