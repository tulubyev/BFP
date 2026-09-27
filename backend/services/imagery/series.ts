/**
 * Summer NDVI time series of an incident: one Sentinel-2 scene per year in the peak-vegetation, snow-free
 * window 1 July – 31 August, from 2017 (both Sentinel-2 satellites in orbit) to the current year.
 *
 * - Candidates: STAC search over the AOI, tile cloud cover < 80 %, least cloudy first (a summer window
 *   holds dozens of scenes; by date we would only ever look at its first or last days). The first
 *   candidate that passes the same SCL check as the before/after scenes (≥ 80 % clear, ≤ 5 % nodata over
 *   the AOI) is the year's scene.
 * - Values: mean NDVI over the incident site and over the background ring (AOI minus site), so a change
 *   on the site can be told from one over the whole area (drought, late spring).
 * - A year without a usable scene is `status: 'none'` with a reason — never interpolated.
 * - The current year is `partial` until its window ends.
 */
import { expandAoi, formatBbox, type Bbox } from './geometry';
import { MAX_CANDIDATES, MAX_SEARCH_CLOUD_COVER, clearPct, isUsable, sclStats, toInterval, type TimeWindow } from './selection';
import {
  incidentSite, indexPlan, readSceneBand, readSceneIndices, type ImageryDeps,
} from './service';
import { platformLabel, type S2Scene } from './stac';

export const SERIES_FIRST_YEAR = 2017;
/** Window of every year, month-day (UTC). */
export const SUMMER_WINDOW = { start: '07-01', end: '08-31' } as const;
export const SUMMER_LABEL = '1 июля – 31 августа';

const DAY_SEC = 24 * 60 * 60;
/** Past years never change; the current one gains scenes until its window ends. */
export const YEAR_TTL_PAST_SEC = 365 * DAY_SEC;
export const YEAR_TTL_CURRENT_SEC = 7 * DAY_SEC;
export const SERIES_TTL_SEC = DAY_SEC;

export const SERIES_REASONS = {
  noScenes: `нет снимков за ${SUMMER_LABEL}`,
  cloudy: `нет безоблачных снимков за ${SUMMER_LABEL}`,
  notYet: 'снимков этого лета пока нет',
} as const;

export interface RegionNdvi {
  /** Mean NDVI, 3 decimals; null when fewer than half of the region's pixels are clear. */
  ndvi: number | null;
  validPct: number;
}

export type SeriesYear =
  | {
    year: number;
    status: 'ok';
    sceneId: string;
    datetime: string;
    platform: string;
    /** Clear pixels over the AOI, whole percent (scene check). */
    clearPct: number;
    site: RegionNdvi;
    background: RegionNdvi;
    partial?: true;
  }
  | { year: number; status: 'none'; reason: string; partial?: true };

/** What a series is computed for: the incident AOI and site; `key` identifies both in Redis keys. */
export interface SeriesTarget {
  aoi: Bbox;
  site: Bbox;
  key: string;
}

export function seriesTarget(incidentBbox: Bbox): SeriesTarget {
  const aoi = expandAoi(incidentBbox);
  const site = incidentSite(incidentBbox, aoi);
  // The site is part of the key: two incidents at one place can share an AOI (3 km minimum) with different sites
  return { aoi, site, key: `${formatBbox(aoi)}|${formatBbox(site)}` };
}

export const yearKey = (t: SeriesTarget, year: number) => `imagery:ndvi-year:v1:${t.key}:${year}`;
export const seriesKey = (t: SeriesTarget) => `imagery:ndvi-series:v1:${t.key}`;

export function summerWindow(year: number): TimeWindow {
  return { start: `${year}-${SUMMER_WINDOW.start}T00:00:00.000Z`, end: `${year}-${SUMMER_WINDOW.end}T23:59:59.999Z` };
}

/** Years from 2017 whose window has started (the current year only from 1 July). */
export function seriesYears(now: Date): number[] {
  const y = now.getUTCFullYear();
  const last = now.getTime() >= new Date(summerWindow(y).start).getTime() ? y : y - 1;
  const years: number[] = [];
  for (let year = SERIES_FIRST_YEAR; year <= last; year++) years.push(year);
  return years;
}

export const isPartial = (year: number, now: Date) => now.getTime() < new Date(summerWindow(year).end).getTime();

/** The window cut at `now` (the search must not ask for the future). */
export function searchWindow(year: number, now: Date): TimeWindow {
  const w = summerWindow(year);
  return isPartial(year, now) ? { start: w.start, end: now.toISOString() } : w;
}

export const yearTtlSec = (year: number, now: Date) => (year < now.getUTCFullYear() ? YEAR_TTL_PAST_SEC : YEAR_TTL_CURRENT_SEC);

/** Unique scenes, least cloudy first (stable for equal or unknown cover), at most `limit`. */
export function orderByCloud(scenes: S2Scene[], limit = MAX_CANDIDATES): S2Scene[] {
  const seen = new Set<string>();
  return scenes
    .filter(s => !seen.has(s.id) && seen.add(s.id))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => ((a.s.cloudCover ?? 100) - (b.s.cloudCover ?? 100)) || a.i - b.i)
    .map(x => x.s)
    .slice(0, limit);
}

const regionNdvi = (s: RegionNdvi): RegionNdvi => ({ ndvi: s.ndvi, validPct: s.validPct });

/** One year of the series. STAC or COG failures reject (the caller must not cache them). */
export async function computeSeriesYear(target: SeriesTarget, year: number, deps: ImageryDeps): Promise<SeriesYear> {
  const now = deps.now?.() ?? new Date();
  const partial = isPartial(year, now) ? { partial: true as const } : {};
  const found = await deps.stac.search({
    bbox: target.aoi, datetime: toInterval(searchWindow(year, now)), sort: 'asc', sortBy: 'cloud',
    limit: MAX_CANDIDATES, maxCloudCover: MAX_SEARCH_CLOUD_COVER,
  });
  const candidates = orderByCloud(found);
  if (candidates.length === 0) return { year, status: 'none', reason: partial.partial ? SERIES_REASONS.notYet : SERIES_REASONS.noScenes, ...partial };

  for (const scene of candidates) {
    const plan = indexPlan(scene.epsg, target.aoi, target.site);
    // SCL on the index grid serves both the scene check and the index mask
    const scl = await readSceneBand(scene, 'scl', plan.grid, deps);
    const stats = sclStats(scl);
    if (!isUsable(stats)) continue;
    const { site, ring } = await readSceneIndices(scene, plan, deps, { nbr: false, scl });
    return {
      year,
      status: 'ok',
      sceneId: scene.id,
      datetime: scene.datetime,
      platform: platformLabel(scene),
      clearPct: clearPct(stats),
      site: regionNdvi(site),
      background: regionNdvi(ring),
      ...partial,
    };
  }
  return { year, status: 'none', reason: SERIES_REASONS.cloudy, ...partial };
}
