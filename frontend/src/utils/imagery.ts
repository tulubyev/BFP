import type { ImageryRender, ImagerySide, IncidentIndices, SeverityClass } from '../api/imagery';

export const IMAGERY_RENDER_LABELS: Record<ImageryRender, string> = {
  truecolor: 'Естественные цвета',
  swir: 'SWIR (гари)',
  ndvi: 'NDVI',
};

export const IMAGERY_NOTE = 'Снимки готовятся по запросу, первый показ — до 20 секунд.';
export const DURING_ACTIVITY_LABEL = 'снимок во время активности';

/** Image URL on the CDN origin when one is configured (like GFW tiles); `path` starts with "/". */
export function imageUrl(path: string, cdnBase: string): string {
  return `${cdnBase.replace(/\/+$/, '')}${path}`;
}

/** Scene date as "14 июля 2024 г." in UTC (Sentinel-2 passes over Siberia around 04–05 UTC). */
export function sceneDateLabel(datetime: string): string {
  const d = new Date(datetime);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Caption lines under one image: date, satellite, clear share, "во время активности". */
export function sideCaption(side: ImagerySide): string[] {
  if (side.status !== 'ok') return [];
  const lines = [
    sceneDateLabel(side.datetime),
    side.platform,
    `чистых пикселей над участком: ${side.clearPct}%`,
  ];
  if (side.duringActivity) lines.push(DURING_ACTIVITY_LABEL);
  return lines;
}

/** Whether the block has anything to show an attribution for. */
export function hasImages(sides: ImagerySide[]): boolean {
  return sides.some(s => s.status === 'ok');
}

/** Only incidents with a place can get images (FIRMS incidents always have one). */
export function canRequestImagery(incident: { center_lat?: unknown; center_lng?: unknown }): boolean {
  return incident.center_lat != null && incident.center_lng != null
    && Number.isFinite(Number(incident.center_lat)) && Number.isFinite(Number(incident.center_lng));
}

/**
 * NDVI render scale and palette. The frontend cannot import backend modules: copied from
 * backend/services/imagery/indices.ts (NDVI_RENDER_MIN/MAX, NDVI_STOPS); tests/imageryUi.test.ts checks they match.
 */
export const NDVI_LEGEND = {
  min: -0.2,
  max: 0.9,
  stops: [
    [-0.2, [120, 72, 30]],
    [0.1, [191, 145, 70]],
    [0.35, [240, 220, 100]],
    [0.6, [120, 190, 80]],
    [0.9, [20, 110, 50]],
  ] as [number, [number, number, number]][],
};

export const NDVI_LEGEND_NOTE = 'Коричневый — голая земля или гарь, жёлтый — редкая растительность, зелёный — густая. Прозрачные пиксели — облака, тени, снег или нет данных.';

/** CSS gradient of the NDVI legend bar. */
export function ndviLegendGradient(): string {
  const span = NDVI_LEGEND.max - NDVI_LEGEND.min;
  const stops = NDVI_LEGEND.stops.map(([v, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${Math.round(((v - NDVI_LEGEND.min) / span) * 100)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** «0,62» (Russian decimal comma, 2 decimals, true minus); «—» for no value. */
export function formatIndex(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(2).replace('.', ',').replace(/^-/, '−').replace(/^−0,00$/, '0,00');
}

/** «+0,05» / «−0,31»: a change always carries its sign. */
export function formatDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = formatIndex(n);
  return n > 0 && s !== '0,00' ? `+${s}` : s;
}

/** Badge colours of the USGS dNBR classes (text label always shown next to the colour). */
export const SEVERITY_STYLES: Record<SeverityClass, string> = {
  unburned: 'bg-emerald-900/70 text-emerald-100',
  low: 'bg-yellow-800/80 text-yellow-50',
  'moderate-low': 'bg-orange-700/80 text-orange-50',
  'moderate-high': 'bg-red-700/80 text-red-50',
  high: 'bg-fuchsia-800/80 text-fuchsia-50',
};

export interface IndexRow {
  label: string;
  before: string;
  after: string;
  change: string;
  changeLabel: string;
}

/** Rows of the indices table: NDVI before/after with ΔNDVI, NBR before/after with dNBR. */
export function indexRows(ind: IncidentIndices): IndexRow[] {
  return [
    { label: 'NDVI', before: formatIndex(ind.before?.ndvi), after: formatIndex(ind.after?.ndvi), change: formatDelta(ind.dNdvi), changeLabel: 'ΔNDVI' },
    { label: 'NBR', before: formatIndex(ind.before?.nbr), after: formatIndex(ind.after?.nbr), change: formatDelta(ind.dNbr), changeLabel: 'dNBR' },
  ];
}
