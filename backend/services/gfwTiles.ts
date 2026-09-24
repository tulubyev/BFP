/**
 * Fetches GFW tiles, colors data-encoded ones and caches the rendered PNG in Redis.
 * The CDN (when configured) caches them again at the edge via Cache-Control.
 */
import axios from 'axios';
import sharp from 'sharp';
import { getRedis } from '../config/redis';
import { cached } from '../utils/cache';
import { decodeDistPixels, decodeLossPixels } from '../utils/gfwDecode';
import {
  GFW_TILE_LAYERS,
  GFW_TILES_BASE,
  LOSS_MAX_YEAR_OFFSET,
  gfwUpstreamUrl,
  type TileRequest,
} from './gfwTileLayers';

export const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Dated DIST-ALERT version behind `latest` (updated weekly), cached for 6 hours. */
async function distVersion(): Promise<string> {
  return cached('gfw:dist:version', 6 * 3600, async () => {
    const res = await axios.get(`${GFW_TILES_BASE}/umd_glad_dist_alerts/latest/dynamic/0/0/0.png?implementation=default`, {
      maxRedirects: 0,
      timeout: 15000,
      validateStatus: s => s >= 300 && s < 400,
    });
    const match = /\/(v\d{8})\//.exec(String(res.headers.location ?? ''));
    if (!match) throw new Error(`Unexpected DIST-ALERT redirect: ${res.headers.location}`);
    return match[1];
  }, { isValid: v => /^v\d{8}$/.test(v) });
}

async function readTile(key: string): Promise<Buffer | null> {
  try {
    return (await getRedis()?.getBuffer(key)) ?? null;
  } catch {
    return null;
  }
}

async function writeTile(key: string, png: Buffer, ttlSec: number): Promise<void> {
  try {
    await getRedis()?.set(key, png, 'EX', ttlSec);
  } catch (err: any) {
    console.warn(`tile cache write ${key} failed:`, err.message);
  }
}

async function colorize(t: TileRequest, raw: Buffer): Promise<Buffer> {
  const decoder = GFW_TILE_LAYERS[t.layer].decode;
  if (!decoder) return raw;
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = decoder === 'loss' ? decodeLossPixels(data, t.z, LOSS_MAX_YEAR_OFFSET) : decodeDistPixels(data);
  return sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
}

/** Rendered PNG for a validated tile request; a transparent tile where GFW has no data. */
export async function renderGfwTile(t: TileRequest): Promise<Buffer> {
  const version = t.layer === 'dist' ? await distVersion() : '';
  const key = `tile:gfw:${t.layer}${version && `:${version}`}:${t.z}/${t.x}/${t.y}`;
  const hit = await readTile(key);
  if (hit) return hit;

  const res = await axios.get<ArrayBuffer>(gfwUpstreamUrl(t, version), {
    responseType: 'arraybuffer',
    timeout: 20000,
    maxRedirects: 3,
    validateStatus: s => s === 200 || s === 404,
  });
  const png = res.status === 404 ? TRANSPARENT_PNG : await colorize(t, Buffer.from(res.data));
  await writeTile(key, png, GFW_TILE_LAYERS[t.layer].cacheSeconds);
  return png;
}
