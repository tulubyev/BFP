/**
 * Reader for the FIRMS annual archive built by scripts/regional (spec 2026-09-26, part A):
 * frontend/public/data/regional/firms-archive.<last year>.json. This module only reads the file;
 * a missing or malformed file means "archive not built yet" and every archive-based indicator is
 * null with that reason — never zero.
 */
import fs from 'fs';
import path from 'path';

export interface ArchiveYearCounts {
  /** VIIRS `type = 0`: presumed vegetation fire. */
  vegetation: number;
  /** `type = 2`: static land source (gas flares, industry). */
  static: number;
  /** `type = 3`: offshore. */
  offshore: number;
  /** Sum of FRP (MW) of vegetation hotspots. */
  frpVegetation: number;
}

export interface FirmsArchive {
  /** File name the archive was read from. */
  file: string;
  version: string;
  generatedAt: string;
  source: { name: string; urls: string[]; license: string };
  years: number[];
  regions: Record<string, { name: string; areaKm2: number; years: Record<string, ArchiveYearCounts> }>;
}

export const ARCHIVE_MISSING_REASON = 'архив FIRMS ещё не собран';

const ARCHIVE_FILE_RE = /^firms-archive\.(\d{4})\.json$/;

/** Newest `firms-archive.<YYYY>.json` among file names, or null. */
export function pickNewestArchiveFile(names: string[]): string | null {
  const matches = names.filter(n => ARCHIVE_FILE_RE.test(n)).sort();
  return matches.length ? matches[matches.length - 1] : null;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Validates the parsed JSON; returns null (with a console warning) when the shape is wrong. */
export function parseFirmsArchive(file: string, json: any): FirmsArchive | null {
  const fail = (why: string) => {
    console.warn(`${file}: ignoring FIRMS archive (${why})`);
    return null;
  };
  if (!json || typeof json !== 'object') return fail('not an object');
  if (!Array.isArray(json.years) || !json.years.every((y: unknown) => Number.isInteger(y))) return fail('bad years');
  if (!json.regions || typeof json.regions !== 'object') return fail('no regions');
  if (typeof json.generatedAt !== 'string' || Number.isNaN(Date.parse(json.generatedAt))) return fail('bad generatedAt');
  const regions: FirmsArchive['regions'] = {};
  for (const [iso, r] of Object.entries<any>(json.regions)) {
    const years: Record<string, ArchiveYearCounts> = {};
    for (const [year, c] of Object.entries<any>(r?.years ?? {})) {
      // A malformed year stays missing (null downstream) rather than becoming a zero
      if (!c || !isCount(c.vegetation) || !isCount(c.static)) continue;
      years[year] = {
        vegetation: c.vegetation,
        static: c.static,
        offshore: isCount(c.offshore) ? c.offshore : 0,
        frpVegetation: isCount(c.frpVegetation) ? c.frpVegetation : 0,
      };
    }
    regions[iso] = { name: String(r?.name ?? iso), areaKm2: Number(r?.areaKm2) || 0, years };
  }
  return {
    file,
    version: String(json.version ?? ''),
    generatedAt: json.generatedAt,
    source: {
      name: String(json.source?.name ?? 'NASA FIRMS'),
      urls: Array.isArray(json.source?.urls) ? json.source.urls.map(String) : [],
      license: String(json.source?.license ?? ''),
    },
    years: [...json.years].sort((a: number, b: number) => a - b),
    regions,
  };
}

/**
 * Years that are complete in the archive: listed in `years` and fully over before the file was
 * generated (a partially covered calendar year must not enter means or deviations).
 */
export function completeYears(archive: Pick<FirmsArchive, 'years' | 'generatedAt'>): number[] {
  const generatedYear = new Date(archive.generatedAt).getUTCFullYear();
  return archive.years.filter(y => y < generatedYear);
}

export const ARCHIVE_DIRS = [
  path.resolve(__dirname, '../../../public/data/regional'),
  path.resolve(__dirname, '../../../frontend/public/data/regional'),
];

/** Reads the newest archive file from `dirs`; null when there is none or it is malformed. */
export function loadFirmsArchive(dirs: string[] = ARCHIVE_DIRS): FirmsArchive | null {
  let best: { name: string; file: string } | null = null;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const newest = pickNewestArchiveFile(names);
    if (newest && (!best || newest > best.name)) best = { name: newest, file: path.join(dir, newest) };
  }
  if (!best) return null;
  try {
    return parseFirmsArchive(best.name, JSON.parse(fs.readFileSync(best.file, 'utf8')));
  } catch (err: any) {
    console.warn(`${best.name}: failed to read FIRMS archive:`, err.message);
    return null;
  }
}
