/**
 * Static heat source mask, built only from our own hotspot history (gis.fire_hotspots) — no
 * external flare catalogue, so no licence to track. Gas flares and industrial sites in northern
 * Irkutsk oblast show up as hotspots at the same spot day after day; forest fires move on.
 *
 * A location is a static source when hotspots within STATIC_RADIUS_KM of it were detected on
 * ≥ STATIC_MIN_DAYS distinct (UTC) days within the last STATIC_WINDOW_DAYS days, and the first and
 * last of those days are ≥ STATIC_MIN_SPAN_DAYS apart. The span rule keeps a fire that smoulders
 * in one place for 4–5 consecutive days from being masked; a flare comes back week after week.
 *
 * The database aggregates hotspots into ~445 m grid cells (per-cell distinct days, cells seen on
 * ≥ 2 days only); this module unions the days of cells whose centroid lies within the radius.
 * With less history than the span rule needs, nothing is masked.
 *
 * Archive cells: a location is also static when its grid cell is listed in the newest
 * `firms-static-cells.<year>.json` (scripts/regional/build-firms-archive.sh: cells where NASA FIRMS
 * flagged `type = 2`, static land source, in its yearly archive). They take effect at once, without
 * waiting for our own history. No such file → history-only behaviour. Only the loader does I/O.
 */
import fs from 'fs';
import path from 'path';
import { haversineKm, type Bbox } from './clusters';

export const STATIC_MIN_DAYS = 4;
export const STATIC_WINDOW_DAYS = 14;
export const STATIC_MIN_SPAN_DAYS = 7;
/** ≈ 1.3 VIIRS pixels: re-detections of one flare land within this of each other. */
export const STATIC_RADIUS_KM = 0.5;
/** Cell height in degrees of latitude (≈ 445 m); cell width is the same in km (lon scaled by cos). */
export const STATIC_CELL_DEG = 0.004;
/** Cells seen on a single day cannot make a location static on their own; the SQL drops them. */
export const STATIC_MIN_CELL_DAYS = 2;
export const STATIC_MASK_METHOD = 'static-mask-v1';

const DAY_MS = 24 * 60 * 60 * 1000;
const KM_PER_DEG_LAT = 111.32;

export interface StaticMaskOptions {
  minDays: number;
  windowDays: number;
  minSpanDays: number;
  radiusKm: number;
}

export const DEFAULT_STATIC_OPTIONS: StaticMaskOptions = {
  minDays: STATIC_MIN_DAYS,
  windowDays: STATIC_WINDOW_DAYS,
  minSpanDays: STATIC_MIN_SPAN_DAYS,
  radiusKm: STATIC_RADIUS_KM,
};

/** One grid cell of hotspot history: centroid of its detections and the distinct days (YYYY-MM-DD). */
export interface HeatCell {
  row: number;
  col: number;
  lat: number;
  lon: number;
  days: string[];
}

/** Grid row/column of a point; the SQL in store.ts (LOAD_HEAT_CELLS_SQL) computes the same. */
export function cellOf(lat: number, lon: number): { row: number; col: number } {
  const row = Math.floor(lat / STATIC_CELL_DEG);
  return { row, col: colAt(row, lon) };
}

function colAt(row: number, lon: number): number {
  return Math.floor((lon * Math.cos(rowLatRad(row))) / STATIC_CELL_DEG);
}

function rowLatRad(row: number): number {
  return ((row + 0.5) * STATIC_CELL_DEG * Math.PI) / 180;
}

/** Centre of a grid cell (inverse of cellOf). */
export function cellCenter(row: number, col: number): { lat: number; lon: number } {
  return { lat: (row + 0.5) * STATIC_CELL_DEG, lon: ((col + 0.5) * STATIC_CELL_DEG) / Math.cos(rowLatRad(row)) };
}

const cellKey = (row: number, col: number) => `${row}:${col}`;

/** First day (YYYY-MM-DD, UTC) of the window: today and the windowDays − 1 days before it. */
export function staticWindowStart(now: Date, windowDays: number = STATIC_WINDOW_DAYS): string {
  return new Date(now.getTime() - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days between the earliest and the latest of `days`. */
export function daySpan(days: string[]): number {
  if (!days.length) return 0;
  const sorted = [...days].sort();
  return Math.round((Date.parse(sorted[sorted.length - 1]) - Date.parse(sorted[0])) / DAY_MS);
}

export function isStaticDays(days: string[], opts: StaticMaskOptions = DEFAULT_STATIC_OPTIONS): boolean {
  const distinct = [...new Set(days)];
  return distinct.length >= opts.minDays && daySpan(distinct) >= opts.minSpanDays;
}

/**
 * In-memory equivalent of LOAD_HEAT_CELLS_SQL, for tests and fakes: rows already limited to the
 * window and area, grouped by cell, cells with fewer than `minCellDays` distinct days dropped.
 */
export function aggregateCells(
  rows: { lat: number; lon: number; acqDate: string }[],
  minCellDays: number = STATIC_MIN_CELL_DAYS,
): HeatCell[] {
  const cells = new Map<string, { row: number; col: number; lat: number; lon: number; n: number; days: Set<string> }>();
  for (const r of rows) {
    const { row, col } = cellOf(r.lat, r.lon);
    const key = `${row}:${col}`;
    const c = cells.get(key) ?? { row, col, lat: 0, lon: 0, n: 0, days: new Set<string>() };
    c.lat += r.lat;
    c.lon += r.lon;
    c.n++;
    c.days.add(r.acqDate);
    cells.set(key, c);
  }
  return [...cells.values()]
    .filter(c => c.days.size >= minCellDays)
    .map(c => ({ row: c.row, col: c.col, lat: c.lat / c.n, lon: c.lon / c.n, days: [...c.days].sort() }));
}

/** Static land source cells from the FIRMS yearly archive (grid of cellOf). */
export interface ArchiveStaticCells {
  /** Last archive year the cells come from, e.g. 2024; null when there is no file. */
  version: number | null;
  /** `${row}:${col}` keys. */
  keys: ReadonlySet<string>;
}

export const NO_ARCHIVE_CELLS: ArchiveStaticCells = { version: null, keys: new Set() };

/**
 * Parses `firms-static-cells.<year>.json` (`{ version, gridDeg, cells: [[row, col], …] }`).
 * A file on another grid would mask the wrong places, so it is rejected, as is any malformed file.
 */
export function parseArchiveStaticCells(json: any): ArchiveStaticCells {
  if (json?.gridDeg !== STATIC_CELL_DEG || !Array.isArray(json.cells)) {
    throw new Error(`firms-static-cells: expected gridDeg ${STATIC_CELL_DEG} and a cells array`);
  }
  const keys = new Set<string>();
  for (const c of json.cells) {
    if (Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1])) keys.add(cellKey(c[0], c[1]));
  }
  const version = Number(json.version);
  return { version: Number.isFinite(version) ? version : null, keys };
}

export interface StaticMask {
  readonly options: StaticMaskOptions;
  /** Distinct days with detections within the radius of the point, sorted. */
  daysNear(lat: number, lon: number): string[];
  /** Static by our history (the day rule) or by the FIRMS archive (its cell is listed). */
  isStatic(lat: number, lon: number): boolean;
  /** Cells that are static locations by our history (their neighbourhood passes the rule). */
  staticCells: HeatCell[];
  /** Number of archive cells in the mask. */
  archiveCells: number;
  /** Year of the archive cell list, null without one. */
  archiveVersion: number | null;
  /** True when some static location lies within the radius of the box — worth a closer look. */
  touches(bbox: Bbox): boolean;
}

export function buildStaticMask(
  cells: HeatCell[],
  opts: StaticMaskOptions = DEFAULT_STATIC_OPTIONS,
  archive: ArchiveStaticCells = NO_ARCHIVE_CELLS,
): StaticMask {
  const index = new Map<string, HeatCell[]>();
  for (const c of cells) {
    const key = cellKey(c.row, c.col);
    index.set(key, [...(index.get(key) ?? []), c]);
  }
  // Centroids within the radius can sit up to this many cells away from the point's own cell.
  const reach = Math.ceil(opts.radiusKm / (STATIC_CELL_DEG * KM_PER_DEG_LAT)) + 1;

  const daysNear = (lat: number, lon: number): string[] => {
    const days = new Set<string>();
    const row = Math.floor(lat / STATIC_CELL_DEG);
    for (let dr = -reach; dr <= reach; dr++) {
      // Columns are scaled per row, so find the point's column in each neighbouring row.
      const col = colAt(row + dr, lon);
      for (let dc = -reach; dc <= reach; dc++) {
        for (const c of index.get(cellKey(row + dr, col + dc)) ?? []) {
          if (haversineKm(lat, lon, c.lat, c.lon) <= opts.radiusKm) for (const d of c.days) days.add(d);
        }
      }
    }
    return [...days].sort();
  };

  const byHistory = (lat: number, lon: number) => isStaticDays(daysNear(lat, lon), opts);
  const inArchive = (lat: number, lon: number) => {
    if (!archive.keys.size) return false;
    const { row, col } = cellOf(lat, lon);
    return archive.keys.has(cellKey(row, col));
  };
  const isStatic = (lat: number, lon: number) => inArchive(lat, lon) || byHistory(lat, lon);
  const staticCells = cells.filter(c => byHistory(c.lat, c.lon));
  const archiveCenters = [...archive.keys].map(k => {
    const [row, col] = k.split(':').map(Number);
    return cellCenter(row, col);
  });

  const touches = (bbox: Bbox): boolean => {
    const padLat = opts.radiusKm / KM_PER_DEG_LAT;
    const near = (c: { lat: number; lon: number }) => {
      const padLon = padLat / Math.max(Math.cos((c.lat * Math.PI) / 180), 0.01);
      return c.lat >= bbox.minLat - padLat && c.lat <= bbox.maxLat + padLat
        && c.lon >= bbox.minLon - padLon && c.lon <= bbox.maxLon + padLon;
    };
    return staticCells.some(near) || archiveCenters.some(near);
  };

  return { options: opts, daysNear, isStatic, staticCells, archiveCells: archive.keys.size, archiveVersion: archive.keys.size ? archive.version : null, touches };
}

/** Splits points into those at static locations and the rest. */
export function partitionStatic<T extends { lat: number; lon: number }>(points: T[], mask: StaticMask): { kept: T[]; masked: T[] } {
  const kept: T[] = [];
  const masked: T[] = [];
  for (const p of points) (mask.isStatic(p.lat, p.lon) ? masked : kept).push(p);
  return { kept, masked };
}

/**
 * An incident is a static source when every one of its hotspots is at a static location.
 * No points (history pruned, bbox mismatch) → not enough evidence → false.
 */
export function isStaticIncident(points: { lat: number; lon: number }[], mask: StaticMask): boolean {
  return points.length > 0 && points.every(p => mask.isStatic(p.lat, p.lon));
}

/** Provenance stored on a re-labelled incident (metadata.static_mask). */
export interface StaticMaskInfo {
  method: typeof STATIC_MASK_METHOD;
  min_days: number;
  window_days: number;
  min_span_days: number;
  radius_m: number;
  /** Year of the FIRMS archive cell list in use (firms-static-cells.<year>.json); absent without one. */
  archive_version?: number;
  marked_at: string;
}

export function staticMaskInfo(
  now: Date,
  opts: StaticMaskOptions = DEFAULT_STATIC_OPTIONS,
  archiveVersion: number | null = null,
): StaticMaskInfo {
  return {
    method: STATIC_MASK_METHOD,
    min_days: opts.minDays,
    window_days: opts.windowDays,
    min_span_days: opts.minSpanDays,
    radius_m: Math.round(opts.radiusKm * 1000),
    ...(archiveVersion !== null ? { archive_version: archiveVersion } : {}),
    marked_at: now.toISOString(),
  };
}

const ARCHIVE_CELLS_FILE_RE = /^firms-static-cells\.(\d{4})\.json$/;

/** Newest `firms-static-cells.<year>.json` among file names, or null. */
export function pickNewestArchiveCellsFile(names: string[]): string | null {
  const matches = names.filter(n => ARCHIVE_CELLS_FILE_RE.test(n)).sort();
  return matches.length ? matches[matches.length - 1] : null;
}

/**
 * Where the regional data lives: `public/` next to `dist/` in the Docker image (vite build output),
 * `frontend/public/` in a dev checkout.
 */
export const REGIONAL_DATA_DIRS = [
  path.resolve(__dirname, '../../../public/data/regional'),
  path.resolve(__dirname, '../../../frontend/public/data/regional'),
];

let loadedArchive: { dirs: string; cells: ArchiveStaticCells } | null = null;

/**
 * Loads (once per list of dirs) the newest archive cell list. No file → no archive cells
 * (history-only mask); an unreadable or malformed file is logged and ignored the same way.
 */
export function loadArchiveStaticCells(dirs: string[] = REGIONAL_DATA_DIRS): ArchiveStaticCells {
  const key = dirs.join('\n');
  if (loadedArchive?.dirs === key) return loadedArchive.cells;
  let best: { name: string; file: string } | null = null;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const newest = pickNewestArchiveCellsFile(names);
    if (newest && (!best || newest > best.name)) best = { name: newest, file: path.join(dir, newest) };
  }
  let cells = NO_ARCHIVE_CELLS;
  if (best) {
    try {
      cells = parseArchiveStaticCells(JSON.parse(fs.readFileSync(best.file, 'utf8')));
    } catch (err: any) {
      console.warn(`[firms-history] ${best.name} ignored:`, err?.message ?? err);
    }
  }
  loadedArchive = { dirs: key, cells };
  return cells;
}
