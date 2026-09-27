import sharp from 'sharp';
import {
  MIN_OUTLINE_PX, OUTLINE_COLOR, SWIR_GAMMA, composeRgba, encodePng, outlineSvg, reflectanceScale, stretchSwir, swirRgba,
  truecolorRgba,
} from '../../../backend/services/imagery/render';

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
  it('truecolor passes bytes through; nodata in any band is transparent', () => {
    const rgba = truecolorRgba([10, 0], [20, 5], [30, 6]);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 0, 0, 0, 0]);
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
