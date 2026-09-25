import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  aggregateCells, buildStaticMask, cellCenter, cellOf, daySpan, DEFAULT_STATIC_OPTIONS, isStaticDays, isStaticIncident,
  loadArchiveStaticCells, NO_ARCHIVE_CELLS, parseArchiveStaticCells, partitionStatic, pickNewestArchiveCellsFile,
  STATIC_CELL_DEG, STATIC_MIN_DAYS, STATIC_MIN_SPAN_DAYS, STATIC_RADIUS_KM, STATIC_WINDOW_DAYS,
  staticMaskInfo, staticWindowStart, type HeatCell,
} from '../../../backend/services/firmsHistory/staticSources';
import { haversineKm } from '../../../backend/services/firmsHistory/clusters';
import {
  asHistory, days, FLARE, flareHotspots, MOVING_FIRE, movingFireHotspots, ONE_DAY_FIRE, oneDayFireHotspots,
} from './fixtures';

const maskOf = (list: { lat: number; lon: number; acqDate: string }[]) => buildStaticMask(aggregateCells(list));

describe('defaults', () => {
  it('are 4 distinct days within 14, spread over ≥ 7 days, within 500 m', () => {
    expect({ STATIC_MIN_DAYS, STATIC_WINDOW_DAYS, STATIC_MIN_SPAN_DAYS, STATIC_RADIUS_KM })
      .toEqual({ STATIC_MIN_DAYS: 4, STATIC_WINDOW_DAYS: 14, STATIC_MIN_SPAN_DAYS: 7, STATIC_RADIUS_KM: 0.5 });
  });

  it('uses ~445 m square cells', () => {
    const a = cellOf(60.7201, 108.0503);
    // One cell up and one cell right are each ≈ 0.445 km away.
    expect(haversineKm(60.7201, 108.0503, 60.7201 + STATIC_CELL_DEG, 108.0503)).toBeCloseTo(0.445, 2);
    const lonStep = STATIC_CELL_DEG / Math.cos((60.72 * Math.PI) / 180);
    expect(cellOf(60.7201, 108.0503 + lonStep).col).toBe(a.col + 1);
    expect(cellOf(60.7201 + STATIC_CELL_DEG, 108.0503).row).toBe(a.row + 1);
  });
});

describe('staticWindowStart', () => {
  it('covers today and the 13 days before it (UTC)', () => {
    expect(staticWindowStart(new Date('2026-10-08T23:30:00Z'))).toBe('2026-09-25');
    expect(staticWindowStart(new Date('2026-10-08T00:10:00Z'), 1)).toBe('2026-10-08');
  });
});

describe('isStaticDays', () => {
  it('needs enough distinct days and a wide enough span', () => {
    expect(daySpan(['2026-09-25', '2026-10-02', '2026-09-28'])).toBe(7);
    expect(isStaticDays(['2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02'])).toBe(true);
    // 4 consecutive days in one place: a lingering fire, not (yet) a flare.
    expect(isStaticDays(days('2026-09-25', 4))).toBe(false);
    // Only 3 distinct days, even if repeated.
    expect(isStaticDays(['2026-09-25', '2026-09-25', '2026-09-28', '2026-10-02'])).toBe(false);
    expect(isStaticDays([])).toBe(false);
  });
});

describe('aggregateCells', () => {
  it('groups by cell with distinct days and drops cells seen on a single day', () => {
    const cells = aggregateCells([
      { lat: 60.72, lon: 108.05, acqDate: '2026-09-25' },
      { lat: 60.7201, lon: 108.0501, acqDate: '2026-09-25' },
      { lat: 60.7202, lon: 108.0502, acqDate: '2026-09-26' },
      { lat: 58.0, lon: 107.0, acqDate: '2026-09-25' }, // one day only → dropped
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0].days).toEqual(['2026-09-25', '2026-09-26']);
    expect(cells[0].lat).toBeCloseTo(60.7201, 6);
    expect(cellOf(cells[0].lat, cells[0].lon)).toEqual({ row: cells[0].row, col: cells[0].col });
  });
});

describe('buildStaticMask — the three situations', () => {
  const window = days('2026-09-25', 14); // 25 Sep – 8 Oct

  it('masks a flare seen on most days of the window', () => {
    const mask = maskOf(asHistory(flareHotspots(window.filter((_, i) => i % 3 !== 0)))); // cloudy every 3rd day
    expect(mask.isStatic(FLARE.lat, FLARE.lon)).toBe(true);
    expect(mask.daysNear(FLARE.lat, FLARE.lon)).toHaveLength(9);
    expect(mask.staticCells.length).toBeGreaterThanOrEqual(1);
    // 1 km away is outside the 500 m radius.
    expect(mask.isStatic(FLARE.lat + 0.009, FLARE.lon)).toBe(false);
  });

  it('masks a flare whose detections straddle a cell boundary', () => {
    // Put the flare exactly on a row boundary: detections alternate between two cells (2 + 2 days).
    const edgeLat = Math.round(FLARE.lat / STATIC_CELL_DEG) * STATIC_CELL_DEG;
    const list = ['2026-09-25', '2026-09-28', '2026-09-30', '2026-10-03'].map((d, i) => ({
      lat: edgeLat + (i % 2 ? 0.0003 : -0.0003), lon: FLARE.lon, acqDate: d,
    }));
    const cells = aggregateCells(list);
    expect(cells).toHaveLength(2);
    expect(buildStaticMask(cells).isStatic(edgeLat, FLARE.lon)).toBe(true);
  });

  it('does not mask a fire moving over several days', () => {
    const fire = movingFireHotspots(window.slice(0, 6));
    const mask = maskOf(asHistory(fire));
    // Spots re-detected on the next day do reach the history (cells with 2 days)…
    expect(aggregateCells(asHistory(fire)).length).toBeGreaterThan(0);
    // …but none is static.
    expect(fire.some(h => mask.isStatic(h.latitude, h.longitude))).toBe(false);
    expect(mask.staticCells).toEqual([]);
  });

  it('does not mask a one-day fire', () => {
    const mask = maskOf(asHistory(oneDayFireHotspots('2026-10-01')));
    expect(mask.isStatic(ONE_DAY_FIRE.lat, ONE_DAY_FIRE.lon)).toBe(false);
  });

  it('does not mask a fire that smoulders in one place for 5 consecutive days', () => {
    const mask = maskOf(asHistory(flareHotspots(days('2026-09-30', 5), MOVING_FIRE)));
    expect(mask.daysNear(MOVING_FIRE.lat, MOVING_FIRE.lon)).toHaveLength(5);
    expect(mask.isStatic(MOVING_FIRE.lat, MOVING_FIRE.lon)).toBe(false);
  });

  it('masks nothing while history is short (1–2 days, or less than the 7-day span)', () => {
    expect(maskOf(asHistory(flareHotspots(days('2026-09-25', 1)))).staticCells).toEqual([]);
    expect(maskOf(asHistory(flareHotspots(days('2026-09-25', 2)))).staticCells).toEqual([]);
    expect(maskOf(asHistory(flareHotspots(days('2026-09-25', 7)))).staticCells).toEqual([]);
    // Day 8 of daily detections: span 7 days → static.
    expect(maskOf(asHistory(flareHotspots(days('2026-09-25', 8)))).isStatic(FLARE.lat, FLARE.lon)).toBe(true);
  });

  it('keeps a real fire next to a flare: only the flare pixels are masked', () => {
    const flare = flareHotspots(window);
    const nearFire = [
      { latitude: FLARE.lat + 0.012, longitude: FLARE.lon, acq_date: '2026-10-08' }, // ~1.3 km north
      { latitude: FLARE.lat + 0.015, longitude: FLARE.lon + 0.004, acq_date: '2026-10-08' },
    ];
    const mask = maskOf(asHistory([...flare, ...nearFire as any]));
    const today = [...flare.slice(-2), ...nearFire].map(h => ({ lat: h.latitude, lon: h.longitude }));
    const { kept, masked } = partitionStatic(today, mask);
    expect(masked).toHaveLength(2);
    expect(kept).toHaveLength(2);
  });

  it('respects custom options', () => {
    const list = asHistory(flareHotspots(days('2026-09-25', 3)));
    const strict = buildStaticMask(aggregateCells(list), { ...DEFAULT_STATIC_OPTIONS, minDays: 3, minSpanDays: 2 });
    expect(strict.isStatic(FLARE.lat, FLARE.lon)).toBe(true);
  });
});

describe('touches / isStaticIncident', () => {
  const cells: HeatCell[] = aggregateCells(asHistory(flareHotspots(days('2026-09-25', 10))));
  const mask = buildStaticMask(cells);

  it('pre-selects only incidents whose box is near a static location', () => {
    expect(mask.touches({ minLat: FLARE.lat, minLon: FLARE.lon, maxLat: FLARE.lat, maxLon: FLARE.lon })).toBe(true);
    // Box ending ~300 m south of the flare: within the radius.
    expect(mask.touches({ minLat: 60.70, minLon: 108.04, maxLat: FLARE.lat - 0.0027, maxLon: 108.06 })).toBe(true);
    expect(mask.touches({ minLat: 58.0, minLon: 107.0, maxLat: 58.1, maxLon: 107.1 })).toBe(false);
  });

  it('needs every hotspot of the incident at a static location', () => {
    expect(isStaticIncident([{ lat: FLARE.lat, lon: FLARE.lon }, { lat: FLARE.lat + 0.001, lon: FLARE.lon }], mask)).toBe(true);
    expect(isStaticIncident([{ lat: FLARE.lat, lon: FLARE.lon }, { lat: FLARE.lat + 0.02, lon: FLARE.lon }], mask)).toBe(false);
    expect(isStaticIncident([], mask)).toBe(false);
  });
});

describe('staticMaskInfo', () => {
  it('records the rule used, for provenance', () => {
    expect(staticMaskInfo(new Date('2026-10-08T12:00:00Z'))).toEqual({
      method: 'static-mask-v1', min_days: 4, window_days: 14, min_span_days: 7, radius_m: 500,
      marked_at: '2026-10-08T12:00:00.000Z',
    });
  });
});

describe('archive cells (FIRMS yearly archive, type = 2) united with the history rule', () => {
  const flareCell = cellOf(FLARE.lat, FLARE.lon);
  const archiveFile = (cells: unknown[], over: object = {}) =>
    ({ version: 2024, generatedAt: '2026-09-25T00:00:00.000Z', gridDeg: STATIC_CELL_DEG, years: [2022, 2023, 2024], cells, ...over });
  const archive = parseArchiveStaticCells(archiveFile([[flareCell.row, flareCell.col]]));

  it('parses the cell list and rejects another grid', () => {
    expect(archive.version).toBe(2024);
    expect([...archive.keys]).toEqual([`${flareCell.row}:${flareCell.col}`]);
    expect(parseArchiveStaticCells(archiveFile([[1, 2], ['x', 3], [4], 5, [6, 7.5]])).keys).toEqual(new Set(['1:2']));
    expect(() => parseArchiveStaticCells(archiveFile([], { gridDeg: 0.01 }))).toThrow(/gridDeg/);
    expect(() => parseArchiveStaticCells({ gridDeg: STATIC_CELL_DEG })).toThrow(/cells/);
  });

  it('cellCenter is the inverse of cellOf', () => {
    const c = cellCenter(flareCell.row, flareCell.col);
    expect(cellOf(c.lat, c.lon)).toEqual(flareCell);
  });

  it('masks a listed cell at once, with no history at all', () => {
    const mask = buildStaticMask([], DEFAULT_STATIC_OPTIONS, archive);
    expect(mask.isStatic(FLARE.lat, FLARE.lon)).toBe(true);
    expect(mask.staticCells).toEqual([]);
    expect(mask.archiveCells).toBe(1);
    expect(mask.archiveVersion).toBe(2024);
    // Only the listed cell: the next cell north (≈ 445 m) is not masked without history.
    expect(mask.isStatic(FLARE.lat + STATIC_CELL_DEG, FLARE.lon)).toBe(false);
    expect(mask.isStatic(ONE_DAY_FIRE.lat, ONE_DAY_FIRE.lon)).toBe(false);
  });

  it('keeps the history rule: history-static places stay static, a lingering fire still is not', () => {
    const elsewhere = parseArchiveStaticCells(archiveFile([[1, 2]]));
    const history = asHistory(flareHotspots(days('2026-09-25', 8)));
    expect(buildStaticMask(aggregateCells(history), DEFAULT_STATIC_OPTIONS, elsewhere).isStatic(FLARE.lat, FLARE.lon)).toBe(true);
    const smoulder = asHistory(flareHotspots(days('2026-09-30', 5), MOVING_FIRE));
    expect(buildStaticMask(aggregateCells(smoulder), DEFAULT_STATIC_OPTIONS, archive).isStatic(MOVING_FIRE.lat, MOVING_FIRE.lon)).toBe(false);
  });

  it('touches and isStaticIncident see archive cells', () => {
    const mask = buildStaticMask([], DEFAULT_STATIC_OPTIONS, archive);
    expect(mask.touches({ minLat: FLARE.lat, minLon: FLARE.lon, maxLat: FLARE.lat, maxLon: FLARE.lon })).toBe(true);
    expect(mask.touches({ minLat: 58.0, minLon: 107.0, maxLat: 58.1, maxLon: 107.1 })).toBe(false);
    expect(isStaticIncident([{ lat: FLARE.lat, lon: FLARE.lon }], mask)).toBe(true);
    expect(isStaticIncident([{ lat: FLARE.lat, lon: FLARE.lon }, { lat: FLARE.lat + 0.02, lon: FLARE.lon }], mask)).toBe(false);
  });

  it('without an archive behaves as before', () => {
    const mask = buildStaticMask([], DEFAULT_STATIC_OPTIONS, NO_ARCHIVE_CELLS);
    expect(mask).toMatchObject({ archiveCells: 0, archiveVersion: null });
    expect(mask.isStatic(FLARE.lat, FLARE.lon)).toBe(false);
  });

  it('records the archive year in the provenance', () => {
    expect(staticMaskInfo(new Date('2026-10-08T12:00:00Z'), DEFAULT_STATIC_OPTIONS, 2024)).toMatchObject({
      method: 'static-mask-v1', archive_version: 2024, marked_at: '2026-10-08T12:00:00.000Z',
    });
  });

  describe('loadArchiveStaticCells', () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regional-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('picks the newest year', () => {
      expect(pickNewestArchiveCellsFile(['firms-static-cells.2023.json', 'firms-archive.2025.json',
        'firms-static-cells.2024.json', 'firms-static-cells.json'])).toBe('firms-static-cells.2024.json');
      expect(pickNewestArchiveCellsFile([])).toBeNull();
      const a = path.join(tmp, 'a');
      const b = path.join(tmp, 'b');
      fs.mkdirSync(a);
      fs.mkdirSync(b);
      fs.writeFileSync(path.join(a, 'firms-static-cells.2023.json'), JSON.stringify(archiveFile([[1, 1]], { version: 2023 })));
      fs.writeFileSync(path.join(b, 'firms-static-cells.2024.json'), JSON.stringify(archiveFile([[2, 2], [3, 3]])));
      const loaded = loadArchiveStaticCells([path.join(tmp, 'missing'), a, b]);
      expect(loaded.version).toBe(2024);
      expect(loaded.keys.size).toBe(2);
    });

    it('missing or malformed file → no archive cells', () => {
      expect(loadArchiveStaticCells([path.join(tmp, 'missing')])).toBe(NO_ARCHIVE_CELLS);
      fs.writeFileSync(path.join(tmp, 'firms-static-cells.2024.json'), '{ not json');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(loadArchiveStaticCells([tmp])).toBe(NO_ARCHIVE_CELLS);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
