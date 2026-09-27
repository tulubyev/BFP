/**
 * Image URLs, their strict validation and the Redis keys of the imagery feature.
 *
 * URL: /imagery/s2/v1/<sceneId>/<render>/<minLon>,<minLat>,<maxLon>,<maxLat>.png — the bbox is the
 * incident outline (clipped to its AOI); the AOI itself is derived from it (expandAoi), so the
 * picture is fully determined by the URL and can be cached forever by browsers and the CDN.
 */
import { bboxSizeKm, formatBbox, type Bbox } from './geometry';
import { RENDERS, RENDER_VERSION, type Render } from './render';
import { SCENE_ID_RE } from './stac';

/** Longest side of a requested bbox (the AOI is at most 20 km; a little slack for rounding). */
export const MAX_REQUEST_KM = 25;

export function imagePath(sceneId: string, render: Render, bbox: Bbox): string {
  return `/imagery/s2/${RENDER_VERSION}/${sceneId}/${render}/${formatBbox(bbox)}.png`;
}

export interface ImageRequest {
  sceneId: string;
  render: Render;
  bbox: Bbox;
  /** Canonical "minLon,minLat,maxLon,maxLat" string (as in the URL). */
  bboxParam: string;
}

export type ParseResult = { ok: true; value: ImageRequest } | { ok: false; error: string };

const NUMBER_RE = /^-?\d{1,3}\.\d{5}$/;

export function parseBboxParam(raw: string): Bbox | null {
  const parts = raw.split(',');
  if (parts.length !== 4 || !parts.every(p => NUMBER_RE.test(p))) return null;
  const b = parts.map(Number) as Bbox;
  if (!b.every(Number.isFinite)) return null;
  const [minLon, minLat, maxLon, maxLat] = b;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
  if (minLon > maxLon || minLat > maxLat) return null;
  return b;
}

export function parseImageRequest(sceneId: string, render: string, bboxParam: string): ParseResult {
  if (!SCENE_ID_RE.test(sceneId)) return { ok: false, error: 'invalid scene id' };
  if (!(RENDERS as readonly string[]).includes(render)) return { ok: false, error: `render must be one of ${RENDERS.join(', ')}` };
  const bbox = parseBboxParam(bboxParam);
  // Only the canonical 5-decimal form is accepted, so one picture has exactly one URL (cache keys)
  if (!bbox || formatBbox(bbox) !== bboxParam) return { ok: false, error: 'bbox must be minLon,minLat,maxLon,maxLat with 5 decimals' };
  const { widthKm, heightKm } = bboxSizeKm(bbox);
  if (Math.max(widthKm, heightKm) > MAX_REQUEST_KM) return { ok: false, error: `bbox side exceeds ${MAX_REQUEST_KM} km` };
  return { ok: true, value: { sceneId, render: render as Render, bbox, bboxParam } };
}

export const incidentImageryKey = (id: number, lastSeen: string) => `imagery:incident:v1:${id}:${lastSeen}`;
export const sceneItemKey = (sceneId: string) => `imagery:s2:item:v1:${sceneId}`;
export const pngKey = (r: ImageRequest) => `imagery:s2:png:${RENDER_VERSION}:${r.sceneId}:${r.render}:${r.bboxParam}`;
