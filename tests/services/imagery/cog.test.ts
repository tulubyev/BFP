import { geotiffLevels, readToGrid } from '../../../backend/services/imagery/cog';
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff';
import type { Grid } from '../../../backend/services/imagery/geometry';
import { grid2d, memoryCog } from './helpers';

const ORIGIN: [number, number] = [500_000, 6_000_000];

describe('geotiff in-memory round trip (CommonJS build under jest)', () => {
  it('writes and reads a georeferenced single-band image', async () => {
    const cog = await memoryCog([grid2d(4, 6, (r, c) => r * 10 + c + 1)], ORIGIN, 20);
    expect(cog.samples).toBe(1);
    expect(cog.levels).toEqual([{ width: 6, height: 4, origin: ORIGIN, resolution: [20, -20] }]);
    const [band] = await cog.readWindow(0, [1, 1, 3, 3]);
    expect(Array.from(band)).toEqual([12, 13, 22, 23]);
  });

  it('reads three samples of an RGB image as separate bands', async () => {
    const cog = await memoryCog([grid2d(2, 2, () => 10), grid2d(2, 2, () => 20), grid2d(2, 2, () => 30)], ORIGIN, 10, 32648, 8);
    expect(cog.samples).toBe(3);
    const bands = await cog.readWindow(0, [0, 0, 2, 2]);
    expect(bands.map(b => Array.from(b))).toEqual([[10, 10, 10, 10], [20, 20, 20, 20], [30, 30, 30, 30]]);
  });

  it('geotiffLevels lists the base image with its origin and pixel size', async () => {
    const buffer = writeArrayBuffer(new Uint16Array(9).fill(1), {
      height: 3, width: 3, BitsPerSample: [16], SampleFormat: [1], PhotometricInterpretation: 1,
      ModelPixelScale: [20, 20, 0], ModelTiepoint: [0, 0, 0, 300000, 6000000, 0], ProjectedCSTypeGeoKey: 32648,
    });
    const { levels, indexes } = await geotiffLevels(await fromArrayBuffer(buffer));
    expect(indexes).toEqual([0]);
    expect(levels[0].origin).toEqual([300000, 6000000]);
  });
});

describe('readToGrid', () => {
  it('resamples a window onto the output grid (20 m source → 10 m grid, nearest)', async () => {
    const cog = await memoryCog([grid2d(4, 4, (r, c) => r * 4 + c + 1)], ORIGIN, 20);
    // Grid over the source pixels (1,1)–(2,2): x 500020–500060, y 5999940–5999980
    const grid: Grid = { extent: [500_020, 5_999_940, 500_060, 5_999_980], width: 4, height: 4, pixelSize: 10 };
    const [out] = await readToGrid(cog, grid, 'nearest');
    expect(Array.from(out)).toEqual([6, 6, 7, 7, 6, 6, 7, 7, 10, 10, 11, 11, 10, 10, 11, 11]);
  });

  it('fills the part of the grid outside the image with nodata (0)', async () => {
    const cog = await memoryCog([grid2d(2, 2, () => 5)], ORIGIN, 20);
    const grid: Grid = { extent: [500_020, 5_999_960, 500_060, 5_999_980], width: 2, height: 1, pixelSize: 20 };
    const [out] = await readToGrid(cog, grid, 'nearest');
    expect(Array.from(out)).toEqual([5, 0]);
  });

  it('returns all-nodata bands when the grid misses the image entirely', async () => {
    const cog = await memoryCog([grid2d(2, 2, () => 5), grid2d(2, 2, () => 6), grid2d(2, 2, () => 7)], ORIGIN, 20, 32648, 8);
    const grid: Grid = { extent: [0, 0, 20, 20], width: 1, height: 1, pixelSize: 20 };
    const out = await readToGrid(cog, grid, 'bilinear');
    expect(out.map(b => Array.from(b))).toEqual([[0], [0], [0]]);
  });

  it('picks an overview close to the grid pixel size', async () => {
    const reads: number[] = [];
    const fake = {
      samples: 1,
      levels: [
        { width: 1000, height: 1000, origin: ORIGIN, resolution: [10, -10] as [number, number] },
        { width: 500, height: 500, origin: ORIGIN, resolution: [20, -20] as [number, number] },
        { width: 250, height: 250, origin: ORIGIN, resolution: [40, -40] as [number, number] },
      ],
      async readWindow(level: number, w: [number, number, number, number]) {
        reads.push(level);
        return [new Uint16Array((w[2] - w[0]) * (w[3] - w[1])).fill(1)];
      },
    };
    const grid: Grid = { extent: [500_000, 5_990_000, 510_000, 6_000_000], width: 300, height: 300, pixelSize: 10_000 / 300 };
    await readToGrid(fake, grid, 'nearest');
    expect(reads).toEqual([1]);
  });
});
