/**
 * Nearest roads and settlement around an incident from OpenStreetMap (Overpass). Pure: the query
 * text, classification of OSM tags, parsing of an Overpass answer and the choice of the nearest
 * objects. Fetching lives in overpass.ts, caching and the HTTP answer in routes/incidentContext.ts.
 *
 * Roads: `highway` ways of the classes a car can use (ROAD_CLASSES); `track` (forest and field
 * tracks) is reported separately. Footways, paths, steps, cycleways, service roads and anything
 * that is not a road (construction, proposed, platforms, …) are left out. A road counts as paved
 * when its `surface` tag says so; with no `surface`, motorway…secondary are taken as paved by class
 * (`paved_by_class: true` — the card says so).
 * Settlements: `place=city|town|village|hamlet` (nodes, or the centre of a way/relation).
 */
import { bearingDeg, compassWords, haversineKm, isValidLatLon, pointToPolyline, type LatLon } from './geo';

export const RADIUS_KM = 15;
export const CONTEXT_SOURCE = 'OpenStreetMap через Overpass API';
export const CONTEXT_LICENSE = '© участники OpenStreetMap, ODbL 1.0';
export const CONTEXT_NOTE = 'по OSM, приблизительно: расстояние по прямой от центра события';

export const ROAD_CLASSES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'road',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
] as const;
export const TRACK_CLASS = 'track';
export const PLACE_CLASSES = ['city', 'town', 'village', 'hamlet'] as const;

/** Classes assumed paved when the way has no `surface` tag. */
const PAVED_BY_CLASS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link',
]);
const PAVED_SURFACES = new Set([
  'paved', 'asphalt', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'sett', 'chipseal',
  'bricks', 'cobblestone', 'metal',
]);

type RoadClass = (typeof ROAD_CLASSES)[number];
type PlaceClass = (typeof PLACE_CLASSES)[number];

const isRoadClass = (v: string): v is RoadClass => (ROAD_CLASSES as readonly string[]).includes(v);
const isPlaceClass = (v: string): v is PlaceClass => (PLACE_CLASSES as readonly string[]).includes(v);

/**
 * One Overpass request: road and track ways with geometry, settlements with a centre, all within
 * `radiusKm` of the point. Coordinates are numbers formatted here (never request text).
 */
export function buildContextQuery(point: LatLon, radiusKm = RADIUS_KM, serverTimeoutSec = 60): string {
  if (!isValidLatLon(point)) throw new Error('invalid point');
  const around = `around:${Math.round(radiusKm * 1000)},${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
  const roads = [...ROAD_CLASSES, TRACK_CLASS].join('|');
  const places = PLACE_CLASSES.join('|');
  return `[out:json][timeout:${serverTimeoutSec}];\n`
    + `way(${around})["highway"~"^(${roads})$"];\n`
    + `out tags geom;\n`
    + `nwr(${around})["place"~"^(${places})$"];\n`
    + `out tags center;`;
}

export type RoadKind = 'road' | 'track';

export interface OsmRoad {
  kind: RoadKind;
  osm_id: number;
  highway: string;
  name: string | null;
  ref: string | null;
  surface: string | null;
  /** true/false from `surface`; for roads without it, by class (motorway…secondary). Tracks: by surface only. */
  paved: boolean;
  paved_by_class: boolean;
  geometry: LatLon[];
}

export interface OsmPlace {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  place: PlaceClass;
  name: string | null;
  point: LatLon;
}

export interface ParsedContext {
  roads: OsmRoad[];
  places: OsmPlace[];
  /** Overpass `osm3s.timestamp_osm_base`: how current the OSM data is. */
  osmBase: string | null;
  /** Elements dropped: unknown class, no geometry, invalid coordinates. */
  skipped: number;
}

export class OverpassAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverpassAnswerError';
  }
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Road classification from tags, or null when the way is not a road we report. */
export function classifyRoad(tags: Record<string, unknown>): Pick<OsmRoad, 'kind' | 'highway' | 'surface' | 'paved' | 'paved_by_class'> | null {
  const highway = text(tags.highway);
  if (!highway) return null;
  const surface = text(tags.surface)?.toLowerCase() ?? null;
  if (highway === TRACK_CLASS) {
    return { kind: 'track', highway, surface, paved: surface !== null && PAVED_SURFACES.has(surface), paved_by_class: false };
  }
  if (!isRoadClass(highway)) return null;
  if (surface !== null) return { kind: 'road', highway, surface, paved: PAVED_SURFACES.has(surface), paved_by_class: false };
  const byClass = PAVED_BY_CLASS.has(highway);
  return { kind: 'road', highway, surface, paved: byClass, paved_by_class: byClass };
}

const osmTypes = new Set(['node', 'way', 'relation']);

/**
 * Parses an Overpass JSON answer. Throws OverpassAnswerError when the answer is not a result at
 * all (HTML, no `elements`, or a `remark` reporting a runtime error or timeout — Overpass answers
 * 200 with partial data then), so a broken answer is never cached as "nothing nearby".
 */
export function parseContextAnswer(data: unknown): ParsedContext {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new OverpassAnswerError('Overpass: ответ не JSON');
  const body = data as Record<string, any>;
  if (!Array.isArray(body.elements)) throw new OverpassAnswerError('Overpass: в ответе нет elements');
  const remark = text(body.remark);
  if (remark && /error|timed out|timeout|out of memory/i.test(remark)) {
    throw new OverpassAnswerError(`Overpass: ${remark.slice(0, 120)}`);
  }
  const roads: OsmRoad[] = [];
  const places: OsmPlace[] = [];
  let skipped = 0;
  for (const e of body.elements) {
    const tags = e && typeof e.tags === 'object' && e.tags ? e.tags as Record<string, unknown> : null;
    const id = Number(e?.id);
    if (!tags || !Number.isSafeInteger(id) || !osmTypes.has(e?.type)) { skipped++; continue; }

    if (e.type === 'way' && tags.highway !== undefined) {
      const cls = classifyRoad(tags);
      const geometry = Array.isArray(e.geometry)
        ? e.geometry.filter(isValidLatLon).map((p: LatLon) => ({ lat: p.lat, lon: p.lon }))
        : [];
      if (!cls || geometry.length === 0) { skipped++; continue; }
      roads.push({ ...cls, osm_id: id, name: text(tags.name), ref: text(tags.ref), geometry });
      continue;
    }

    const place = text(tags.place);
    if (place && isPlaceClass(place)) {
      const point = e.type === 'node' ? { lat: e.lat, lon: e.lon } : e.center;
      if (!isValidLatLon(point)) { skipped++; continue; }
      places.push({
        osm_type: e.type, osm_id: id, place,
        name: text(tags['name:ru']) ?? text(tags.name),
        point: { lat: point.lat, lon: point.lon },
      });
      continue;
    }
    skipped++;
  }
  const base = text(body.osm3s?.timestamp_osm_base);
  const osmBase = base && !Number.isNaN(new Date(base).getTime()) ? base : null;
  return { roads, places, osmBase, skipped };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface NearestRoad {
  osm_id: number;
  osm_url: string;
  highway: string;
  name: string | null;
  ref: string | null;
  surface: string | null;
  paved: boolean;
  paved_by_class: boolean;
  distance_km: number;
  bearing_deg: number;
  direction: string;
}

export interface NearestSettlement {
  osm_id: number;
  osm_type: OsmPlace['osm_type'];
  osm_url: string;
  place: PlaceClass;
  name: string | null;
  distance_km: number;
  bearing_deg: number;
  direction: string;
}

/** Nearest road among `roads` (by distance to segments) within `radiusKm`, or null. */
export function nearestRoad(point: LatLon, roads: OsmRoad[], radiusKm = RADIUS_KM): NearestRoad | null {
  let best: { road: OsmRoad; km: number; nearest: LatLon } | null = null;
  for (const road of roads) {
    const d = pointToPolyline(point, road.geometry);
    if (d && d.km <= radiusKm && (!best || d.km < best.km)) best = { road, km: d.km, nearest: d.nearest };
  }
  if (!best) return null;
  const { road } = best;
  const bearing = Math.round(bearingDeg(point, best.nearest));
  return {
    osm_id: road.osm_id,
    osm_url: `https://www.openstreetmap.org/way/${road.osm_id}`,
    highway: road.highway,
    name: road.name,
    ref: road.ref,
    surface: road.surface,
    paved: road.paved,
    paved_by_class: road.paved_by_class,
    distance_km: round1(best.km),
    bearing_deg: bearing % 360,
    direction: compassWords(bearing),
  };
}

/** Nearest settlement within `radiusKm` (distance to its OSM point or centre), or null. */
export function nearestSettlement(point: LatLon, places: OsmPlace[], radiusKm = RADIUS_KM): NearestSettlement | null {
  let best: { place: OsmPlace; km: number } | null = null;
  for (const place of places) {
    const km = haversineKm(point, place.point);
    if (km <= radiusKm && (!best || km < best.km)) best = { place, km };
  }
  if (!best) return null;
  const { place } = best;
  const bearing = Math.round(bearingDeg(point, place.point));
  return {
    osm_id: place.osm_id,
    osm_type: place.osm_type,
    osm_url: `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}`,
    place: place.place,
    name: place.name,
    distance_km: round1(best.km),
    bearing_deg: bearing % 360,
    direction: compassWords(bearing),
  };
}

export interface IncidentContext {
  /** The point distances are measured from: the incident centre rounded to 3 decimals (≈ 100 m). */
  point: LatLon;
  radius_km: number;
  nearest_road: NearestRoad | null;
  nearest_paved_road: NearestRoad | null;
  nearest_track: NearestRoad | null;
  nearest_settlement: NearestSettlement | null;
  /** How current the OSM data is (Overpass timestamp_osm_base), else the fetch time. */
  data_date: string;
  fetched_at: string;
  source: string;
  license: string;
  note: string;
}

export function buildContext(point: LatLon, parsed: ParsedContext, fetchedAt: string, radiusKm = RADIUS_KM): IncidentContext {
  const roads = parsed.roads.filter(r => r.kind === 'road');
  return {
    point,
    radius_km: radiusKm,
    nearest_road: nearestRoad(point, roads, radiusKm),
    nearest_paved_road: nearestRoad(point, roads.filter(r => r.paved), radiusKm),
    nearest_track: nearestRoad(point, parsed.roads.filter(r => r.kind === 'track'), radiusKm),
    nearest_settlement: nearestSettlement(point, parsed.places, radiusKm),
    data_date: parsed.osmBase ?? fetchedAt,
    fetched_at: fetchedAt,
    source: CONTEXT_SOURCE,
    license: CONTEXT_LICENSE,
    note: CONTEXT_NOTE,
  };
}

/** Centre rounded to 3 decimals: the cache key and the point of the answer. */
export function contextPoint(center: LatLon): LatLon {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { lat: r(center.lat), lon: r(center.lon) };
}

export const CONTEXT_CACHE_VERSION = 'v1';
export const CONTEXT_TTL_SEC = 7 * 24 * 60 * 60;

export function contextCacheKey(point: LatLon, radiusKm = RADIUS_KM): string {
  const p = contextPoint(point);
  return `incident:context:${CONTEXT_CACHE_VERSION}:${radiusKm}:${p.lat.toFixed(3)}:${p.lon.toFixed(3)}`;
}
