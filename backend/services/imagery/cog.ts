/**
 * Reading Cloud-Optimized GeoTIFFs. The imagery code talks to the `OpenCog` interface; the real
 * implementation uses geotiff.js over HTTP range requests (only the tiles of the needed window
 * at the needed overview are fetched). Tests inject in-memory GeoTIFFs.
 *
 * geotiff 3.x ships a CommonJS build (package "exports" → require: dist-node), so a plain
 * `import { fromUrl } from 'geotiff'` works under tsc/ts-node (CommonJS) and jest alike.
 */
import { fromUrl, type GeoTIFF } from 'geotiff';
import {
  pickLevel, pixelWindow, resampleToGrid, type CogLevel, type Grid, type PixelWindow, type Resample,
} from './geometry';

export interface OpenedCog {
  levels: CogLevel[];
  /** Samples (bands) per pixel. */
  samples: number;
  /** One array per sample (band) of the window at `level`. */
  readWindow(level: number, window: PixelWindow, signal?: AbortSignal): Promise<ArrayLike<number>[]>;
}

export type OpenCog = (href: string, signal?: AbortSignal) => Promise<OpenedCog>;

/**
 * Levels of an opened GeoTIFF: the full image and its overviews (same origin, coarser pixels),
 * with the image index of each level in the file.
 */
export async function geotiffLevels(tiff: GeoTIFF): Promise<{ levels: CogLevel[]; indexes: number[] }> {
  const count = await tiff.getImageCount();
  const base = await tiff.getImage(0);
  const [ox, oy] = base.getOrigin();
  const [rx, ry] = base.getResolution();
  const levels: CogLevel[] = [];
  const indexes: number[] = [];
  for (let i = 0; i < count; i++) {
    const img = i === 0 ? base : await tiff.getImage(i);
    // A COG may also hold masks; keep only images that are downsampled copies of the base
    if (i > 0 && img.getWidth() >= base.getWidth()) continue;
    const kx = base.getWidth() / img.getWidth();
    const ky = base.getHeight() / img.getHeight();
    levels.push({ width: img.getWidth(), height: img.getHeight(), origin: [ox, oy], resolution: [rx * kx, ry * ky] });
    indexes.push(i);
  }
  return { levels, indexes };
}

export async function wrapGeotiff(tiff: GeoTIFF): Promise<OpenedCog> {
  const { levels, indexes } = await geotiffLevels(tiff);
  const base = await tiff.getImage(0);
  return {
    levels,
    samples: base.getSamplesPerPixel(),
    async readWindow(level, window, signal) {
      const img = await tiff.getImage(indexes[level]);
      const rasters = await img.readRasters({ window, interleave: false, signal });
      return Array.from(rasters as unknown as ArrayLike<number>[]);
    },
  };
}

export const openRemoteCog: OpenCog = async (href, signal) => wrapGeotiff(await fromUrl(href, {}, signal));

/**
 * Reads every band of a COG onto the output grid: picks the overview closest to the
 * grid pixel size, reads the covering window and resamples. Outside the image → 0 (nodata).
 */
export async function readToGrid(
  cog: OpenedCog, grid: Grid, method: Resample, signal?: AbortSignal,
): Promise<Float32Array[]> {
  const level = pickLevel(cog.levels, grid.pixelSize);
  const window = pixelWindow(grid.extent, cog.levels[level]);
  if (!window) return Array.from({ length: cog.samples }, () => new Float32Array(grid.width * grid.height));
  const bands = await cog.readWindow(level, window, signal);
  return bands.map(b => resampleToGrid(b, cog.levels[level], window, grid, method));
}
