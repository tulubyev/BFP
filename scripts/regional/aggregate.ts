/**
 * Pure aggregation of the NASA FIRMS VIIRS S-NPP yearly country archive (Russia) by region, for
 * regional analytics (#12, docs/superpowers/specs/2026-09-26-regional-analytics-design.md, part A).
 * Input: CSV lines, the ru-regions boundaries FeatureCollection. Output: the two versioned files
 * `firms-archive.<lastYear>.json` and `firms-static-cells.<lastYear>.json`. The only I/O is
 * reading lines from an async iterable; build-firms-archive.ts does the files.
 */
import area from '@turf/area';
import { findRegion, regionsFromGeoJSON, type RegionShape } from '../../backend/services/firmsHistory/regions';
import { cellOf, STATIC_CELL_DEG } from '../../backend/services/firmsHistory/staticSources';

/** FIRMS `type` column. */
export const FIRMS_TYPE = { vegetation: 0, volcano: 1, static: 2, offshore: 3 } as const;

export const EXPECTED_REGIONS = 83;
export const BUDGET_GZIP_BYTES = 300 * 1024;
/** Years of `type = 2` detections that make the static cell list: the last three archive years. */
export const STATIC_CELL_YEAR_COUNT = 3;

export const FIRMS_ARCHIVE_SOURCE_NAME = 'NASA FIRMS, VIIRS S-NPP 375 m, yearly country archive (Russian Federation)';
export const FIRMS_LICENSE = 'NASA open data; cite: NASA FIRMS (https://earthdata.nasa.gov/firms)';

export function firmsArchiveUrl(year: number): string {
  return `https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/${year}/viirs-snpp_${year}_Russian_Federation.csv`;
}

export function yearRange(first: number, last: number): number[] {
  const years: number[] = [];
  for (let y = first; y <= last; y++) years.push(y);
  return years;
}

export interface ArchiveRegion {
  shape: RegionShape;
  areaKm2: number;
}

/** All regions of the boundaries file (features with `properties.iso`), with their area. */
export function archiveRegions(collection: any): ArchiveRegion[] {
  const isos = (collection?.features ?? []).map((f: any) => f?.properties?.iso).filter(Boolean);
  return regionsFromGeoJSON(collection, isos).map(shape => ({
    shape,
    areaKm2: Math.round(area({
      type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: shape.polygons },
    }) / 1e6),
  }));
}

export interface CsvColumns {
  lat: number;
  lon: number;
  date: number;
  frp: number;
  type: number;
}

export interface ArchivePoint {
  lat: number;
  lon: number;
  year: number;
  frp: number;
  type: number;
}

/** Column indexes from the CSV header; throws when a needed column is missing. */
export function parseHeader(line: string): CsvColumns {
  const names = line.trim().replace(/^﻿/, '').split(',').map(n => n.trim().toLowerCase());
  const at = (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`FIRMS CSV: column "${name}" missing in header: ${line.slice(0, 200)}`);
    return i;
  };
  return { lat: at('latitude'), lon: at('longitude'), date: at('acq_date'), frp: at('frp'), type: at('type') };
}

/** Number of a CSV field; blank → NaN (Number('') would be 0). */
const num = (field: string | undefined) => (field === undefined || !field.trim() ? NaN : Number(field));

/** One data line → point, or null when it is blank or malformed. */
export function parseRow(line: string, cols: CsvColumns): ArchivePoint | null {
  if (!line.trim()) return null;
  const f = line.split(',');
  const lat = num(f[cols.lat]);
  const lon = num(f[cols.lon]);
  const year = num(f[cols.date]?.slice(0, 4));
  const type = num(f[cols.type]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isInteger(year) || !Number.isInteger(type)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const frp = num(f[cols.frp]);
  return { lat, lon, year, type, frp: Number.isFinite(frp) && frp > 0 ? frp : 0 };
}

export interface YearCounts {
  vegetation: number;
  static: number;
  offshore: number;
  /** Sum of FRP (MW) of vegetation fire detections, rounded to 0.1. */
  frpVegetation: number;
}

export interface FirmsArchiveFile {
  version: number;
  generatedAt: string;
  source: { name: string; urls: string[]; license: string };
  years: number[];
  regions: Record<string, { name: string; areaKm2: number; years: Record<string, YearCounts> }>;
}

export interface FirmsStaticCellsFile {
  version: number;
  generatedAt: string;
  gridDeg: number;
  /** Years whose `type = 2` detections are in the list. */
  years: number[];
  /** [row, col] of backend/services/firmsHistory/staticSources.ts cellOf(). */
  cells: [number, number][];
}

export interface AggregateStats {
  rows: number;
  malformed: number;
  outsideYears: number;
  /** Points outside all regions of the boundaries file (sea, Crimea etc.) — dropped. */
  outsideRegions: number;
  volcano: number;
  otherType: number;
}

export class ArchiveAccumulator {
  readonly years: number[];
  readonly staticYears: Set<number>;
  readonly stats: AggregateStats = { rows: 0, malformed: 0, outsideYears: 0, outsideRegions: 0, volcano: 0, otherType: 0 };
  private readonly counts = new Map<string, Map<number, YearCounts>>();
  private readonly cells = new Map<string, [number, number]>();
  private readonly shapes: RegionShape[];
  private readonly yearSet: Set<number>;

  constructor(readonly regions: ArchiveRegion[], years: number[]) {
    this.years = [...years].sort((a, b) => a - b);
    this.yearSet = new Set(this.years);
    this.staticYears = new Set(this.years.slice(-STATIC_CELL_YEAR_COUNT));
    this.shapes = regions.map(r => r.shape);
    for (const r of regions) {
      this.counts.set(r.shape.iso, new Map(this.years.map(y => [y, { vegetation: 0, static: 0, offshore: 0, frpVegetation: 0 }])));
    }
  }

  add(p: ArchivePoint | null): void {
    this.stats.rows++;
    if (!p) { this.stats.malformed++; return; }
    if (!this.yearSet.has(p.year)) {
      this.stats.outsideYears++;
      return;
    }
    const region = findRegion(p.lat, p.lon, this.shapes);
    if (!region) { this.stats.outsideRegions++; return; }
    const c = this.counts.get(region.iso)!.get(p.year)!;
    switch (p.type) {
      case FIRMS_TYPE.vegetation:
        c.vegetation++;
        c.frpVegetation += p.frp;
        break;
      case FIRMS_TYPE.static: {
        c.static++;
        if (this.staticYears.has(p.year)) {
          const { row, col } = cellOf(p.lat, p.lon);
          this.cells.set(`${row}:${col}`, [row, col]);
        }
        break;
      }
      case FIRMS_TYPE.offshore:
        c.offshore++;
        break;
      case FIRMS_TYPE.volcano:
        this.stats.volcano++;
        break;
      default:
        this.stats.otherType++;
    }
  }

  archive(generatedAt: Date): FirmsArchiveFile {
    const regions: FirmsArchiveFile['regions'] = {};
    for (const r of [...this.regions].sort((a, b) => a.shape.iso.localeCompare(b.shape.iso))) {
      const years: Record<string, YearCounts> = {};
      for (const [y, c] of this.counts.get(r.shape.iso)!) {
        years[String(y)] = { ...c, frpVegetation: Math.round(c.frpVegetation * 10) / 10 };
      }
      regions[r.shape.iso] = { name: r.shape.name, areaKm2: r.areaKm2, years };
    }
    return {
      version: this.years[this.years.length - 1],
      generatedAt: generatedAt.toISOString(),
      source: { name: FIRMS_ARCHIVE_SOURCE_NAME, urls: this.years.map(firmsArchiveUrl), license: FIRMS_LICENSE },
      years: this.years,
      regions,
    };
  }

  staticCells(generatedAt: Date): FirmsStaticCellsFile {
    const cells = [...this.cells.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return {
      version: this.years[this.years.length - 1],
      generatedAt: generatedAt.toISOString(),
      gridDeg: STATIC_CELL_DEG,
      years: [...this.staticYears].sort((a, b) => a - b),
      cells,
    };
  }
}

/** Feeds CSV lines (header first) into the accumulator; returns the number of data rows. */
export async function addCsvLines(acc: ArchiveAccumulator, lines: AsyncIterable<string> | Iterable<string>): Promise<number> {
  let cols: CsvColumns | null = null;
  let rows = 0;
  for await (const line of lines) {
    if (!cols) {
      if (!line.trim()) continue;
      cols = parseHeader(line);
      continue;
    }
    if (!line.trim()) continue;
    acc.add(parseRow(line, cols));
    rows++;
  }
  if (!cols) throw new Error('FIRMS CSV: empty file');
  return rows;
}

/** Checks before the files are written; returns problems (empty = OK). */
export function validateOutputs(
  archive: FirmsArchiveFile,
  gzipBytes: Record<string, number>,
  expectedRegions: number = EXPECTED_REGIONS,
): string[] {
  const problems: string[] = [];
  const n = Object.keys(archive.regions).length;
  if (n !== expectedRegions) problems.push(`expected ${expectedRegions} regions, got ${n}`);
  for (const y of archive.years) {
    const total = Object.values(archive.regions)
      .reduce((s, r) => s + r.years[String(y)].vegetation + r.years[String(y)].static + r.years[String(y)].offshore, 0);
    if (total === 0) problems.push(`year ${y}: no detections in any region (missing or empty CSV?)`);
  }
  for (const [name, bytes] of Object.entries(gzipBytes)) {
    if (bytes > BUDGET_GZIP_BYTES) problems.push(`${name}: gzip ${Math.round(bytes / 1024)} KB > ${BUDGET_GZIP_BYTES / 1024} KB`);
  }
  return problems;
}
