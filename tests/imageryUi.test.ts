import {
  DURING_ACTIVITY_LABEL, IMAGERY_NOTE, IMAGERY_RENDER_LABELS, canRequestImagery, hasImages, imageUrl, sceneDateLabel, sideCaption,
} from '../frontend/src/utils/imagery';
import type { ImagerySide } from '../frontend/src/api/imagery';

const ok: ImagerySide = {
  status: 'ok', sceneId: 'S2A_T48UUE_20240714T043045_L2A', datetime: '2024-07-14T04:33:25Z', platform: 'Sentinel-2A',
  clearPct: 97, urls: { truecolor: '/imagery/s2/v1/a/truecolor/b.png', swir: '/imagery/s2/v1/a/swir/b.png' },
};

describe('imageUrl', () => {
  it('prefixes the CDN origin when set', () => {
    expect(imageUrl('/imagery/s2/v1/x.png', 'https://cdn.forestwatch.ru')).toBe('https://cdn.forestwatch.ru/imagery/s2/v1/x.png');
    expect(imageUrl('/imagery/s2/v1/x.png', 'https://cdn.forestwatch.ru/')).toBe('https://cdn.forestwatch.ru/imagery/s2/v1/x.png');
  });

  it('stays same-origin without a CDN', () => {
    expect(imageUrl('/imagery/s2/v1/x.png', '')).toBe('/imagery/s2/v1/x.png');
  });
});

describe('captions', () => {
  it('date in UTC, satellite and clear share', () => {
    expect(sideCaption(ok)).toEqual(['14 июля 2024 г.', 'Sentinel-2A', 'чистых пикселей над участком: 97%']);
  });

  it('marks a scene taken during activity', () => {
    expect(sideCaption({ ...ok, duringActivity: true })).toContain(DURING_ACTIVITY_LABEL);
    expect(DURING_ACTIVITY_LABEL).toBe('снимок во время активности');
  });

  it('nothing for a missing side', () => {
    expect(sideCaption({ status: 'none', reason: 'снимков после обнаружения ещё нет' })).toEqual([]);
  });

  it('sceneDateLabel tolerates garbage', () => {
    expect(sceneDateLabel('nope')).toBe('—');
    // 23:30 UTC stays on its UTC date whatever the viewer's zone
    expect(sceneDateLabel('2024-07-14T23:30:00Z')).toBe('14 июля 2024 г.');
  });
});

describe('block helpers', () => {
  it('hasImages', () => {
    expect(hasImages([ok, { status: 'none', reason: 'x' }])).toBe(true);
    expect(hasImages([{ status: 'none', reason: 'x' }, { status: 'none', reason: 'y' }])).toBe(false);
  });

  it('canRequestImagery needs a centre', () => {
    expect(canRequestImagery({ center_lat: '53.6', center_lng: 103.07 })).toBe(true);
    expect(canRequestImagery({ center_lat: null, center_lng: 103.07 })).toBe(false);
    expect(canRequestImagery({})).toBe(false);
    expect(canRequestImagery({ center_lat: 'x', center_lng: 1 })).toBe(false);
  });

  it('labels and note are in Russian', () => {
    expect(IMAGERY_RENDER_LABELS).toEqual({ truecolor: 'Естественные цвета', swir: 'SWIR (гари)' });
    expect(IMAGERY_NOTE).toContain('до 20 секунд');
  });
});
