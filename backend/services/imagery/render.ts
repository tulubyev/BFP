/**
 * Pixel math for the two renders and PNG encoding with sharp.
 *
 * - truecolor: the `visual` asset (TCI, 8-bit RGB) as is.
 * - swir: B12 / B8A / B04 as R / G / B, reflectance 0–0.4 → 0–255 with a gamma. Burn scars come out
 *   dark red, active fire bright orange, healthy forest green.
 * Pixels with nodata (0) in any band are transparent. The incident bbox is drawn as a thin
 * yellow outline (an SVG composited by sharp).
 */
import sharp from 'sharp';
import type { RasterBand } from './stac';

export const RENDERS = ['truecolor', 'swir'] as const;
export type Render = typeof RENDERS[number];
/** Part of every image URL and cache key: bump when the look of a render changes. */
export const RENDER_VERSION = 'v1';

export const SWIR_MAX_REFLECTANCE = 0.4;
export const SWIR_GAMMA = 1.4;
export const OUTLINE_COLOR = '#facc15';
/** A bbox smaller than this (px) is drawn as a square of this size, so a point incident stays visible. */
export const MIN_OUTLINE_PX = 8;

export interface ReflectanceScale {
  scale: number;
  offset: number;
}

/**
 * Scale and offset from the asset's `raster:bands` (Collection 1: scale 0.0001, offset −0.1).
 * Without them, the plain L2A convention DN × 0.0001.
 */
export function reflectanceScale(bands: RasterBand[] | undefined): ReflectanceScale {
  const b = bands?.[0];
  const scale = Number(b?.scale);
  const offset = Number(b?.offset);
  return {
    scale: b?.scale != null && Number.isFinite(scale) && scale > 0 ? scale : 0.0001,
    offset: b?.offset != null && Number.isFinite(offset) ? offset : 0,
  };
}

/** One SWIR channel: DN → reflectance → 0–255 with the gamma curve. */
export function stretchSwir(dn: number, s: ReflectanceScale): number {
  const r = dn * s.scale + s.offset;
  const t = Math.max(0, Math.min(1, r / SWIR_MAX_REFLECTANCE));
  return Math.round(255 * t ** (1 / SWIR_GAMMA));
}

/** RGBA pixels from three bands; `toByte` maps a band value to 0–255. Nodata (0) in any band → transparent. */
export function composeRgba(
  bands: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>],
  toByte: [(v: number) => number, (v: number) => number, (v: number) => number],
): Buffer {
  const n = bands[0].length;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const r = bands[0][i]; const g = bands[1][i]; const b = bands[2][i];
    if (r === 0 || g === 0 || b === 0) continue; // stays 0,0,0,0
    out[i * 4] = toByte[0](r);
    out[i * 4 + 1] = toByte[1](g);
    out[i * 4 + 2] = toByte[2](b);
    out[i * 4 + 3] = 255;
  }
  return out;
}

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function truecolorRgba(r: ArrayLike<number>, g: ArrayLike<number>, b: ArrayLike<number>): Buffer {
  return composeRgba([r, g, b], [clampByte, clampByte, clampByte]);
}

export function swirRgba(
  b12: ArrayLike<number>, b8a: ArrayLike<number>, b04: ArrayLike<number>,
  scales: [ReflectanceScale, ReflectanceScale, ReflectanceScale],
): Buffer {
  return composeRgba([b12, b8a, b04], [v => stretchSwir(v, scales[0]), v => stretchSwir(v, scales[1]), v => stretchSwir(v, scales[2])]);
}

/**
 * SVG overlay with the incident outline. `corners` are the bbox corners in grid pixels (a slightly
 * rotated quadrilateral in UTM). Tiny outlines grow to MIN_OUTLINE_PX around their centre.
 */
export function outlineSvg(width: number, height: number, corners: [number, number][]): string {
  const xs = corners.map(c => c[0]);
  const ys = corners.map(c => c[1]);
  let pts = corners;
  if (Math.max(...xs) - Math.min(...xs) < MIN_OUTLINE_PX && Math.max(...ys) - Math.min(...ys) < MIN_OUTLINE_PX) {
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const h = MIN_OUTLINE_PX / 2;
    pts = [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
  }
  const points = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<polygon points="${points}" fill="none" stroke="${OUTLINE_COLOR}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export async function encodePng(rgba: Buffer, width: number, height: number, overlaySvg?: string): Promise<Buffer> {
  let img = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (overlaySvg) img = img.composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);
  return img.png({ compressionLevel: 9 }).toBuffer();
}
