import sharp from 'sharp';
import {
  MIN_OUTLINE_PX, OUTLINE_COLOR, RENDERS, RENDER_VERSION, SWIR_GAMMA, composeRgba, encodePng, ndviRgba, outlineSvg, reflectanceScale,
  stretchSwir, swirRgba, truecolorRgba,
} from '../../../backend/services/imagery/render';
import { NDVI_STOPS } from '../../../backend/services/imagery/indices';

const C1 = { scale: 0.0001, offset: -0.1 };

describe('reflectanceScale', () => {
  it('reads scale and offset from raster:bands (Collection 1)', () => {
    expect(reflectanceScale([{ nodata: 0, scale: 0.0001, offset: -0.1 }])).toEqual(C1);
  });

  it('falls back to DN × 0.0001 without raster:bands', () => {
    expect(reflectanceScale(undefined)).toEqual({ scale: 0.0001, offset: 0 });
    expect(reflectanceScale([{}])).toEqual({ scale: 0.0001, offset: 0 });
    expect(reflectanceScale([{ scale: 0, offset: Number.NaN }])).toEqual({ scale: 0.0001, offset: 0 });
  });
});

describe('stretchSwir', () => {
  it('maps reflectance 0 → 0 and ≥ 0.4 → 255, applying the offset', () => {
    expect(stretchSwir(1000, C1)).toBe(0); // 1000 × 0.0001 − 0.1 = 0
    expect(stretchSwir(500, C1)).toBe(0); // negative reflectance clamps
    expect(stretchSwir(5000, C1)).toBe(255); // 0.4
    expect(stretchSwir(9000, C1)).toBe(255);
  });

  it('brightens mid-tones with the gamma', () => {
    // reflectance 0.2 = half of the range
    expect(stretchSwir(3000, C1)).toBe(Math.round(255 * 0.5 ** (1 / SWIR_GAMMA)));
    expect(stretchSwir(3000, C1)).toBeGreaterThan(128);
  });

  it('uses whatever scale the asset declares', () => {
    expect(stretchSwir(2000, { scale: 0.0001, offset: 0 })).toBe(Math.round(255 * 0.5 ** (1 / SWIR_GAMMA)));
  });
});

describe('RGBA composition', () => {
  it('truecolor passes bytes through; only 0 in all bands (TCI nodata) is transparent', () => {
    const rgba = truecolorRgba([10, 0, 0], [20, 5, 0], [30, 6, 0]);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 0, 5, 6, 255, 0, 0, 0, 0]);
  });

  it('swir: nodata (0) in any band is transparent', () => {
    const rgba = swirRgba([3000, 0], [3000, 3000], [3000, 3000], [C1, C1, C1]);
    expect(rgba[3]).toBe(255);
    expect(Array.from(rgba.subarray(4))).toEqual([0, 0, 0, 0]);
  });

  it('rounds and clamps interpolated values', () => {
    expect(Array.from(truecolorRgba([10.6], [300], [1.2]))).toEqual([11, 255, 1, 255]);
  });

  it('swir: burn scar (high B12, low B8A) is red-dominant, vegetation green-dominant', () => {
    const burn = swirRgba([3500], [2000], [1500], [C1, C1, C1]);
    const forest = swirRgba([1800], [4000], [1200], [C1, C1, C1]);
    expect(burn[0]).toBeGreaterThan(burn[1]);
    expect(forest[1]).toBeGreaterThan(forest[0]);
    expect(burn[3]).toBe(255);
  });

  it('composeRgba applies a mapping per band', () => {
    expect(Array.from(composeRgba([[1], [2], [3]], [v => v * 10, v => v * 20, v => v * 30]))).toEqual([10, 40, 90, 255]);
  });
});

describe('outlineSvg', () => {
  it('draws the quadrilateral in the outline colour', () => {
    const svg = outlineSvg(100, 80, [[10, 10], [90, 12], [88, 70], [8, 68]]);
    expect(svg).toContain('width="100" height="80"');
    expect(svg).toContain('points="10.0,10.0 90.0,12.0 88.0,70.0 8.0,68.0"');
    expect(svg).toContain(`stroke="${OUTLINE_COLOR}"`);
    expect(svg).toContain('fill="none"');
  });

  it('grows a point incident to a visible square', () => {
    const svg = outlineSvg(100, 100, [[50, 50], [50, 50], [50, 50], [50, 50]]);
    const h = MIN_OUTLINE_PX / 2;
    expect(svg).toContain(`points="${50 - h}.0,${50 - h}.0 ${50 + h}.0,${50 - h}.0`);
  });
});

describe('encodePng', () => {
  it('encodes RGBA with the outline composited', async () => {
    const w = 20; const h = 10;
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([0, 100, 0, 255], i * 4);
    const png = await encodePng(rgba, w, h, outlineSvg(w, h, [[2, 2], [17, 2], [17, 7], [2, 7]]));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: w, height: h, channels: 4 });
    const px = (x: number, y: number) => Array.from(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
    expect(px(0, 0)).toEqual([0, 100, 0, 255]); // background untouched
    expect(px(10, 2)[0]).toBeGreaterThan(150); // yellow line: strong red channel
  });
});

describe('ndvi render', () => {
  it('is a third render; the render version of existing images is unchanged', () => {
    expect(RENDERS).toEqual(['truecolor', 'swir', 'ndvi']);
    expect(RENDER_VERSION).toBe('v1');
  });

  it('colours clear pixels on the palette, clouds/snow/nodata transparent', () => {
    // forest (NDVI ≈ 0.82), bare (NDVI ≈ −0.2 or lower), cloud, snow, band nodata, dark-area class 2
    const red = [1400, 3000, 1400, 1400, 0, 1400];
    const nir = [4100, 2000, 4100, 4100, 4100, 4100];
    const scl = [4, 5, 9, 11, 4, 2];
    const rgba = ndviRgba(red, nir, scl, [C1, C1]);
    const px = (i: number) => Array.from(rgba.subarray(i * 4, i * 4 + 4));
    expect(px(0)[1]).toBeGreaterThan(px(0)[0]); // green
    expect(px(0)[3]).toBe(255);
    expect(px(1)).toEqual([...NDVI_STOPS[0][1], 255]); // clamped to the brown end
    expect(px(2)).toEqual([0, 0, 0, 0]);
    expect(px(3)).toEqual([0, 0, 0, 0]);
    expect(px(4)).toEqual([0, 0, 0, 0]);
    expect(px(5)[3]).toBe(255); // class 2 counts as clear, like the scene check
  });
});
