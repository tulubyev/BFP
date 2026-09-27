/**
 * Vegetation and burn indices from Sentinel-2 L2A reflectance — pure math, no I/O.
 *
 * - NDVI = (B8A − B04) / (B8A + B04), NBR = (B8A − B12) / (B8A + B12). B8A (narrow NIR, 20 m) is used
 *   instead of B08 (10 m) so both indices share one 20 m grid with B12; B04 (10 m) is read from its
 *   20 m overview.
 * - A pixel counts when its SCL class is clear (the same classes as the scene check, class 2 included)
 *   and no band is nodata (0). Means are over the counted pixels of a region; `validPct` is their share
 *   of the region. Below MIN_VALID_FRACTION the mean is not reported (null) — clouds would decide it.
 * - dNBR = NBR before − NBR after, classes by USGS (Key & Benson 2006).
 * - The "site" is the incident bbox (hotspot centres) grown by half a VIIRS pixel, since each hotspot
 *   stands for a 375 m pixel; the "background" is the AOI minus the site (a ring around it).
 */
import { VIIRS_PIXEL_KM } from '../firmsHistory/clusters';
import type { Grid } from './geometry';
import type { ReflectanceScale } from './render';
import { isClearScl } from './selection';

/** Index grid: 20 m pixels (the B8A/B12/SCL resolution), coarser only when the AOI exceeds 512 px. */
export const INDEX_PIXEL_M = 20;
export const INDEX_MAX_SIDE = 512;
/** A region mean is reported only when at least half of its pixels are clear. */
export const MIN_VALID_FRACTION = 0.5;
export const SITE_PAD_KM = VIIRS_PIXEL_KM / 2;

/** Lower bounds of the USGS dNBR burn severity classes (Key & Benson 2006). */
export const DNBR_THRESHOLDS = { low: 0.1, moderateLow: 0.27, moderateHigh: 0.44, high: 0.66 } as const;

export type SeverityClass = 'unburned' | 'low' | 'moderate-low' | 'moderate-high' | 'high';

export const SEVERITY_LABELS: Record<SeverityClass, string> = {
  unburned: 'не горело / без изменений',
  low: 'низкая степень выгорания',
  'moderate-low': 'умеренно-низкая степень выгорания',
  'moderate-high': 'умеренно-высокая степень выгорания',
  high: 'высокая степень выгорания',
};

export const INDEX_NOTE = 'оценка по двум снимкам Sentinel-2, не полевое обследование';

export const INDEX_REASONS = {
  beforeMissing: 'нет снимка «до» — индексы до пожара не посчитаны',
  afterMissing: 'нет снимка «после» — индексы после пожара не посчитаны',
  beforeCloudy: (pct: number) => `снимок «до»: над участком ${pct}% чистых пикселей, нужно не меньше ${MIN_VALID_FRACTION * 100}%`,
  afterCloudy: (pct: number) => `снимок «после»: над участком ${pct}% чистых пикселей, нужно не меньше ${MIN_VALID_FRACTION * 100}%`,
  duringActivity: 'снимок «после» сделан во время активности: дым и огонь искажают NBR, dNBR не считается',
} as const;

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** (a − b) / (a + b); null when the sum is not positive (division by zero, dark water, noise). Clamped to [−1, 1]. */
export function normalizedDifference(a: number, b: number): number | null {
  const sum = a + b;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  const v = (a - b) / sum;
  return Math.max(-1, Math.min(1, v));
}

export const toReflectance = (dn: number, s: ReflectanceScale) => dn * s.scale + s.offset;

export function ndviOf(redDn: number, nirDn: number, red: ReflectanceScale, nir: ReflectanceScale): number | null {
  if (redDn === 0 || nirDn === 0) return null; // L2A nodata
  return normalizedDifference(toReflectance(nirDn, nir), toReflectance(redDn, red));
}

/** Bands on one grid (same length). `swir` only when NBR is needed. */
export interface IndexBands {
  red: ArrayLike<number>;
  nir: ArrayLike<number>;
  swir?: ArrayLike<number>;
  scl: ArrayLike<number>;
}

export interface IndexScales {
  red: ReflectanceScale;
  nir: ReflectanceScale;
  swir?: ReflectanceScale;
}

export interface RegionIndexStats {
  /** Pixels in the region. */
  total: number;
  /** Clear pixels with valid bands. */
  valid: number;
  /** Whole percent, floored (49.6 % never shows as a passing 50 %). */
  validPct: number;
  /** Means, 3 decimals; null when valid < MIN_VALID_FRACTION of the region (or no swir for NBR). */
  ndvi: number | null;
  nbr: number | null;
}

export function regionIndexStats(bands: IndexBands, scales: IndexScales, mask: ArrayLike<number>): RegionIndexStats {
  let total = 0; let valid = 0; let sumNdvi = 0; let sumNbr = 0;
  const { red, nir, swir, scl } = bands;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    total++;
    if (!isClearScl(scl[i])) continue;
    const ndvi = ndviOf(red[i], nir[i], scales.red, scales.nir);
    if (ndvi === null) continue;
    let nbr = 0;
    if (swir) {
      if (swir[i] === 0 || !scales.swir) continue;
      const v = normalizedDifference(toReflectance(nir[i], scales.nir), toReflectance(swir[i], scales.swir));
      if (v === null) continue;
      nbr = v;
    }
    valid++;
    sumNdvi += ndvi;
    sumNbr += nbr;
  }
  const enough = valid > 0 && valid / total >= MIN_VALID_FRACTION;
  return {
    total,
    valid,
    validPct: total > 0 ? Math.floor((valid / total) * 100) : 0,
    ndvi: enough ? round3(sumNdvi / valid) : null,
    nbr: enough && swir ? round3(sumNbr / valid) : null,
  };
}

/** Ray casting; `poly` in the same units as (x, y). */
export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 1 for grid pixels whose centre lies inside `poly` (grid pixel coordinates, see toGridPixel). A polygon
 * smaller than a pixel still marks the pixel holding its centre, so a region is never empty.
 */
export function polygonMask(grid: Pick<Grid, 'width' | 'height'>, poly: [number, number][]): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height);
  let any = false;
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      if (pointInPolygon(col + 0.5, row + 0.5, poly)) {
        mask[row * grid.width + col] = 1;
        any = true;
      }
    }
  }
  if (!any && poly.length) {
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const col = Math.floor(cx); const row = Math.floor(cy);
    if (col >= 0 && row >= 0 && col < grid.width && row < grid.height) mask[row * grid.width + col] = 1;
  }
  return mask;
}

/** Pixels in `a` but not in `b` (the background ring: AOI minus site). */
export function subtractMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((v, i) => (v && !b[i] ? 1 : 0));
}

export function severityOf(dNbr: number): { class: SeverityClass; label: string } {
  const cls: SeverityClass = dNbr >= DNBR_THRESHOLDS.high ? 'high'
    : dNbr >= DNBR_THRESHOLDS.moderateHigh ? 'moderate-high'
      : dNbr >= DNBR_THRESHOLDS.moderateLow ? 'moderate-low'
        : dNbr >= DNBR_THRESHOLDS.low ? 'low'
          : 'unburned';
  return { class: cls, label: SEVERITY_LABELS[cls] };
}

export interface IndexSide {
  ndvi: number | null;
  nbr: number | null;
  validPct: number;
}

export interface IncidentIndices {
  /** Null when the side has no scene. */
  before: IndexSide | null;
  after: IndexSide | null;
  /** NDVI after − before. */
  dNdvi: number | null;
  /** NBR before − NBR after. */
  dNbr: number | null;
  severity: { class: SeverityClass; label: string } | null;
  /** Why a value is missing (Russian, for the UI). */
  reasons: string[];
  /** Region the means are over: the incident bbox grown by half a VIIRS pixel, cut to the AOI. */
  site: [number, number, number, number];
  note: string;
}

const sideOf = (s: RegionIndexStats): IndexSide => ({ ndvi: s.ndvi, nbr: s.nbr, validPct: s.validPct });

/**
 * Indices of an incident from the site statistics of its before/after scenes (null = no scene).
 * dNBR only when both sides have NBR and "after" was not taken during activity.
 */
export function combineIndices(
  before: RegionIndexStats | null,
  after: RegionIndexStats | null,
  afterDuringActivity: boolean,
  site: [number, number, number, number],
): IncidentIndices {
  const reasons: string[] = [];
  if (!before) reasons.push(INDEX_REASONS.beforeMissing);
  else if (before.ndvi === null) reasons.push(INDEX_REASONS.beforeCloudy(before.validPct));
  if (!after) reasons.push(INDEX_REASONS.afterMissing);
  else if (after.ndvi === null) reasons.push(INDEX_REASONS.afterCloudy(after.validPct));

  const dNdvi = before?.ndvi != null && after?.ndvi != null ? round3(after.ndvi - before.ndvi) : null;
  let dNbr: number | null = null;
  if (before?.nbr != null && after?.nbr != null) {
    if (afterDuringActivity) reasons.push(INDEX_REASONS.duringActivity);
    else dNbr = round3(before.nbr - after.nbr);
  }
  return {
    before: before ? sideOf(before) : null,
    after: after ? sideOf(after) : null,
    dNdvi,
    dNbr,
    severity: dNbr === null ? null : severityOf(dNbr),
    reasons,
    site,
    note: INDEX_NOTE,
  };
}

/** NDVI render scale and palette: brown (bare, burnt) → yellow (sparse) → green (dense vegetation). */
export const NDVI_RENDER_MIN = -0.2;
export const NDVI_RENDER_MAX = 0.9;
export const NDVI_STOPS: [number, [number, number, number]][] = [
  [-0.2, [120, 72, 30]],
  [0.1, [191, 145, 70]],
  [0.35, [240, 220, 100]],
  [0.6, [120, 190, 80]],
  [0.9, [20, 110, 50]],
];

/** Colour of one NDVI value on the palette (clamped to the scale, linear between stops). */
export function ndviColor(v: number): [number, number, number] {
  const x = Math.max(NDVI_RENDER_MIN, Math.min(NDVI_RENDER_MAX, v));
  for (let i = 1; i < NDVI_STOPS.length; i++) {
    const [v1, c1] = NDVI_STOPS[i];
    if (x <= v1) {
      const [v0, c0] = NDVI_STOPS[i - 1];
      const t = (x - v0) / (v1 - v0);
      return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number];
    }
  }
  return NDVI_STOPS[NDVI_STOPS.length - 1][1];
}
