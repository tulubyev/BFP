/**
 * Map state in the URL (future.md §8): pure parsing and serialization, no Leaflet import.
 *
 *   /?lat=52.28510&lng=104.28340&z=9&layers=loss,regions,incidents&base=satellite&incident=42
 *
 * - `lat`, `lng` — map centre (5 decimals, ~1 m), both or neither; `z` — zoom (integer).
 * - `layers` — comma-separated stable ids of the switched-on overlays (`layers=` = none).
 * - `base` — basemap id, omitted for the default one.
 * - `incident` — the selected incident id.
 *
 * Legacy links `/?lat&lng&incident` (no `z`) keep their old meaning: zoom 12 and a marker at the
 * point. Invalid values are ignored one by one, falling back to the defaults.
 */

export const OVERLAY_IDS = [
  'loss', 'dist', 'cover', 'regions', 'districts', 'oopt', 'firms-baikal', 'firms-russia', 'incidents',
] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

/** Overlays switched on when the URL has no (valid) `layers`. */
export const DEFAULT_OVERLAYS: readonly OverlayId[] = [
  'loss', 'dist', 'regions', 'districts', 'oopt', 'firms-baikal', 'incidents',
];

export const BASE_IDS = ['dark', 'osm', 'satellite'] as const;
export type BaseId = (typeof BASE_IDS)[number];
export const DEFAULT_BASE: BaseId = 'dark';

export const DEFAULT_CENTER: [number, number] = [53.5, 108.0];
export const DEFAULT_ZOOM = 5;
/** Zoom of a legacy `/?lat&lng` link (was hard-coded before the URL state existed). */
export const LEGACY_TARGET_ZOOM = 12;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 19;

const COORD_DECIMALS = 5;

/** Query keys owned by the map; everything else in the URL is left alone. */
export const MAP_STATE_KEYS = ['lat', 'lng', 'z', 'layers', 'base', 'incident'] as const;

export interface MapState {
  center: [number, number];
  zoom: number;
  overlays: OverlayId[];
  base: BaseId;
  incident: number | null;
}

export interface ParsedMapState extends MapState {
  /** lat/lng were valid (the view was set by the link, not the default). */
  hasCenter: boolean;
  /**
   * A legacy `/?lat&lng[&incident]` link (no `z`) or an incident link: the target is marked with
   * a pin, as before the URL state existed.
   */
  showTarget: boolean;
}

/** Minimal read interface shared by URLSearchParams and tests. */
export interface ParamsReader {
  get(name: string): string | null;
  has(name: string): boolean;
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  // plain decimal notation only: no hex, exponent, Infinity or empty strings
  if (!/^-?\d{1,3}(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function parseLat(value: string | null): number | null {
  const n = parseNumber(value);
  return n !== null && n >= -90 && n <= 90 ? n : null;
}

export function parseLng(value: string | null): number | null {
  const n = parseNumber(value);
  return n !== null && n >= -180 && n <= 180 ? n : null;
}

export function parseZoom(value: string | null): number | null {
  if (value === null || !/^\d{1,2}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= MIN_ZOOM && n <= MAX_ZOOM ? n : null;
}

/** Positive safe integer, else null (same rule as the incidents page). */
export function parseIncident(value: string | null): number | null {
  if (!value || !/^\d{1,16}$/.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseBase(value: string | null): BaseId | null {
  return value !== null && (BASE_IDS as readonly string[]).includes(value) ? (value as BaseId) : null;
}

/**
 * `layers`: known ids in canonical order, duplicates and unknown ids dropped. Null (use defaults)
 * when the parameter is missing or lists only unknown ids; `layers=` (empty) means none.
 */
export function parseOverlays(value: string | null): OverlayId[] | null {
  if (value === null) return null;
  const raw = value.split(',').map(s => s.trim()).filter(Boolean);
  if (raw.length === 0) return [];
  const known = OVERLAY_IDS.filter(id => raw.includes(id));
  return known.length > 0 ? known : null;
}

export function parseMapState(params: ParamsReader): ParsedMapState {
  const lat = parseLat(params.get('lat'));
  const lng = parseLng(params.get('lng'));
  const hasCenter = lat !== null && lng !== null;
  const zoom = parseZoom(params.get('z'));
  const incident = parseIncident(params.get('incident'));
  const legacy = hasCenter && !params.has('z');
  return {
    center: hasCenter ? [lat, lng] : DEFAULT_CENTER,
    zoom: zoom ?? (hasCenter && legacy ? LEGACY_TARGET_ZOOM : DEFAULT_ZOOM),
    overlays: parseOverlays(params.get('layers')) ?? [...DEFAULT_OVERLAYS],
    base: parseBase(params.get('base')) ?? DEFAULT_BASE,
    incident,
    hasCenter,
    showTarget: hasCenter && (legacy || incident !== null),
  };
}

/** Longitude wrapped into [-180, 180) (Leaflet lets it grow past ±180 when panning). */
export function wrapLng(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function formatCoord(value: number): string {
  const fixed = value.toFixed(COORD_DECIMALS);
  return /^-0\.0+$/.test(fixed) ? fixed.slice(1) : fixed;
}

/**
 * Writes the state into a copy of `current`: map keys are replaced (in a fixed order, after the
 * page's other params), everything else is kept.
 */
export function serializeMapState(state: MapState, current: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of MAP_STATE_KEYS) next.delete(key);
  const lat = Math.min(Math.max(state.center[0], -90), 90);
  next.set('lat', formatCoord(lat));
  next.set('lng', formatCoord(wrapLng(state.center[1])));
  next.set('z', String(Math.round(Math.min(Math.max(state.zoom, MIN_ZOOM), MAX_ZOOM))));
  next.set('layers', OVERLAY_IDS.filter(id => state.overlays.includes(id)).join(','));
  if (state.base !== DEFAULT_BASE) next.set('base', state.base);
  if (state.incident !== null) next.set('incident', String(state.incident));
  return next;
}

/** Query string for a state (commas in `layers` kept readable). */
export function mapStateQuery(state: MapState, current?: URLSearchParams): string {
  return serializeMapState(state, current).toString().replace(/%2C/gi, ',');
}

/** Absolute link to the map view, for «Скопировать ссылку на карту». */
export function mapShareUrl(origin: string, pathname: string, state: MapState, current?: URLSearchParams): string {
  return `${origin}${pathname}?${mapStateQuery(state, current)}`;
}

export function sameMapState(a: MapState, b: MapState): boolean {
  return formatCoord(a.center[0]) === formatCoord(b.center[0])
    && formatCoord(wrapLng(a.center[1])) === formatCoord(wrapLng(b.center[1]))
    && a.zoom === b.zoom
    && a.base === b.base
    && a.incident === b.incident
    && OVERLAY_IDS.every(id => a.overlays.includes(id) === b.overlays.includes(id));
}

/** Trailing-edge debounce; `cancel()` drops a pending call (map teardown). */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (...args: A) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  run.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return run;
}
