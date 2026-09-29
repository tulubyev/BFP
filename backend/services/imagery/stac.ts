/**
 * Sentinel-2 L2A Collection 1 catalogue: Element 84 Earth Search v1 (STAC), COGs on AWS Open Data.
 * Only the fields the imagery code needs are kept (`slimItem`), so an item cached in Redis is small.
 */
import type { Bbox } from './geometry';
import { readJsonWithLimit, RESPONSE_LIMITS } from '../../utils/responseLimits';
import { recordSourceAccess } from '../sourceAccess';

export const STAC_API_URL = 'https://earth-search.aws.element84.com/v1';
export const S2_COLLECTION = 'sentinel-2-c1-l2a';
/** Public bucket that holds the COGs and a copy of every item JSON. */
export const S2_BUCKET_URL = 'https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com';
export const SCENE_ID_RE = /^S2[ABC]_T\d{2}[A-Z]{3}_\d{8}T\d{6}_L2A$/;
/** Assets the renders and the scene check read. */
export const S2_ASSETS = ['visual', 'red', 'nir08', 'swir22', 'scl'] as const;
export type S2AssetKey = typeof S2_ASSETS[number];

export interface RasterBand {
  nodata?: number;
  scale?: number;
  offset?: number;
}

export interface S2Asset {
  href: string;
  'raster:bands'?: RasterBand[];
}

export interface S2Scene {
  id: string;
  bbox: Bbox;
  datetime: string;
  platform: string | null;
  cloudCover: number | null;
  epsg: number;
  assets: Partial<Record<S2AssetKey, S2Asset>>;
}

/** Parses an EPSG code from `proj:code` ("EPSG:32648") or `proj:epsg` (32648). */
export function parseEpsg(code: unknown, epsg: unknown): number | null {
  if (typeof code === 'string') {
    const m = /^EPSG:(\d+)$/i.exec(code.trim());
    if (m) return Number(m[1]);
  }
  const n = Number(epsg);
  return epsg != null && Number.isInteger(n) && n > 0 ? n : null;
}

/** The fields we use from a STAC item, or null when it lacks what a render needs. */
export function slimItem(raw: any): S2Scene | null {
  if (!raw || typeof raw.id !== 'string' || !SCENE_ID_RE.test(raw.id)) return null;
  const p = raw.properties ?? {};
  const bbox = raw.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n: unknown) => Number.isFinite(n))) return null;
  if (typeof p.datetime !== 'string') return null;
  const assets: Partial<Record<S2AssetKey, S2Asset>> = {};
  let epsg = parseEpsg(p['proj:code'], p['proj:epsg']);
  for (const key of S2_ASSETS) {
    const a = raw.assets?.[key];
    if (!a || typeof a.href !== 'string' || !/^https:\/\//.test(a.href)) continue;
    assets[key] = { href: a.href, ...(Array.isArray(a['raster:bands']) ? { 'raster:bands': a['raster:bands'] } : {}) };
    epsg ??= parseEpsg(a['proj:code'], a['proj:epsg']);
  }
  if (!epsg) return null;
  const cloud = Number(p['eo:cloud_cover']);
  return {
    id: raw.id,
    bbox: bbox as Bbox,
    datetime: p.datetime,
    platform: typeof p.platform === 'string' ? p.platform : null,
    cloudCover: p['eo:cloud_cover'] != null && Number.isFinite(cloud) ? cloud : null,
    epsg,
    assets,
  };
}

/** "Sentinel-2A" from the item's platform ("sentinel-2a") or, failing that, the scene id. */
export function platformLabel(scene: Pick<S2Scene, 'id' | 'platform'>): string {
  const m = /^sentinel-2([abc])$/i.exec(scene.platform ?? '') ?? /^S2([ABC])_/.exec(scene.id);
  return m ? `Sentinel-2${m[1].toUpperCase()}` : 'Sentinel-2';
}

/**
 * URL of the item JSON copy in the bucket: sentinel-2-c1-l2a/<zone>/<band>/<square>/<yyyy>/<m>/<id>/<id>.json
 * (zone and month without leading zeros, as the bucket stores them).
 */
export function bucketItemUrl(sceneId: string): string | null {
  const m = /^S2[ABC]_T(\d{2})([A-Z])([A-Z]{2})_(\d{4})(\d{2})\d{2}T\d{6}_L2A$/.exec(sceneId);
  if (!m) return null;
  const [, zone, band, square, year, month] = m;
  return `${S2_BUCKET_URL}/${S2_COLLECTION}/${Number(zone)}/${band}/${square}/${year}/${Number(month)}/${sceneId}/${sceneId}.json`;
}

export interface SearchParams {
  bbox: Bbox;
  /** RFC 3339 interval "start/end". */
  datetime: string;
  sort: 'asc' | 'desc';
  limit: number;
  maxCloudCover: number;
  /** Order of the results: by acquisition date (default) or by tile cloud cover, least cloudy first. */
  sortBy?: 'datetime' | 'cloud';
}

export function searchBody(p: SearchParams): Record<string, unknown> {
  return {
    collections: [S2_COLLECTION],
    bbox: p.bbox,
    datetime: p.datetime,
    query: { 'eo:cloud_cover': { lt: p.maxCloudCover } },
    sortby: p.sortBy === 'cloud'
      ? [{ field: 'properties.eo:cloud_cover', direction: 'asc' }, { field: 'properties.datetime', direction: p.sort }]
      : [{ field: 'properties.datetime', direction: p.sort }],
    limit: p.limit,
  };
}

export class HttpStatusError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpStatusError';
  }
}

export type FetchJson = (url: string, init?: { method?: string; body?: unknown; timeoutMs?: number }) => Promise<any>;

/** JSON over global fetch with a timeout; non-2xx → HttpStatusError. */
export const fetchJson: FetchJson = async (url, init = {}) => {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new HttpStatusError(res.status, url);
  return readJsonWithLimit(res, RESPONSE_LIMITS.stacJson);
};

export interface StacClient {
  search(p: SearchParams): Promise<S2Scene[]>;
  /** Null when the scene does not exist. */
  getItem(id: string): Promise<S2Scene | null>;
}

export function createStacClient(fetchJsonImpl: FetchJson = fetchJson, apiUrl = STAC_API_URL): StacClient {
  return {
    async search(p) {
      const body = await fetchJsonImpl(`${apiUrl}/search`, { method: 'POST', body: searchBody(p) })
        .catch(err => { void recordSourceAccess('sentinel2', 'failed', err); throw err; });
      if (!body || !Array.isArray(body.features)) {
        void recordSourceAccess('sentinel2', 'failed', 'STAC search: no features array');
        throw new Error('STAC search: no features array');
      }
      void recordSourceAccess('sentinel2', 'ok');
      return body.features.map(slimItem).filter((s: S2Scene | null): s is S2Scene => s !== null);
    },
    async getItem(id) {
      try {
        const raw = await fetchJsonImpl(`${apiUrl}/collections/${S2_COLLECTION}/items/${encodeURIComponent(id)}`);
        void recordSourceAccess('sentinel2', 'ok');
        return slimItem(raw);
      } catch (err) {
        // A 404 is an answer: the catalogue is reachable, the scene just does not exist
        const notFound = err instanceof HttpStatusError && err.status === 404;
        void recordSourceAccess('sentinel2', notFound ? 'ok' : 'failed', notFound ? undefined : err);
        if (notFound) return null;
        // The catalogue is down or slow: the bucket keeps a copy of every item next to its COGs
        const copy = bucketItemUrl(id);
        if (!copy) throw err;
        try {
          return slimItem(await fetchJsonImpl(copy));
        } catch (fallbackErr) {
          if (fallbackErr instanceof HttpStatusError && (fallbackErr.status === 404 || fallbackErr.status === 403)) return null;
          throw err;
        }
      }
    },
  };
}
