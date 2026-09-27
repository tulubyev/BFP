import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DURING_ACTIVITY_LABEL, IMAGERY_NOTE, IMAGERY_RENDER_LABELS, NDVI_LEGEND, SEVERITY_STYLES, canRequestImagery, formatDelta,
  formatIndex, hasImages, imageUrl, indexRows, ndviLegendGradient, sceneDateLabel, sideCaption,
} from '../frontend/src/utils/imagery';
import type { ImagerySide, IncidentIndices } from '../frontend/src/api/imagery';
import { IndicesPanel, NdviLegend } from '../frontend/src/components/IncidentIndices';
import { NDVI_RENDER_MAX, NDVI_RENDER_MIN, NDVI_STOPS, SEVERITY_LABELS } from '../backend/services/imagery/indices';
import { RENDERS } from '../backend/services/imagery/render';

const ok: ImagerySide = {
  status: 'ok', sceneId: 'S2A_T48UUE_20240714T043045_L2A', datetime: '2024-07-14T04:33:25Z', platform: 'Sentinel-2A',
  clearPct: 97,
  urls: { truecolor: '/imagery/s2/v1/a/truecolor/b.png', swir: '/imagery/s2/v1/a/swir/b.png', ndvi: '/imagery/s2/v1/a/ndvi/b.png' },
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
    expect(IMAGERY_RENDER_LABELS).toEqual({ truecolor: 'Естественные цвета', swir: 'SWIR (гари)', ndvi: 'NDVI' });
    expect(Object.keys(IMAGERY_RENDER_LABELS)).toEqual([...RENDERS]);
    expect(IMAGERY_NOTE).toContain('до 20 секунд');
  });
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const indices: IncidentIndices = {
  before: { ndvi: 0.812, nbr: 0.526, validPct: 100 },
  after: { ndvi: 0.238, nbr: -0.278, validPct: 96 },
  dNdvi: -0.574,
  dNbr: 0.804,
  severity: { class: 'high', label: 'высокая степень выгорания' },
  reasons: [],
  site: [103.04, 53.59, 103.1, 53.64],
  note: 'оценка по двум снимкам Sentinel-2, не полевое обследование',
};

describe('NDVI legend', () => {
  it('matches the backend render scale and palette', () => {
    expect(NDVI_LEGEND.min).toBe(NDVI_RENDER_MIN);
    expect(NDVI_LEGEND.max).toBe(NDVI_RENDER_MAX);
    expect(NDVI_LEGEND.stops).toEqual(NDVI_STOPS);
  });

  it('gradient runs brown → green over 0–100 %', () => {
    const g = ndviLegendGradient();
    expect(g.startsWith('linear-gradient(to right, rgb(120, 72, 30) 0%')).toBe(true);
    expect(g.endsWith('rgb(20, 110, 50) 100%)')).toBe(true);
    expect(text(renderToStaticMarkup(createElement(NdviLegend)))).toContain('−0,20 0,90');
  });
});

describe('index formatting', () => {
  it('Russian decimal comma, true minus, sign on changes', () => {
    expect(formatIndex(0.812)).toBe('0,81');
    expect(formatIndex(-0.278)).toBe('−0,28');
    expect(formatIndex(-0.001)).toBe('0,00');
    expect(formatIndex(null)).toBe('—');
    expect(formatDelta(0.05)).toBe('+0,05');
    expect(formatDelta(-0.574)).toBe('−0,57');
    expect(formatDelta(0.001)).toBe('0,00');
    expect(formatDelta(undefined)).toBe('—');
  });

  it('rows: NDVI with ΔNDVI, NBR with dNBR', () => {
    expect(indexRows(indices)).toEqual([
      { label: 'NDVI', before: '0,81', after: '0,24', change: '−0,57', changeLabel: 'ΔNDVI' },
      { label: 'NBR', before: '0,53', after: '−0,28', change: '+0,80', changeLabel: 'dNBR' },
    ]);
    expect(indexRows({ ...indices, before: null, dNdvi: null, dNbr: null })[0]).toMatchObject({ before: '—', change: '—' });
  });

  it('every severity class has a badge style', () => {
    expect(Object.keys(SEVERITY_STYLES).sort()).toEqual(Object.keys(SEVERITY_LABELS).sort());
  });
});

describe('IndicesPanel', () => {
  it('shows the values, the severity label and the caveat', () => {
    const html = text(renderToStaticMarkup(createElement(IndicesPanel, { indices })));
    expect(html).toContain('NDVI 0,81 0,24');
    expect(html).toContain('dNBR 0,80:');
    expect(html).toContain('высокая степень выгорания');
    expect(html).toContain('«до» — 100%, «после» — 96%');
    expect(html).toContain('не полевое обследование');
    expect(html).toContain('Key & Benson');
  });

  it('reasons instead of values, no badge without dNBR', () => {
    const html = text(renderToStaticMarkup(createElement(IndicesPanel, {
      indices: { ...indices, dNbr: null, severity: null, reasons: ['снимок «после» сделан во время активности'] },
    })));
    expect(html).toContain('Нет данных: снимок «после» сделан во время активности');
    expect(html).not.toContain('степень выгорания');
  });

  it('API text is rendered as text, never as markup', () => {
    const html = renderToStaticMarkup(createElement(IndicesPanel, { indices: { ...indices, reasons: ['<img src=x onerror=alert(1)>'] } }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
