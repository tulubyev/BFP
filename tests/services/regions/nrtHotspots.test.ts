import { countNrtByRegion, loadNrtCells, NRT_CELLS_SQL, NRT_HISTORY_SINCE } from '../../../backend/services/regions/nrtHotspots';
import type { RegionShape } from '../../../backend/services/firmsHistory/regions';

const square = (x0: number, y0: number, size: number) =>
  [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]];
const shape = (iso: string, x0: number): RegionShape => ({
  iso, name: iso, polygons: [[square(x0, 50, 5)]], bbox: { minLat: 50, maxLat: 55, minLon: x0, maxLon: x0 + 5 },
});

describe('countNrtByRegion', () => {
  const regions = [shape('RU-IRK', 100), shape('RU-BU', 105)];

  it('sums detections per region and lists every region (0 = none detected)', () => {
    const { counts, lastDate } = countNrtByRegion([
      { lat: 52, lon: 101, count: 3, lastDate: '2026-09-25' },
      { lat: 53, lon: 102, count: 2, lastDate: '2026-09-27' },
      { lat: 52, lon: 106, count: 1, lastDate: '2026-09-26' },
      { lat: 60, lon: 60, count: 9, lastDate: '2026-09-28' },
    ], [...regions, shape('RU-ZAB', 110)]);
    expect(counts).toEqual({ 'RU-IRK': 5, 'RU-BU': 1, 'RU-ZAB': 0 });
    expect(lastDate).toBe('2026-09-27'); // the point outside every region does not count
  });

  it('has no last date without detections', () => {
    expect(countNrtByRegion([], regions)).toEqual({ counts: { 'RU-IRK': 0, 'RU-BU': 0 }, lastDate: null });
  });
});

describe('loadNrtCells', () => {
  it('queries the history since the given date for the NRT source and maps rows', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ lat: '52.1', lon: '104.3', n: '4', last_date: '2026-09-25' }] });
    const cells = await loadNrtCells({ query }, NRT_HISTORY_SINCE);
    expect(query).toHaveBeenCalledWith(NRT_CELLS_SQL, ['firms_viirs_nrt', '2026-09-25']);
    expect(cells).toEqual([{ lat: 52.1, lon: 104.3, count: 4, lastDate: '2026-09-25' }]);
  });
});
