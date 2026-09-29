/**
 * Pure helpers for the print-ready region report (/regions/:iso/report, spec 2026-09-29 part R).
 * Everything comes from GET /api/regions/:iso; a null value is printed as «нет данных: <причина>»,
 * never as 0 (future.md §3).
 */
import type { HotspotYear, Indicator, IndicatorKind, RegionDetailResponse } from '../api/regions';
import { KIND_LABELS, NO_DATA, formatIndicatorValue, groupByKind } from './regions';

/** Same format the backend accepts (backend/services/regions/registry.ts ISO_RE). */
export const REPORT_ISO_RE = /^RU-[A-Z]{2,3}$/;

export const REGIONS_TABLE_PATH = '/analytics#regions';

export type ReportIsoCheck = { ok: true; iso: string } | { ok: false; error: string };

/** Validates the :iso route parameter before any request: trimmed, upper-cased, ISO 3166-2 of Russia. */
export function parseReportIso(raw: string | undefined | null): ReportIsoCheck {
  const iso = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!REPORT_ISO_RE.test(iso)) {
    return { ok: false, error: 'Неверный код субъекта: ожидается ISO 3166-2, например RU-IRK' };
  }
  return { ok: true, iso };
}

export function regionReportPath(iso: string): string {
  return `/regions/${encodeURIComponent(iso)}/report`;
}

/** Browser tab title; also the default file name when the page is saved as PDF. */
export function reportDocumentTitle(name: string): string {
  return `Отчёт по региону: ${name} — forestwatch.ru`;
}

/** «29.09.2026, 14:05»; «дата неизвестна» for a missing or unparsable value. */
export function formatReportDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (value == null || value === '') return 'дата неизвестна';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'дата неизвестна';
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone,
  });
}

// ─── Indicators table ────────────────────────────────────────────────────────

export const REPORT_GROUP_TITLES: Record<IndicatorKind, string> = {
  official: 'Официальные данные',
  satellite: 'Спутниковые наблюдения',
  estimate: 'Оценки',
};

export const KIND_ORDER: IndicatorKind[] = ['official', 'satellite', 'estimate'];

export interface ReportRow {
  id: string;
  label: string;
  kind: IndicatorKind;
  kindLabel: string;
  /** Value with unit, or «нет данных: <причина>». */
  value: string;
  missing: boolean;
  period: string;
  definition: string;
  source: string;
}

export interface ReportGroup {
  kind: IndicatorKind;
  title: string;
  rows: ReportRow[];
}

export function reportRow(indicator: Indicator): ReportRow {
  const missing = indicator.value == null;
  return {
    id: indicator.id,
    label: indicator.label,
    kind: indicator.kind,
    kindLabel: KIND_LABELS[indicator.kind],
    // A null value without a backend reason still says why it is empty, not a bare dash
    value: missing && !indicator.reason ? `${NO_DATA}: причина не указана` : formatIndicatorValue(indicator),
    missing,
    period: indicator.period ?? 'период не указан',
    definition: indicator.definition,
    source: indicator.source,
  };
}

/** Table and card indicators grouped official → satellite → estimate; empty groups are dropped. */
export function reportGroups(detail: Pick<RegionDetailResponse, 'indicators' | 'extraIndicators'>): ReportGroup[] {
  const groups = groupByKind([...detail.indicators, ...(detail.extraIndicators ?? [])]);
  return KIND_ORDER
    .filter(kind => groups[kind].length > 0)
    .map(kind => ({ kind, title: REPORT_GROUP_TITLES[kind], rows: groups[kind].map(reportRow) }));
}

// ─── Hotspot series ──────────────────────────────────────────────────────────

export interface HotspotTableRow {
  year: number;
  vegetation: string;
  static: string;
  per10k: string;
}

const num = (v: number, digits = 0) => v.toLocaleString('ru-RU', { maximumFractionDigits: digits });

export function hotspotTableRows(series: HotspotYear[]): HotspotTableRow[] {
  return [...series].sort((a, b) => a.year - b.year).map(y => ({
    year: y.year,
    vegetation: num(y.vegetation),
    static: num(y.static),
    per10k: y.vegetationPer10k == null ? NO_DATA : num(y.vegetationPer10k, 2),
  }));
}

/** First–last year of the series, e.g. «2019–2024»; one year stays one year. */
export function seriesYearsLabel(years: number[]): string | null {
  if (!years.length) return null;
  const first = Math.min(...years);
  const last = Math.max(...years);
  return first === last ? String(first) : `${first}–${last}`;
}

/** Smallest «round» number (1, 2, 2.5, 5 × 10^k) ≥ max, so the axis ends on a readable tick. */
export function niceCeil(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}

export interface ChartBar {
  year: number;
  series: 'vegetation' | 'static';
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Printed above the bar: the chart must be readable without colour. */
  label: string;
}

export interface ChartGeometry {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  max: number;
  ticks: { value: number; y: number; label: string }[];
  bars: ChartBar[];
  years: { year: number; x: number }[];
}

export const CHART_SIZE = { width: 640, height: 260 } as const;
const MARGIN = { left: 52, right: 12, top: 22, bottom: 30 };
const TICK_COUNT = 4;

/**
 * Geometry of the per-year bar chart (vegetation vs. static sources) in a fixed viewBox: the SVG
 * scales with the page, so print does not depend on a resize observer, and it renders on the server.
 */
export function hotspotChartGeometry(series: HotspotYear[], size: { width: number; height: number } = CHART_SIZE): ChartGeometry {
  const plot = { left: MARGIN.left, top: MARGIN.top, right: size.width - MARGIN.right, bottom: size.height - MARGIN.bottom };
  const sorted = [...series].sort((a, b) => a.year - b.year);
  const max = niceCeil(Math.max(0, ...sorted.flatMap(y => [y.vegetation, y.static])));
  const scaleY = (v: number) => plot.bottom - (Math.max(0, v) / max) * (plot.bottom - plot.top);

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
    const value = (max / TICK_COUNT) * i;
    return { value, y: scaleY(value), label: num(value, 1) };
  });

  const slot = sorted.length ? (plot.right - plot.left) / sorted.length : 0;
  const barWidth = slot * 0.34;
  const gap = slot * 0.04;
  const bars: ChartBar[] = [];
  const years = sorted.map((y, i) => {
    const center = plot.left + slot * (i + 0.5);
    (['vegetation', 'static'] as const).forEach((key, k) => {
      const value = y[key];
      const top = scaleY(value);
      bars.push({
        year: y.year, series: key, value,
        x: k === 0 ? center - gap / 2 - barWidth : center + gap / 2,
        y: top, width: barWidth, height: plot.bottom - top, label: num(value),
      });
    });
    return { year: y.year, x: center };
  });

  return { width: size.width, height: size.height, plot, max, ticks, bars, years };
}

/** Chart summary for screen readers (the figure also has a data table right under it). */
export function hotspotChartSummary(series: HotspotYear[]): string {
  if (!series.length) return 'Термоточки по годам: нет данных';
  const parts = [...series].sort((a, b) => a.year - b.year)
    .map(y => `${y.year}: растительность ${num(y.vegetation)}, статичные источники ${num(y.static)}`);
  return `Термоточки по годам. ${parts.join('; ')}`;
}

// ─── Sources, licenses, limitations ──────────────────────────────────────────

export interface SourceAttribution {
  id: 'rosleshoz' | 'firms' | 'gfw' | 'osm';
  name: string;
  license: string;
  url: string;
  attribution: string;
  usedFor: string;
}

/** Licenses mirror backend/services/sourceRegistry.ts (tests/regionReport.test.ts checks it). */
export const REPORT_SOURCES: Record<SourceAttribution['id'], SourceAttribution> = {
  rosleshoz: {
    id: 'rosleshoz',
    name: 'Рослесхоз — открытые данные',
    license: 'Открытые данные РФ (CC0)',
    url: 'https://rosleshoz.gov.ru/opendata/',
    attribution: 'Федеральное агентство лесного хозяйства (Рослесхоз)',
    usedFor: 'лесные земли, лесной фонд, лесистость, заготовка древесины',
  },
  firms: {
    id: 'firms',
    name: 'NASA FIRMS (VIIRS)',
    license: 'Открытые данные NASA (без ограничений)',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
    attribution: "We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS)",
    usedFor: 'термоточки: годовой архив и текущий сезон',
  },
  gfw: {
    id: 'gfw',
    name: 'Global Forest Watch — Hansen/UMD/Google/USGS/NASA',
    license: 'CC BY 4.0',
    url: 'https://www.globalforestwatch.org/',
    attribution: 'Hansen/UMD/Google/USGS/NASA, via Global Forest Watch',
    usedFor: 'потеря древесного покрова',
  },
  osm: {
    id: 'osm',
    name: 'OpenStreetMap',
    license: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    attribution: '© участники OpenStreetMap',
    usedFor: 'границы и площадь субъекта, полигоны ООПТ',
  },
};

const SOURCE_PATTERNS: [SourceAttribution['id'], RegExp][] = [
  ['rosleshoz', /Рослесхоз/i],
  ['firms', /FIRMS/i],
  ['gfw', /Global Forest Watch|Hansen|\bGFW\b/i],
  ['osm', /OpenStreetMap|\bOSM\b/i],
];

/**
 * Sources actually cited by this region's indicators (plus OSM, whose boundaries give the region's
 * area). The FIRMS license comes from the archive metadata when the archive states one.
 */
export function reportSources(detail: Pick<RegionDetailResponse, 'indicators' | 'extraIndicators' | 'archive'>): SourceAttribution[] {
  const texts = [...detail.indicators, ...(detail.extraIndicators ?? [])].map(i => i.source);
  if (detail.archive) texts.push(detail.archive.source.name);
  const used = new Set<SourceAttribution['id']>(['osm']);
  for (const [id, re] of SOURCE_PATTERNS) if (texts.some(t => re.test(t))) used.add(id);
  return SOURCE_PATTERNS.map(([id]) => id).filter(id => used.has(id)).map(id => {
    const src = { ...REPORT_SOURCES[id] };
    if (id === 'firms' && detail.archive?.source.license) src.license = detail.archive.source.license;
    return src;
  });
}

const findAny = (detail: Pick<RegionDetailResponse, 'indicators' | 'extraIndicators'>, id: string) =>
  [...detail.indicators, ...(detail.extraIndicators ?? [])].find(i => i.id === id) ?? null;

/** «Ограничения и методология»: fixed caveats plus the ones that depend on this region's data. */
export function reportLimitations(detail: Pick<RegionDetailResponse, 'indicators' | 'extraIndicators' | 'archive'>): string[] {
  const items = [
    'Потеря древесного покрова ≠ незаконная рубка: в неё входят пожары, ветровалы, болезни, санитарные и законные рубки.',
    'Лесовосстановление по субъектам Рослесхоз не публикует — только итог по России, поэтому сопоставление восстановления и выбытия лесов не проводится.',
  ];
  const loss = findAny(detail, 'cover_loss');
  if (!loss || loss.kind === 'estimate') {
    items.push('Потеря покрова — оценка без ключа GFW API: доля субъекта от потерь по России, известна только для части лесных субъектов; значения приблизительные (≈).');
  } else {
    items.push('Потеря покрова — данные Global Forest Watch (Hansen) по границам субъекта; спутниковая оценка, а не учёт на земле.');
  }
  items.push('Термоточка — тепловая аномалия на снимке VIIRS, а не подтверждённый пожар. Статичные источники (газовые факелы, промышленность) показаны отдельно от растительности.');
  if (!detail.archive) items.push('Годовой архив FIRMS ещё не собран — показатели по термоточкам за год пока «нет данных».');
  if (findAny(detail, 'hotspots_nrt_season')) {
    items.push('Термоточки текущего сезона (NRT) — история сайта с 25.09.2026, с годовым архивом не сравнимы.');
  }
  items.push('Площадь субъекта — по границам OpenStreetMap; Крым, Севастополь и регионы 2022 г. в сводку не входят.');
  items.push('«Нет данных» означает отсутствие данных, а не ноль.');
  return items;
}

/** Report footer: when the data were collected, archive and boundaries versions, when it was printed. */
export function reportFooterText(
  detail: Pick<RegionDetailResponse, 'generatedAt' | 'archive' | 'boundariesFile'>, printedAt: Date, timeZone?: string,
): string {
  const parts = [`Данные собраны ${formatReportDateTime(detail.generatedAt, timeZone)}`];
  if (detail.archive) {
    const years = seriesYearsLabel(detail.archive.years);
    parts.push(`архив FIRMS${years ? ` ${years}` : ''} (${detail.archive.file}, собран ${formatReportDateTime(detail.archive.generatedAt, timeZone)})`);
  } else {
    parts.push('архив FIRMS не собран');
  }
  parts.push(`границы — ${detail.boundariesFile}`);
  return `${parts.join('; ')}. Отчёт сформирован ${formatReportDateTime(printedAt, timeZone)}.`;
}
