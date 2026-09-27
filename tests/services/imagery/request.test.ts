import {
  MAX_REQUEST_KM, imagePath, incidentImageryKey, parseBboxParam, parseImageRequest, pngKey, sceneItemKey,
} from '../../../backend/services/imagery/request';

const ID = 'S2A_T48UUE_20240714T043045_L2A';
const BBOX = '103.05000,53.60000,103.09000,53.63000';

describe('imagePath', () => {
  it('builds the versioned image URL with a canonical bbox', () => {
    expect(imagePath(ID, 'swir', [103.05, 53.6, 103.09, 53.63])).toBe(`/imagery/s2/v1/${ID}/swir/${BBOX}.png`);
  });
});

describe('parseImageRequest', () => {
  it('accepts a valid request', () => {
    expect(parseImageRequest(ID, 'truecolor', BBOX)).toEqual({
      ok: true, value: { sceneId: ID, render: 'truecolor', bbox: [103.05, 53.6, 103.09, 53.63], bboxParam: BBOX },
    });
  });

  it.each([
    'S2A_T48UUE_20240714T043045_L1C',
    'S2D_T48UUE_20240714T043045_L2A',
    's2a_t48uue_20240714t043045_l2a',
    '../../etc/passwd',
    `${ID}x`,
    '',
  ])('rejects scene id %p', id => {
    expect(parseImageRequest(id, 'truecolor', BBOX)).toEqual({ ok: false, error: 'invalid scene id' });
  });

  it('accepts S2B and S2C scenes', () => {
    expect(parseImageRequest('S2C_T05VNK_20250101T220000_L2A', 'swir', BBOX).ok).toBe(true);
  });

  it.each(['ndvi', 'TRUECOLOR', '', 'visual'])('rejects render %p', render => {
    expect(parseImageRequest(ID, render, BBOX).ok).toBe(false);
  });

  it.each([
    '103.05,53.6,103.09,53.63', // not canonical
    '103.050000,53.600000,103.090000,53.630000',
    '103.05000,53.60000,103.09000', // 3 numbers
    '103.05000,53.60000,103.09000,53.63000,1.00000',
    'NaN,53.60000,103.09000,53.63000',
    'Infinity,53.60000,103.09000,53.63000',
    '1e2,53.60000,103.09000,53.63000',
    '103.09000,53.60000,103.05000,53.63000', // min > max
    '181.00000,53.60000,182.00000,53.63000',
    '103.05000,91.00000,103.09000,92.00000',
    ' 103.05000,53.60000,103.09000,53.63000',
  ])('rejects bbox %p', bbox => {
    expect(parseImageRequest(ID, 'swir', bbox).ok).toBe(false);
  });

  it(`rejects a bbox with a side over ${MAX_REQUEST_KM} km`, () => {
    const r = parseImageRequest(ID, 'swir', '103.00000,53.60000,103.50000,53.63000');
    expect(r).toEqual({ ok: false, error: `bbox side exceeds ${MAX_REQUEST_KM} km` });
  });

  it('accepts a point bbox (single-pixel incident)', () => {
    expect(parseImageRequest(ID, 'swir', '103.05000,53.60000,103.05000,53.60000').ok).toBe(true);
  });

  it('parseBboxParam handles negative coordinates', () => {
    expect(parseBboxParam('-170.10000,65.00000,-170.00000,65.10000')).toEqual([-170.1, 65, -170, 65.1]);
  });
});

describe('cache keys', () => {
  it('are versioned and specific', () => {
    expect(incidentImageryKey(42, '2025-07-22T18:30:00.000Z')).toBe('imagery:incident:v1:42:2025-07-22T18:30:00.000Z');
    expect(sceneItemKey(ID)).toBe(`imagery:s2:item:v1:${ID}`);
    const parsed = parseImageRequest(ID, 'swir', BBOX);
    if (!parsed.ok) throw new Error('expected ok');
    expect(pngKey(parsed.value)).toBe(`imagery:s2:png:v1:${ID}:swir:${BBOX}`);
  });
});
