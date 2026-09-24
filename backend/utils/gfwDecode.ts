/**
 * Decoders for Global Forest Watch data-encoded tiles (the GFW web app colors them in WebGL;
 * we do it server-side so plain Leaflet raster layers show real colors).
 * Input/output: raw RGBA pixel buffers.
 */

const AMBER = [251, 191, 36];
const RED = [220, 38, 38];

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

/**
 * Tree cover loss (Hansen/UMD): B = year - 2000, R = loss intensity within the pixel.
 * Color runs amber (2001) → red (latest year); at low zoom alpha follows intensity.
 */
export function decodeLossPixels(rgba: Buffer, zoom: number, maxYearOffset: number): Buffer {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const intensity = rgba[i];
    const year = rgba[i + 2];
    if (rgba[i + 3] === 0 || year < 1 || year > maxYearOffset) continue;
    const [r, g, b] = mix(AMBER, RED, maxYearOffset > 1 ? (year - 1) / (maxYearOffset - 1) : 1);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = zoom >= 12 ? 230 : Math.min(230, 70 + Math.round(intensity * 0.7));
  }
  return out;
}

/**
 * DIST-ALERT (UMD GLAD): R*255 + G = days since 2020-12-31 (0 = no alert),
 * B = confidence * 100 + intensity (confidence 1 = low, 2+ = high).
 */
export function decodeDistPixels(rgba: Buffer): Buffer {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const days = rgba[i] * 255 + rgba[i + 1];
    if (rgba[i + 3] === 0 || days === 0) continue;
    const high = Math.floor(rgba[i + 2] / 100) >= 2;
    out[i] = high ? 249 : 253;
    out[i + 1] = high ? 115 : 186;
    out[i + 2] = high ? 22 : 116;
    out[i + 3] = high ? 235 : 150;
  }
  return out;
}
