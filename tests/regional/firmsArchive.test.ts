import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  addCsvLines, ArchiveAccumulator, archiveRegions, BUDGET_GZIP_BYTES, firmsArchiveUrl, parseHeader, parseRow,
  validateOutputs, yearRange, type ArchiveRegion,
} from '../../scripts/regional/aggregate';
import { cellOf, STATIC_CELL_DEG } from '../../backend/services/firmsHistory/staticSources';

const BOUNDARIES = path.resolve(__dirname, '../../frontend/public/data/boundaries/ru-regions.2026-09.geojson');
const SAMPLE = path.resolve(__dirname, 'fixtures/viirs-snpp_2024_Russian_Federation.sample.csv');
const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type';

let regions: ArchiveRegion[];
beforeAll(() => {
  regions = archiveRegions(JSON.parse(fs.readFileSync(BOUNDARIES, 'utf8')));
});

async function sampleAccumulator(years = yearRange(2019, 2024)): Promise<ArchiveAccumulator> {
  const acc = new ArchiveAccumulator(regions, years);
  await addCsvLines(acc, readline.createInterface({ input: fs.createReadStream(SAMPLE), crlfDelay: Infinity }));
  return acc;
}

describe('CSV parsing', () => {
  it('finds columns by name, whatever their order', () => {
    const cols = parseHeader(HEADER);
    expect(cols).toEqual({ lat: 0, lon: 1, date: 5, frp: 12, type: 14 });
    expect(parseHeader('﻿type,frp,acq_date,longitude,latitude\r')).toEqual({ lat: 4, lon: 3, date: 2, frp: 1, type: 0 });
    expect(() => parseHeader('latitude,longitude,acq_date,frp')).toThrow(/type/);
  });

  it('parses rows, treats missing FRP as 0 and rejects malformed ones', () => {
    const cols = parseHeader(HEADER);
    expect(parseRow('58.1,107.2,340,0.4,0.4,2024-05-03,0512,N,VIIRS,n,2,290,12.5,D,0', cols))
      .toEqual({ lat: 58.1, lon: 107.2, year: 2024, frp: 12.5, type: 0 });
    expect(parseRow('58.1,107.2,340,0.4,0.4,2024-05-03,0512,N,VIIRS,n,2,290,,D,2', cols)?.frp).toBe(0);
    expect(parseRow('x,107.2,340,0.4,0.4,2024-05-03,0512,N,VIIRS,n,2,290,1,D,0', cols)).toBeNull();
    expect(parseRow('58.1,107.2,340,0.4,0.4,2024-05-03,0512,N,VIIRS,n,2,290,1,D,', cols)).toBeNull();
    expect(parseRow('', cols)).toBeNull();
  });
});

describe('archiveRegions', () => {
  it('takes all 83 regions with their polygon area', () => {
    expect(regions).toHaveLength(83);
    const irk = regions.find(r => r.shape.iso === 'RU-IRK')!;
    // Official area 774 846 km²; the simplified OSM polygon is within a few per cent.
    expect(irk.areaKm2).toBeGreaterThan(740_000);
    expect(irk.areaKm2).toBeLessThan(800_000);
  });
});

describe('ArchiveAccumulator on the sample CSV', () => {
  it('counts by region, year and type; drops points outside the 83 regions', async () => {
    const acc = await sampleAccumulator();
    const archive = acc.archive(new Date('2026-09-25T00:00:00Z'));
    expect(archive.version).toBe(2024);
    expect(archive.years).toEqual([2019, 2020, 2021, 2022, 2023, 2024]);
    expect(Object.keys(archive.regions)).toHaveLength(83);
    expect(archive.source.urls).toContain(firmsArchiveUrl(2024));

    expect(archive.regions['RU-IRK'].years['2024']).toEqual({ vegetation: 2, static: 2, offshore: 0, frpVegetation: 19.8 });
    expect(archive.regions['RU-IRK'].years['2019']).toEqual({ vegetation: 0, static: 0, offshore: 0, frpVegetation: 0 });
    expect(archive.regions['RU-BU'].years['2024']).toEqual({ vegetation: 1, static: 0, offshore: 1, frpVegetation: 0 });
    // Chukotka across the antimeridian (negative longitude).
    expect(archive.regions['RU-CHU'].years['2024'].vegetation).toBe(1);
    expect(archive.regions['RU-IRK'].name).toBe(regions.find(r => r.shape.iso === 'RU-IRK')!.shape.name);

    // Crimea and the open sea are dropped; Kamchatka volcano is counted nowhere.
    expect(acc.stats).toMatchObject({ rows: 11, malformed: 1, outsideRegions: 2, volcano: 1, outsideYears: 0 });
    const total = Object.values(archive.regions)
      .reduce((s, r) => s + r.years['2024'].vegetation + r.years['2024'].static + r.years['2024'].offshore, 0);
    expect(total).toBe(7);
  });

  it('lists the cells of type = 2 detections of the last three years on the mask grid', async () => {
    const cells = (await sampleAccumulator()).staticCells(new Date('2026-09-25T00:00:00Z'));
    const { row, col } = cellOf(60.7201, 108.0503);
    expect(cells).toMatchObject({ version: 2024, gridDeg: STATIC_CELL_DEG, years: [2022, 2023, 2024] });
    // Both flare detections fall into one cell.
    expect(cells.cells).toEqual([[row, col]]);
  });

  it('does not list static cells of older years and skips rows outside the year range', async () => {
    const acc = await sampleAccumulator(yearRange(2019, 2021));
    expect(acc.staticCells(new Date()).cells).toEqual([]);
    expect(acc.stats.outsideYears).toBe(10);
  });

  it('rejects a CSV without a header', async () => {
    await expect(addCsvLines(new ArchiveAccumulator(regions, [2024]), ['', ''])).rejects.toThrow(/empty/);
  });
});

describe('validateOutputs', () => {
  it('passes the sample only for the years it covers, and checks the region count and size budget', async () => {
    const archive = (await sampleAccumulator()).archive(new Date());
    const problems = validateOutputs(archive, { 'firms-archive.2024.json': 10_000 });
    expect(problems).toHaveLength(5);
    expect(problems[0]).toMatch(/year 2019: no detections/);

    const only2024 = (await sampleAccumulator([2024])).archive(new Date());
    expect(validateOutputs(only2024, { a: 10_000 })).toEqual([]);
    expect(validateOutputs(only2024, { a: BUDGET_GZIP_BYTES + 1 })).toEqual([expect.stringMatching(/^a: gzip/)]);
    const { ['RU-MOW']: _moscow, ...rest } = only2024.regions;
    expect(validateOutputs({ ...only2024, regions: rest }, {})).toEqual(['expected 83 regions, got 82']);
  });
});
