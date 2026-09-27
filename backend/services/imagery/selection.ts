/**
 * Pure rules for picking the "before" and "after" Sentinel-2 scenes of an incident.
 *
 * - Before: scenes in [first_seen − 60 d, first_seen − 1 d], newest first.
 * - After: scenes after last_seen, earliest first; if none is usable (the incident is still
 *   active or too little time has passed) — the newest usable scene between first_seen and
 *   last_seen, flagged `duringActivity`.
 * - A scene is usable when, over the AOI, ≥ 80 % of pixels are clear by the scene classification
 *   (SCL) and ≤ 5 % are nodata (the AOI at the edge of a swath — another tile or date will do).
 */
import type { S2Scene } from './stac';

const DAY_MS = 24 * 60 * 60 * 1000;

export const BEFORE_DAYS = 60;
export const MAX_CANDIDATES = 6;
export const MAX_SEARCH_CLOUD_COVER = 80;
export const MIN_CLEAR_FRACTION = 0.8;
export const MAX_NODATA_FRACTION = 0.05;

/**
 * SCL classes that are NOT clear: 0 nodata, 1 saturated/defective, 3 cloud shadow, 8/9 cloud
 * medium/high probability, 10 thin cirrus, 11 snow/ice. Class 2 (dark area pixels) counts as clear —
 * burn scars often fall into it.
 */
export const SCL_NODATA = 0;
export const SCL_SATURATED = 1;
export const SCL_CLOUD_SHADOW = 3;
export const SCL_CLOUD = [8, 9, 10];
export const SCL_SNOW = 11;

export const NONE_REASONS = {
  beforeCloudy: `нет безоблачных снимков за ${BEFORE_DAYS} дней до обнаружения`,
  afterMissing: 'снимков после обнаружения ещё нет',
  afterCloudy: 'нет безоблачных снимков после обнаружения',
  snow: 'участок под снегом',
} as const;

export interface TimeWindow {
  start: string;
  end: string;
}

export const toInterval = (w: TimeWindow) => `${w.start}/${w.end}`;

export function beforeWindow(firstSeen: string): TimeWindow {
  const t = new Date(firstSeen).getTime();
  return { start: new Date(t - BEFORE_DAYS * DAY_MS).toISOString(), end: new Date(t - DAY_MS).toISOString() };
}

/** Scenes strictly after the last hotspot, up to now; null when last_seen is not in the past. */
export function afterWindow(lastSeen: string, now: Date): TimeWindow | null {
  const t = new Date(lastSeen).getTime() + 1000;
  return t < now.getTime() ? { start: new Date(t).toISOString(), end: now.toISOString() } : null;
}

/** While the incident was burning: from the first to the last hotspot. */
export function activityWindow(firstSeen: string, lastSeen: string): TimeWindow {
  return { start: new Date(firstSeen).toISOString(), end: new Date(lastSeen).toISOString() };
}

/**
 * Candidates in the order they are checked: by date (asc/desc), same-date tiles by lower cloud
 * cover; duplicates dropped; at most MAX_CANDIDATES.
 */
export function orderCandidates(scenes: S2Scene[], sort: 'asc' | 'desc', limit = MAX_CANDIDATES): S2Scene[] {
  const seen = new Set<string>();
  const unique = scenes.filter(s => !seen.has(s.id) && seen.add(s.id));
  const dir = sort === 'asc' ? 1 : -1;
  return unique
    .sort((a, b) => {
      const byDate = (new Date(a.datetime).getTime() - new Date(b.datetime).getTime()) * dir;
      // Same acquisition (neighbouring MGRS tiles): the less cloudy tile first
      if (Math.abs(byDate) > 60_000) return byDate;
      return (a.cloudCover ?? 100) - (b.cloudCover ?? 100);
    })
    .slice(0, limit);
}

export interface SclStats {
  total: number;
  clear: number;
  nodata: number;
  cloud: number;
  shadow: number;
  snow: number;
  saturated: number;
}

/** Whether one SCL class counts as clear (the same rule as the scene check; class 2 is clear). */
export function isClearScl(v: number): boolean {
  return v !== SCL_NODATA && v !== SCL_SATURATED && v !== SCL_CLOUD_SHADOW && v !== SCL_SNOW && !SCL_CLOUD.includes(v);
}

export function sclStats(values: ArrayLike<number>): SclStats {
  const s: SclStats = { total: values.length, clear: 0, nodata: 0, cloud: 0, shadow: 0, snow: 0, saturated: 0 };
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === SCL_NODATA) s.nodata++;
    else if (v === SCL_SATURATED) s.saturated++;
    else if (v === SCL_CLOUD_SHADOW) s.shadow++;
    else if (v === SCL_SNOW) s.snow++;
    else if (SCL_CLOUD.includes(v)) s.cloud++;
    else s.clear++;
  }
  return s;
}

const fraction = (n: number, s: SclStats) => (s.total > 0 ? n / s.total : 0);
export const clearFraction = (s: SclStats) => fraction(s.clear, s);
export const nodataFraction = (s: SclStats) => fraction(s.nodata, s);

export function isUsable(s: SclStats): boolean {
  return s.total > 0 && clearFraction(s) >= MIN_CLEAR_FRACTION && nodataFraction(s) <= MAX_NODATA_FRACTION;
}

/** Snow is what spoils the checked scenes: in most covered candidates it outweighs clouds and covers ≥ 20 %. */
export function mostlySnow(checked: SclStats[]): boolean {
  const covered = checked.filter(s => nodataFraction(s) <= MAX_NODATA_FRACTION);
  if (covered.length === 0) return false;
  const snowy = covered.filter(s => fraction(s.snow, s) >= 0.2 && s.snow >= s.cloud + s.shadow);
  return snowy.length * 2 > covered.length;
}

export interface PickResult {
  scene: S2Scene | null;
  stats: SclStats | null;
  /** Stats of every candidate read, the chosen one included. */
  checked: SclStats[];
}

/** Reads SCL candidate by candidate and returns the first usable scene. */
export async function pickScene(
  candidates: S2Scene[], readScl: (scene: S2Scene) => Promise<SclStats>,
): Promise<PickResult> {
  const checked: SclStats[] = [];
  for (const scene of candidates) {
    const stats = await readScl(scene);
    checked.push(stats);
    if (isUsable(stats)) return { scene, stats, checked };
  }
  return { scene: null, stats: null, checked };
}

export function beforeNoneReason(checked: SclStats[]): string {
  return mostlySnow(checked) ? NONE_REASONS.snow : NONE_REASONS.beforeCloudy;
}

/** `candidateCount` counts scenes found after first_seen (both after and during activity). */
export function afterNoneReason(candidateCount: number, checked: SclStats[]): string {
  if (candidateCount === 0) return NONE_REASONS.afterMissing;
  return mostlySnow(checked) ? NONE_REASONS.snow : NONE_REASONS.afterCloudy;
}

/** Clear share in whole percent for the UI (floored, so 79.6 % never shows as a passing 80 %). */
export function clearPct(s: SclStats): number {
  return Math.floor(clearFraction(s) * 100);
}
