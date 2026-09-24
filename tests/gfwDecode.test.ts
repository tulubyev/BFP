import { decodeDistPixels, decodeLossPixels } from '../backend/utils/gfwDecode';

const px = (...rgba: number[][]) => Buffer.from(rgba.flat());
const pixel = (buf: Buffer, i: number) => Array.from(buf.subarray(i * 4, i * 4 + 4));

describe('decodeLossPixels (Hansen/UMD encoded tiles: B = year - 2000, R = intensity)', () => {
  it('makes no-loss and out-of-range years transparent', () => {
    const out = decodeLossPixels(px([200, 0, 0, 255], [200, 0, 26, 255], [200, 0, 5, 0]), 8, 25);
    expect(pixel(out, 0)[3]).toBe(0);
    expect(pixel(out, 1)[3]).toBe(0);
    expect(pixel(out, 2)[3]).toBe(0);
  });

  it('colors older loss yellow and the latest year red', () => {
    const out = decodeLossPixels(px([255, 0, 1, 255], [255, 0, 25, 255]), 12, 25);
    const [r1, g1] = pixel(out, 0);
    const [r2, g2] = pixel(out, 1);
    expect(r1).toBeGreaterThan(200);
    expect(g1).toBeGreaterThan(g2); // yellow has more green than red
    expect(r2).toBeGreaterThan(200);
    expect(g2).toBeLessThan(80);
  });

  it('fades low-intensity pixels at low zoom but not at high zoom', () => {
    const lowZoom = decodeLossPixels(px([10, 0, 16, 255], [255, 0, 16, 255]), 5, 25);
    expect(pixel(lowZoom, 0)[3]).toBeLessThan(pixel(lowZoom, 1)[3]);
    const highZoom = decodeLossPixels(px([10, 0, 16, 255]), 13, 25);
    expect(pixel(highZoom, 0)[3]).toBeGreaterThan(200);
  });
});

describe('decodeDistPixels (DIST-ALERT: R*255+G = days since 2020-12-31, B = confidence*100 + intensity)', () => {
  it('makes empty pixels transparent', () => {
    const out = decodeDistPixels(px([0, 0, 0, 0], [0, 0, 101, 255]));
    expect(pixel(out, 0)[3]).toBe(0);
    expect(pixel(out, 1)[3]).toBe(0); // day 0 = no alert
  });

  it('draws high-confidence alerts more opaque than low-confidence ones', () => {
    const out = decodeDistPixels(px([6, 127, 101, 255], [6, 127, 201, 255]));
    expect(pixel(out, 0)[3]).toBeGreaterThan(0);
    expect(pixel(out, 1)[3]).toBeGreaterThan(pixel(out, 0)[3]);
  });
});
