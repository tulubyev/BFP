import type { SeriesYear } from '../api/imagery';
import { formatIndex, sceneDateLabel } from './imagery';

/** The UI polls a pending series this often, and gives up after this long. */
export const SERIES_POLL_MS = 5_000;
export const SERIES_POLL_LIMIT_MS = 180_000;

/** Chart colours (validated for colour-blind separation on the card surface); background also dashed. */
export const SERIES_COLORS = { site: '#c9731f', background: '#5b8fd9' } as const;
export const SERIES_LABELS = { site: 'Участок', background: 'Фон вокруг' } as const;

/** Both lines: years without a value stay gaps (never joined), no animation. */
export const SERIES_LINE_PROPS = { connectNulls: false, isAnimationActive: false } as const;

export const SERIES_TITLE = 'Динамика NDVI (июль–август)';
export const SERIES_NOTE = 'Средний NDVI лучшего безоблачного снимка Sentinel-2 за 1 июля – 31 августа каждого года. '
  + 'Участок — контур события, фон — кольцо вокруг него. Годы без безоблачного снимка пропущены, линия через них не проводится.';

export interface ChartPoint {
  year: number;
  site: number | null;
  background: number | null;
  point: SeriesYear | null;
}

/**
 * One row per year from the first to the last in the series; years without a scene (or without a
 * value) are null, so recharts leaves a gap instead of joining the neighbours.
 */
export function seriesChartData(years: SeriesYear[]): ChartPoint[] {
  if (years.length === 0) return [];
  const byYear = new Map(years.map(y => [y.year, y]));
  const first = Math.min(...years.map(y => y.year));
  const last = Math.max(...years.map(y => y.year));
  const out: ChartPoint[] = [];
  for (let year = first; year <= last; year++) {
    const p = byYear.get(year) ?? null;
    out.push({
      year,
      site: p?.status === 'ok' ? p.site.ndvi : null,
      background: p?.status === 'ok' ? p.background.ndvi : null,
      point: p,
    });
  }
  return out;
}

/** «лет» / «года» after «из N». */
function yearsWord(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'года' : 'лет';
}

export function progressText(done: number, total: number): string {
  return `рассчитывается… ${done} из ${total} ${yearsWord(total)}`;
}

/** Keep polling while the series is pending and the limit has not passed. */
export function shouldPoll(status: 'ready' | 'pending', startedAt: number, now: number): boolean {
  return status === 'pending' && now - startedAt + SERIES_POLL_MS <= SERIES_POLL_LIMIT_MS;
}

/** Tooltip lines of one year (text only). */
export function yearTooltipLines(p: SeriesYear | null, year: number): string[] {
  if (!p) return [`${year}: ещё не рассчитан`];
  if (p.status === 'none') return [`${year}: нет данных — ${p.reason}`];
  const lines = [
    `Снимок ${sceneDateLabel(p.datetime)}, ${p.platform}`,
    `${SERIES_LABELS.site}: ${formatIndex(p.site.ndvi)} (чистых пикселей ${p.site.validPct}%)`,
    `${SERIES_LABELS.background}: ${formatIndex(p.background.ndvi)} (чистых пикселей ${p.background.validPct}%)`,
  ];
  if (p.partial) lines.push('лето ещё не закончилось — значение может измениться');
  return lines;
}

/** Footnotes for years without a scene: «2019 — нет безоблачных снимков …». */
export function missingYearNotes(years: SeriesYear[]): string[] {
  return years.flatMap(y => (y.status === 'none' ? [`${y.year} — ${y.reason}`] : []));
}
