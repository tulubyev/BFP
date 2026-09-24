/**
 * Global Forest Watch tile layers served through /tiles/gfw (© Hansen/UMD/Google/USGS/NASA, GLAD/UMD; CC BY 4.0).
 * Pure config and request validation — rendering lives in gfwTiles.ts.
 */

const GFW = 'https://tiles.globalforestwatch.org';

/** Tree cover loss v1.13: years 2001–2025 (max encoded year offset in the tiles is 25). */
export const LOSS_VERSION = 'v1.13';
export const LOSS_MAX_YEAR_OFFSET = 25;

export type GfwLayer = 'loss' | 'dist' | 'cover';

interface LayerConfig {
  maxZoom: number;
  /** Browser/CDN cache lifetime for rendered tiles. */
  cacheSeconds: number;
  decode: 'loss' | 'dist' | null;
}

export const GFW_TILE_LAYERS: Record<GfwLayer, LayerConfig> = {
  loss: { maxZoom: 13, cacheSeconds: 30 * 86400, decode: 'loss' },
  dist: { maxZoom: 14, cacheSeconds: 86400, decode: 'dist' },
  cover: { maxZoom: 12, cacheSeconds: 30 * 86400, decode: null },
};

export interface TileRequest {
  layer: GfwLayer;
  z: number;
  x: number;
  y: number;
}

const INT = /^\d{1,7}$/;

export function parseTileRequest(layer: string, z: string, x: string, y: string): TileRequest | null {
  if (!Object.prototype.hasOwnProperty.call(GFW_TILE_LAYERS, layer)) return null;
  if (!INT.test(z) || !INT.test(x) || !INT.test(y)) return null;
  const zoom = Number(z);
  const cfg = GFW_TILE_LAYERS[layer as GfwLayer];
  if (zoom > cfg.maxZoom) return null;
  const size = 2 ** zoom;
  const tx = Number(x);
  const ty = Number(y);
  if (tx >= size || ty >= size) return null;
  return { layer: layer as GfwLayer, z: zoom, x: tx, y: ty };
}

/** `distVersion` is the dated DIST-ALERT version (e.g. v20260919) resolved from `latest`. */
export function gfwUpstreamUrl(t: TileRequest, distVersion: string): string {
  const { z, x, y } = t;
  switch (t.layer) {
    case 'loss':
      return `${GFW}/umd_tree_cover_loss/${LOSS_VERSION}/dynamic/${z}/${x}/${y}.png?implementation=tcd_30`;
    case 'dist':
      return `${GFW}/umd_glad_dist_alerts/${distVersion}/dynamic/${z}/${x}/${y}.png?implementation=default`;
    case 'cover':
      return `${GFW}/umd_tree_cover_density_2000/v1.8/tcd_30/${z}/${x}/${y}.png`;
  }
}

export const GFW_TILES_BASE = GFW;
