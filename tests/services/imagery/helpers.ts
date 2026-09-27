import { fromArrayBuffer, writeArrayBuffer } from 'geotiff';
import { wrapGeotiff, type OpenedCog } from '../../../backend/services/imagery/cog';
import type { S2Scene } from '../../../backend/services/imagery/stac';

/**
 * In-memory north-up GeoTIFF in a UTM zone: `bands[b][row][col]`, upper-left corner `origin`,
 * square pixels of `pixel` metres.
 */
export async function memoryCog(
  bands: number[][][], origin: [number, number], pixel: number, epsg = 32648, bits: 8 | 16 = 16,
): Promise<OpenedCog> {
  const height = bands[0].length;
  const width = bands[0][0].length;
  // The writer takes a flat, pixel-interleaved typed array (plain arrays are written as bytes)
  const data = bits === 8 ? new Uint8Array(width * height * bands.length) : new Uint16Array(width * height * bands.length);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      bands.forEach((band, b) => { data[(row * width + col) * bands.length + b] = band[row][col]; });
    }
  }
  const buffer = writeArrayBuffer(data, {
    height, width,
    BitsPerSample: bands.map(() => bits),
    SampleFormat: bands.map(() => 1),
    PhotometricInterpretation: bands.length === 3 ? 2 : 1,
    ModelPixelScale: [pixel, pixel, 0],
    ModelTiepoint: [0, 0, 0, origin[0], origin[1], 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: epsg,
  });
  return wrapGeotiff(await fromArrayBuffer(buffer));
}

export const grid2d = (height: number, width: number, value: (row: number, col: number) => number) =>
  Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => value(row, col)));

export function scene(overrides: Partial<S2Scene> = {}): S2Scene {
  return {
    id: 'S2A_T48UUE_20240714T043045_L2A',
    bbox: [101.94, 53.12, 103.52, 54.14],
    datetime: '2024-07-14T04:33:25Z',
    platform: 'sentinel-2a',
    cloudCover: 6,
    epsg: 32648,
    assets: {
      visual: { href: 'https://example.test/TCI.tif' },
      red: { href: 'https://example.test/B04.tif', 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] },
      nir08: { href: 'https://example.test/B8A.tif', 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] },
      swir22: { href: 'https://example.test/B12.tif', 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] },
      scl: { href: 'https://example.test/SCL.tif' },
    },
    ...overrides,
  };
}
