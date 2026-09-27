/**
 * Pure geometry for Sentinel-2 before/after images: the incident AOI, WGS84 → UTM, the output
 * pixel grid, COG overview choice and pixel windows, and resampling a window onto the grid.
 *
 * Images stay in the scene's UTM zone (north up). Over an AOI of ≤ 25 km the rotation between
 * UTM grid north and true north (meridian convergence, a few degrees at most) is not noticeable
 * in a 512 px picture, so we do not warp to WGS84.
 */

/** [minLon, minLat, maxLon, maxLat], degrees WGS84. */
export type Bbox = [number, number, number, number];
/** [minX, minY, maxX, maxY], metres in the scene's UTM zone. */
export type UtmBbox = [number, number, number, number];
/** [x0, y0, x1, y1] pixel window, x1/y1 exclusive. */
export type PixelWindow = [number, number, number, number];

export const MIN_AOI_KM = 3;
export const MAX_AOI_KM = 20;
/** Margin around the incident so its outline does not sit on the image edge. */
export const AOI_MARGIN = 1.2;
export const MAX_OUTPUT_PX = 512;
/** Finest output pixel: Sentinel-2's 10 m bands. */
export const MIN_PIXEL_M = 10;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

export function kmPerDegLon(lat: number): number {
  return KM_PER_DEG_LON_EQUATOR * Math.cos((lat * Math.PI) / 180);
}

/** Width and height of a WGS84 bbox in km, measured at its central latitude. */
export function bboxSizeKm(b: Bbox): { widthKm: number; heightKm: number } {
  const lat = (b[1] + b[3]) / 2;
  return { widthKm: (b[2] - b[0]) * kmPerDegLon(lat), heightKm: (b[3] - b[1]) * KM_PER_DEG_LAT };
}

/** Bbox of the given size (km) centred on (lon, lat), rounded to 5 decimals (~1 m). */
export function bboxAround(lon: number, lat: number, widthKm: number, heightKm: number): Bbox {
  const dLon = widthKm / 2 / kmPerDegLon(lat);
  const dLat = heightKm / 2 / KM_PER_DEG_LAT;
  return [round(lon - dLon, 5), round(lat - dLat, 5), round(lon + dLon, 5), round(lat + dLat, 5)];
}

/**
 * Area of interest for an incident bbox: the bbox with a margin, each side at least 3 km; if the
 * result would be wider than 20 km — a 20 km square around the centre (the image shows the core).
 */
export function expandAoi(b: Bbox): Bbox {
  const lon = (b[0] + b[2]) / 2;
  const lat = (b[1] + b[3]) / 2;
  const { widthKm, heightKm } = bboxSizeKm(b);
  const w = Math.max(MIN_AOI_KM, widthKm * AOI_MARGIN);
  const h = Math.max(MIN_AOI_KM, heightKm * AOI_MARGIN);
  if (Math.max(w, h) > MAX_AOI_KM) return bboxAround(lon, lat, MAX_AOI_KM, MAX_AOI_KM);
  return bboxAround(lon, lat, w, h);
}

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Intersection of two bboxes (callers check bboxIntersects first). */
export function clipBbox(b: Bbox, to: Bbox): Bbox {
  return [Math.max(b[0], to[0]), Math.max(b[1], to[1]), Math.min(b[2], to[2]), Math.min(b[3], to[3])];
}

/** "minLon,minLat,maxLon,maxLat" with 5 decimals — the bbox part of an image URL. */
export function formatBbox(b: Bbox): string {
  return b.map(n => round(n, 5).toFixed(5)).join(',');
}

/** proj4 definition of a WGS84 UTM zone EPSG code (326zz north, 327zz south). */
export function utmProjDef(epsg: number): string {
  const zone = epsg % 100;
  const hemisphere = Math.floor(epsg / 100);
  if (!Number.isInteger(epsg) || zone < 1 || zone > 60 || (hemisphere !== 326 && hemisphere !== 327)) {
    throw new Error(`Not a WGS84 UTM EPSG code: ${epsg}`);
  }
  return `+proj=utm +zone=${zone}${hemisphere === 327 ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
}

export type Project = (lonLat: [number, number]) => [number, number];

/** Envelope of a WGS84 bbox in projected coordinates, sampling each edge (edges curve in UTM). */
export function projectBbox(b: Bbox, project: Project, samplesPerEdge = 8): UtmBbox {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i <= samplesPerEdge; i++) {
    const t = i / samplesPerEdge;
    const lon = b[0] + (b[2] - b[0]) * t;
    const lat = b[1] + (b[3] - b[1]) * t;
    for (const p of [[lon, b[1]], [lon, b[3]], [b[0], lat], [b[2], lat]] as [number, number][]) {
      const [x, y] = project(p);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Output raster: north-up, square pixels, `extent` covers exactly width × height pixels. */
export interface Grid {
  extent: UtmBbox;
  width: number;
  height: number;
  pixelSize: number;
}

/**
 * Grid over a UTM bbox: pixel ≥ 10 m and the long side ≤ 512 px. The extent grows symmetrically
 * to a whole number of pixels.
 */
export function planGrid(b: UtmBbox, maxSide = MAX_OUTPUT_PX, minPixel = MIN_PIXEL_M): Grid {
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  const pixelSize = Math.max(minPixel, Math.max(w, h) / maxSide);
  const width = Math.max(1, Math.min(maxSide, Math.ceil(w / pixelSize - 1e-9)));
  const height = Math.max(1, Math.min(maxSide, Math.ceil(h / pixelSize - 1e-9)));
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  const halfW = (width * pixelSize) / 2;
  const halfH = (height * pixelSize) / 2;
  return { extent: [cx - halfW, cy - halfH, cx + halfW, cy + halfH], width, height, pixelSize };
}

/** One resolution level of a COG (index 0 = full resolution, then overviews). */
export interface CogLevel {
  width: number;
  height: number;
  /** Upper-left corner [x, y] of the level in the scene CRS. */
  origin: [number, number];
  /** Pixel size [x, y]; y is negative for north-up images. */
  resolution: [number, number];
}

/**
 * The coarsest level still at least as fine as `targetRes` (so we only ever downsample); the
 * full-resolution level when even that is coarser than the target.
 */
export function pickLevel(levels: CogLevel[], targetRes: number): number {
  let best = 0;
  levels.forEach((level, i) => {
    const res = Math.abs(level.resolution[0]);
    if (res <= targetRes + 1e-6 && res > Math.abs(levels[best].resolution[0])) best = i;
  });
  return best;
}

/**
 * Pixel window of `level` covering `extent`, clamped to the image. Null when the extent lies
 * entirely outside the image.
 */
export function pixelWindow(extent: UtmBbox, level: CogLevel): PixelWindow | null {
  const [ox, oy] = level.origin;
  const rx = Math.abs(level.resolution[0]);
  const ry = Math.abs(level.resolution[1]);
  const x0 = Math.max(0, Math.floor((extent[0] - ox) / rx));
  const x1 = Math.min(level.width, Math.ceil((extent[2] - ox) / rx));
  const y0 = Math.max(0, Math.floor((oy - extent[3]) / ry));
  const y1 = Math.min(level.height, Math.ceil((oy - extent[1]) / ry));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

export type Resample = 'nearest' | 'bilinear';

/**
 * Resamples one band read from `window` of `level` onto `grid`. 0 is nodata: pixels outside the
 * window stay 0, and bilinear falls back to the nearest pixel next to nodata so edges and masked
 * pixels are not smeared into dark halos.
 */
export function resampleToGrid(
  src: ArrayLike<number>, level: CogLevel, window: PixelWindow, grid: Grid, method: Resample,
): Float32Array {
  const out = new Float32Array(grid.width * grid.height);
  const srcW = window[2] - window[0];
  const srcH = window[3] - window[1];
  const rx = Math.abs(level.resolution[0]);
  const ry = Math.abs(level.resolution[1]);
  // Source coordinates of the window's upper-left pixel corner
  const wx0 = level.origin[0] + window[0] * rx;
  const wy0 = level.origin[1] - window[1] * ry;
  for (let row = 0; row < grid.height; row++) {
    const y = grid.extent[3] - (row + 0.5) * grid.pixelSize;
    const fy = (wy0 - y) / ry - 0.5; // continuous source row (pixel centres at integers)
    for (let col = 0; col < grid.width; col++) {
      const x = grid.extent[0] + (col + 0.5) * grid.pixelSize;
      const fx = (x - wx0) / rx - 0.5;
      const nx = Math.round(fx);
      const ny = Math.round(fy);
      if (nx < 0 || ny < 0 || nx >= srcW || ny >= srcH) continue;
      const nearest = src[ny * srcW + nx];
      if (method === 'nearest' || nearest === 0) {
        out[row * grid.width + col] = nearest;
        continue;
      }
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(fy)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0));
      const ty = Math.max(0, Math.min(1, fy - y0));
      const a = src[y0 * srcW + x0]; const b = src[y0 * srcW + x1];
      const c = src[y1 * srcW + x0]; const d = src[y1 * srcW + x1];
      out[row * grid.width + col] = a === 0 || b === 0 || c === 0 || d === 0
        ? nearest
        : (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/** Projected point → fractional pixel position [col, row] on the grid. */
export function toGridPixel(p: [number, number], grid: Grid): [number, number] {
  return [(p[0] - grid.extent[0]) / grid.pixelSize, (grid.extent[3] - p[1]) / grid.pixelSize];
}
