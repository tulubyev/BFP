import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NdviSeries, SeriesYear } from '../frontend/src/api/imagery';
import { SeriesBody } from '../frontend/src/components/NdviSeries';
import {
  SERIES_LINE_PROPS, SERIES_POLL_LIMIT_MS, SERIES_POLL_MS, missingYearNotes, progressText, seriesChartData, shouldPoll, yearTooltipLines,
} from '../frontend/src/utils/ndviSeries';

const ok = (year: number, site: number | null, background = 0.75): SeriesYear => ({
  year, status: 'ok', sceneId: `S2A_T48UUE_${year}0715T043045_L2A`, datetime: `${year}-07-15T04:33:00Z`, platform: 'Sentinel-2A',
  clearPct: 99, site: { ndvi: site, validPct: site === null ? 30 : 100 }, background: { ndvi: background, validPct: 100 },
});
const none = (year: number): SeriesYear => ({ year, status: 'none', reason: 'нет безоблачных снимков за 1 июля – 31 августа' });

const years = [ok(2017, 0.8), ok(2018, 0.79), none(2019), ok(2020, 0.4), ok(2021, null), ok(2022, 0.55)];

const series = (overrides: Partial<NdviSeries> = {}): NdviSeries => ({
  incidentId: 82, status: 'ready', years, progress: { done: 6, total: 6 }, aoi: [1, 2, 3, 4], site: [1, 2, 3, 4],
  window: { start: '07-01', end: '08-31' },
  source: { name: 'n', url: 'u', license: 'l', attribution: 'Contains modified Copernicus Sentinel data 2017, 2018' },
  generatedAt: '2026-09-27T00:00:00.000Z', ...overrides,
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('seriesChartData', () => {
  it('one row per year; years without a scene or value are null (gaps)', () => {
    const rows = seriesChartData(years);
    expect(rows.map(r => [r.year, r.site, r.background])).toEqual([
      [2017, 0.8, 0.75], [2018, 0.79, 0.75], [2019, null, null], [2020, 0.4, 0.75], [2021, null, 0.75], [2022, 0.55, 0.75],
    ]);
  });

  it('fills years missing from a pending series with null too', () => {
    expect(seriesChartData([ok(2017, 0.8), ok(2020, 0.5)]).map(r => r.site)).toEqual([0.8, null, null, 0.5]);
    expect(seriesChartData([])).toEqual([]);
  });

  it('the chart lines never join across a gap', () => {
    expect(SERIES_LINE_PROPS.connectNulls).toBe(false);
  });
});

describe('texts', () => {
  it('progress with the right word form', () => {
    expect(progressText(3, 10)).toBe('рассчитывается… 3 из 10 лет');
    expect(progressText(0, 21)).toBe('рассчитывается… 0 из 21 года');
    expect(progressText(0, 11)).toBe('рассчитывается… 0 из 11 лет');
  });

  it('tooltip: scene date, satellite, both values with clear shares; partial years flagged', () => {
    expect(yearTooltipLines(ok(2020, 0.4), 2020)).toEqual([
      'Снимок 15 июля 2020 г., Sentinel-2A',
      'Участок: 0,40 (чистых пикселей 100%)',
      'Фон вокруг: 0,75 (чистых пикселей 100%)',
    ]);
    expect(yearTooltipLines({ ...ok(2026, 0.6), partial: true }, 2026).at(-1)).toContain('лето ещё не закончилось');
    expect(yearTooltipLines(none(2019), 2019)).toEqual(['2019: нет данных — нет безоблачных снимков за 1 июля – 31 августа']);
    expect(yearTooltipLines(null, 2023)).toEqual(['2023: ещё не рассчитан']);
  });

  it('missing years are listed with reasons', () => {
    expect(missingYearNotes(years)).toEqual(['2019 — нет безоблачных снимков за 1 июля – 31 августа']);
  });
});

describe('polling', () => {
  it('every 5 s while pending, up to 3 min', () => {
    expect(SERIES_POLL_MS).toBe(5_000);
    expect(SERIES_POLL_LIMIT_MS).toBe(180_000);
    expect(shouldPoll('pending', 0, 0)).toBe(true);
    expect(shouldPoll('pending', 0, 175_000)).toBe(true);
    expect(shouldPoll('pending', 0, 175_001)).toBe(false);
    expect(shouldPoll('ready', 0, 1000)).toBe(false);
  });
});

describe('SeriesBody', () => {
  it('pending: progress text and a skeleton', () => {
    const html = renderToStaticMarkup(createElement(SeriesBody, {
      state: { kind: 'data', data: series({ status: 'pending', years: [], progress: { done: 2, total: 10 } }), gaveUp: false },
    }));
    expect(text(html)).toContain('рассчитывается… 2 из 10 лет');
    expect(html).toContain('animate-pulse');
  });

  it('gave up after 3 minutes', () => {
    const html = text(renderToStaticMarkup(createElement(SeriesBody, {
      state: { kind: 'data', data: series({ status: 'pending', years: [], progress: { done: 2, total: 10 } }), gaveUp: true },
    })));
    expect(html).toContain('Ряд ещё не готов — откройте событие позже');
  });

  it('ready: legend, missing years, failed years, attribution', () => {
    const html = text(renderToStaticMarkup(createElement(SeriesBody, {
      state: { kind: 'data', data: series({ failedYears: [2023] }), gaveUp: false },
    })));
    expect(html).toContain('Участок');
    expect(html).toContain('Фон вокруг');
    expect(html).toContain('Без снимка: 2019 — нет безоблачных снимков');
    expect(html).toContain('Не удалось получить 2023');
    expect(html).toContain('Contains modified Copernicus Sentinel data');
    expect(html).not.toContain('рассчитывается');
  });

  it('no scene in any year: «нет данных», no chart', () => {
    const html = text(renderToStaticMarkup(createElement(SeriesBody, {
      state: { kind: 'data', data: series({ years: [none(2017), none(2018)] }), gaveUp: false },
    })));
    expect(html).toContain('Нет данных: ни за один год нет безоблачного летнего снимка');
    expect(html).not.toContain('Contains modified');
  });

  it('error and loading states', () => {
    expect(text(renderToStaticMarkup(createElement(SeriesBody, { state: { kind: 'error', message: 'Слишком много запросов, попробуйте позже' } }))))
      .toContain('Нет данных: Слишком много запросов, попробуйте позже');
    expect(renderToStaticMarkup(createElement(SeriesBody, { state: { kind: 'loading' } }))).toContain('animate-pulse');
  });
});
