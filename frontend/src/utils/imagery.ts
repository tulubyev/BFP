import type { ImageryRender, ImagerySide } from '../api/imagery';

export const IMAGERY_RENDER_LABELS: Record<ImageryRender, string> = {
  truecolor: 'Естественные цвета',
  swir: 'SWIR (гари)',
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
