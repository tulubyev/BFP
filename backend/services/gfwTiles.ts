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
import { RESPONSE_LIMITS } from '../utils/responseLimits';
import { GFW_TILE_SOURCE, recordSourceAccess } from './sourceAccess';
import { distVersionProblem, tileProblem } from './quality/gfw';
import { reportQuality } from './quality/log';
import { failed, passed, QualityError } from './quality/result';

/** Source id per tile layer (sourceRegistry.ts), for the quality log. */
const LAYER_SOURCE: Record<TileRequest['layer'], string> = { loss: 'gfw_loss', dist: 'gfw_dist', cover: 'gfw_cover' };

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
      maxContentLength: RESPONSE_LIMITS.gfwRedirect,
      validateStatus: s => s >= 300 && s < 400,
    });
    const match = /\/(v\d{8})\//.exec(String(res.headers.location ?? ''));
    const problem = match ? distVersionProblem(match[1]) : `unexpected DIST-ALERT redirect: ${String(res.headers.location).slice(0, 120)}`;
    const result = problem ? failed('gfw_dist', 'dist-version', problem) : passed('gfw_dist', 'dist-version', 1);
    reportQuality(result);
    if (problem) throw new QualityError(result);
    return (match as RegExpExecArray)[1];
  }, { isValid: v => distVersionProblem(v) === null });
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
    maxContentLength: RESPONSE_LIMITS.gfwTile,
    maxRedirects: 3,
    validateStatus: s => s === 200 || s === 404,
  });
  const png = res.status === 404 ? TRANSPARENT_PNG : await checkedTile(t, res.headers['content-type'], Buffer.from(res.data));
  void recordSourceAccess(GFW_TILE_SOURCE[t.layer], 'ok');
  await writeTile(key, png, GFW_TILE_LAYERS[t.layer].cacheSeconds);
  return png;
}

/**
 * Quality gate for a 200 tile (quality/gfw.ts): an HTML page, empty body or broken PNG throws a
 * QualityError before anything is cached — the tile route answers 502 for it.
 */
async function checkedTile(t: TileRequest, contentType: unknown, raw: Buffer): Promise<Buffer> {
  const source = LAYER_SOURCE[t.layer];
  let problem = tileProblem(contentType, raw);
  let png: Buffer | null = null;
  if (!problem) {
    try {
      png = await colorize(t, raw);
    } catch (err: any) {
      problem = `PNG cannot be decoded: ${String(err?.message ?? err).slice(0, 100)}`;
    }
  }
  const result = problem ? failed(source, 'tile', `${t.z}/${t.x}/${t.y}: ${problem}`, 1, 1) : passed(source, 'tile', 1);
  reportQuality(result);
  if (!png) throw new QualityError(result);
  return png;
}
