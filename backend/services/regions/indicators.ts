/**
 * Assembly of regional indicators (future.md §9, spec 2026-09-26 part B). Pure: all inputs are
 * already loaded; a missing input gives `value: null` with a reason, never a zero.
 * Official (Rosleshoz), satellite (FIRMS) and estimated values are kept as separate indicators,
 * each with its own definition, unit, period and source.
 */
import { ARCHIVE_MISSING_REASON, completeYears, type ArchiveYearCounts, type FirmsArchive } from './firmsArchive';
import { deviationFromMean, lossPer100kHa, perArea, round, sharePercent } from './math';
import type { RegionalExtraction } from './rosleshozRegional';

export type IndicatorKind = 'official' | 'satellite' | 'estimate';

export interface Indicator {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  /** Period the value describes; null only when there is no value and no known period. */
  period: string | null;
  source: string;
  kind: IndicatorKind;
  definition: string;
  /** Why `value` is null. */
  reason?: string;
  /** Rough estimate — shown as «≈». */
  approximate?: boolean;
}

export interface RegionIdentity {
  iso: string;
  name: string;
  areaKm2: number;
}

export interface HotspotYear extends ArchiveYearCounts {
  year: number;
  /** Vegetation hotspots per 10 000 km². */
  vegetationPer10k: number | null;
}

export interface RegionSummary extends RegionIdentity {
  baikal: boolean;
  indicators: Indicator[];
}

export interface RegionDetail extends RegionSummary {
  /** Annual archive series (complete years only); empty while the archive is not built. */
  hotspotSeries: HotspotYear[];
  hotspotSeriesReason: string | null;
  /** Indicators shown only in the region card (no regional data exists for some). */
  extraIndicators: Indicator[];
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** A Rosleshoz dataset split by region, with the publication date of the file used. */
export interface RosleshozInput {
  extraction: RegionalExtraction | null;
  /** Date encoded in the dataset file name (publication), null when unknown. */
  published: Date | null;
  /** Load error, when the dataset could not be read at all. */
  error?: string;
}

export interface OoptInput {
  /** km² of OOPT per ISO (see ooptShare.ts); null when OOPT could not be loaded. */
  areaKm2: Record<string, number> | null;
  fetchedAt: string | null;
  error?: string;
}

export interface NrtInput {
  /** Detections per ISO since `since`; null when the database could not be read. */
  counts: Record<string, number> | null;
  since: string;
  /** Newest acquisition date among counted detections (YYYY-MM-DD), null when none. */
  lastDate: string | null;
  error?: string;
}

export interface GfwLossInput {
  /** Latest-year loss per ISO, only for regions that have one. */
  byIso: Record<string, { year: number; areaHa: number; live: boolean; source: string }>;
  hasApiKey: boolean;
}

export interface AssemblyInputs {
  forestland: RosleshozInput;
  forestFund: RosleshozInput;
  woodiness: RosleshozInput;
  woodVolume: RosleshozInput;
  archive: FirmsArchive | null;
  oopt: OoptInput;
  nrt: NrtInput;
  gfw: GfwLossInput;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ROSLESHOZ_SOURCE = 'Рослесхоз, открытые данные (rosleshoz.gov.ru/opendata), лицензия открытых данных РФ';

/** DD.MM.YYYY (UTC). */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

function nullIndicator(base: Omit<Indicator, 'value' | 'reason'>, reason: string): Indicator {
  return { ...base, value: null, reason };
}

function rosleshozIndicator(
  input: RosleshozInput,
  iso: string,
  base: Omit<Indicator, 'value' | 'period' | 'reason'>,
  datasetLabel: string,
): Indicator {
  const publishedPeriod = input.published ? `набор от ${formatDate(input.published)}` : null;
  if (!input.extraction) {
    return nullIndicator({ ...base, period: publishedPeriod }, `набор «${datasetLabel}» недоступен${input.error ? `: ${input.error}` : ''}`);
  }
  const entry = input.extraction.byIso.get(iso);
  if (!entry) return nullIndicator({ ...base, period: publishedPeriod }, `субъекта нет в наборе «${datasetLabel}»`);
  const period = entry.year != null ? String(entry.year) : publishedPeriod;
  if (entry.value == null) return nullIndicator({ ...base, period }, `в наборе «${datasetLabel}» нет значения`);
  return { ...base, value: entry.value, period };
}

function archiveSource(archive: FirmsArchive | null): string {
  const license = archive?.source.license ? `, ${archive.source.license}` : '';
  return `${archive?.source.name ?? 'NASA FIRMS'}, годовой архив VIIRS S-NPP (standard processing)${license}`;
}

type RegionArchive =
  | { ok: false; reason: string }
  | { ok: true; region: FirmsArchive['regions'][string]; years: number[]; latest: number };

/** Complete archive years plus the region's counts, or the reason they are absent. */
function regionArchive(archive: FirmsArchive | null, iso: string): RegionArchive {
  if (!archive) return { ok: false, reason: ARCHIVE_MISSING_REASON };
  const region = archive.regions[iso];
  if (!region) return { ok: false, reason: 'субъекта нет в архиве FIRMS' };
  const years = completeYears(archive);
  if (!years.length) return { ok: false, reason: 'в архиве FIRMS нет полных лет' };
  return { ok: true, region, years, latest: years[years.length - 1] };
}

// ─── Indicators ─────────────────────────────────────────────────────────────

export const DEFINITIONS = {
  forestland: 'Площадь лесных земель субъекта по государственному лесному реестру (покрытые лесом и не покрытые лесом лесные земли).',
  forestFund: 'Общая площадь земель лесного фонда субъекта (эксплуатационные, защитные и резервные леса).',
  woodiness: 'Лесистость: доля покрытых лесом земель в общей площади субъекта, по данным Рослесхоза.',
  woodVolume: 'Объём заготовленной древесины по отчётности субъекта, все виды рубок.',
  hotspots: 'Число термоточек VIIRS S-NPP с типом «растительность» (type = 0) внутри границ субъекта за календарный год. Термоточка — пиксель 375 м с тепловой аномалией, не подтверждённый пожар; статичные источники (факелы, type = 2) не входят.',
  hotspotDensity: 'Термоточки растительности за год на 10 000 км² площади субъекта (площадь полигона границ OSM). Позволяет сравнивать субъекты разного размера.',
  hotspotDeviation: 'Отклонение числа термоточек растительности за год от среднего за пять предыдущих полных лет архива: (год − среднее) / среднее × 100 %.',
  nrt: 'Обнаружения термоточек в режиме NRT (VIIRS S-NPP, NOAA-20, NOAA-21) из истории сайта, с начала её накопления. Одна точка может быть видна несколькими спутниками; факелы не исключены. Не сравнивать с годовым архивом: другая обработка, другие спутники и неполный период.',
  ooptShare: 'Приблизительная доля площади субъекта, занятая ООПТ федерального значения из OpenStreetMap (национальные парки и заповедники, упрощённые полигоны): площадь пересечения ООПТ с границей субъекта / площадь субъекта. Перекрывающиеся ООПТ считаются один раз.',
  coverLoss: 'Потеря древесного покрова (Hansen/UMD, сомкнутость ≥ 30 %). Без ключа GFW — оценка: национальный итог × доля субъекта по Рослесинфоргу (среднее 2015–2022). Потеря покрова ≠ незаконная рубка: причиной могут быть пожар, рубка, ветровал, вредители.',
  lossPer100k: 'Потеря древесного покрова за год на 100 000 га земель лесного фонда субъекта. Числитель — оценка по GFW, знаменатель — официальная площадь лесного фонда; показатель приблизительный.',
  reforestation: 'Площадь лесовосстановления. Рослесхоз публикует её только по России в целом; сопоставление восстановления и выбытия по субъектам не проводится — методики несовместимы.',
} as const;

export function buildIndicators(region: RegionIdentity, inputs: AssemblyInputs): Indicator[] {
  const { iso } = region;
  const list: Indicator[] = [];

  list.push(rosleshozIndicator(inputs.forestland, iso, {
    id: 'forestland_area', label: 'Площадь лесных земель', unit: 'тыс. га', source: `${ROSLESHOZ_SOURCE}; набор ForestlandArea`,
    kind: 'official', definition: DEFINITIONS.forestland,
  }, 'Площадь лесных земель'));

  const forestFund = rosleshozIndicator(inputs.forestFund, iso, {
    id: 'forest_fund_area', label: 'Лесной фонд', unit: 'тыс. га', source: `${ROSLESHOZ_SOURCE}; набор ForestFund`,
    kind: 'official', definition: DEFINITIONS.forestFund,
  }, 'Лесной фонд');
  list.push(forestFund);

  list.push(rosleshozIndicator(inputs.woodiness, iso, {
    id: 'woodiness', label: 'Лесистость', unit: '%', source: `${ROSLESHOZ_SOURCE}; набор ForestFund`,
    kind: 'official', definition: DEFINITIONS.woodiness,
  }, 'Лесной фонд'));

  list.push(rosleshozIndicator(inputs.woodVolume, iso, {
    id: 'wood_volume', label: 'Заготовка древесины', unit: 'тыс. м³', source: `${ROSLESHOZ_SOURCE}; набор WoodVolume`,
    kind: 'official', definition: DEFINITIONS.woodVolume,
  }, 'Заготовка древесины'));

  // Satellite: FIRMS annual archive
  const arch = regionArchive(inputs.archive, iso);
  const src = archiveSource(inputs.archive);
  const hotspotsBase = { id: 'hotspots_vegetation', label: 'Термоточки растительности за год', unit: 'шт.', source: src, kind: 'satellite' as const, definition: DEFINITIONS.hotspots };
  const densityBase = { id: 'hotspots_per_10k_km2', label: 'Термоточки на 10 тыс. км²', unit: 'шт. / 10 000 км² / год', source: `${src}; площадь — границы OSM`, kind: 'satellite' as const, definition: DEFINITIONS.hotspotDensity };
  const deviationBase = { id: 'hotspots_deviation_5y', label: 'Отклонение от среднего за 5 лет', unit: '%', source: src, kind: 'satellite' as const, definition: DEFINITIONS.hotspotDeviation };
  if (!arch.ok) {
    list.push(nullIndicator({ ...hotspotsBase, period: null }, arch.reason));
    list.push(nullIndicator({ ...densityBase, period: null }, arch.reason));
    list.push(nullIndicator({ ...deviationBase, period: null }, arch.reason));
  } else {
    const period = String(arch.latest);
    const latest = arch.region.years[period];
    if (latest) {
      list.push({ ...hotspotsBase, value: latest.vegetation, period });
      const density = perArea(latest.vegetation, region.areaKm2);
      list.push(density == null
        ? nullIndicator({ ...densityBase, period }, 'нет площади субъекта')
        : { ...densityBase, value: round(density, 2), period });
    } else {
      list.push(nullIndicator({ ...hotspotsBase, period }, `нет данных за ${period} в архиве`));
      list.push(nullIndicator({ ...densityBase, period }, `нет данных за ${period} в архиве`));
    }
    const series: Record<number, number | null> = {};
    for (const y of arch.years) series[y] = arch.region.years[String(y)]?.vegetation ?? null;
    const dev = deviationFromMean(series, arch.latest, arch.years);
    const devPeriod = `${arch.latest} к среднему ${arch.latest - 5}–${arch.latest - 1}`;
    list.push(dev.value == null
      ? nullIndicator({ ...deviationBase, period: devPeriod }, dev.reason)
      : { ...deviationBase, value: round(dev.value, 1), period: devPeriod });
  }

  // Satellite: current-season NRT history (not comparable with the archive)
  const nrtBase = {
    id: 'hotspots_nrt_season', label: 'Термоточки текущего сезона (NRT)', unit: 'обнаружений',
    source: 'NASA FIRMS VIIRS NRT (S-NPP, NOAA-20, NOAA-21), история сайта gis.fire_hotspots',
    kind: 'satellite' as const, definition: DEFINITIONS.nrt,
  };
  const nrtPeriod = `с ${formatDate(`${inputs.nrt.since}T00:00:00Z`)}${inputs.nrt.lastDate ? ` по ${formatDate(`${inputs.nrt.lastDate}T00:00:00Z`)}` : ''}`;
  list.push(inputs.nrt.counts
    ? { ...nrtBase, value: inputs.nrt.counts[iso] ?? 0, period: nrtPeriod }
    : nullIndicator({ ...nrtBase, period: nrtPeriod }, `история термоточек недоступна${inputs.nrt.error ? `: ${inputs.nrt.error}` : ''}`));

  // Estimate: OOPT share
  const ooptBase = {
    id: 'oopt_share', label: 'Доля ООПТ', unit: '% площади',
    source: 'OpenStreetMap (ODbL) через Overpass API: полигоны ООПТ и границы субъектов',
    kind: 'estimate' as const, definition: DEFINITIONS.ooptShare, approximate: true,
  };
  const ooptPeriod = inputs.oopt.fetchedAt ? `на ${formatDate(inputs.oopt.fetchedAt)}` : null;
  if (!inputs.oopt.areaKm2) {
    list.push(nullIndicator({ ...ooptBase, period: ooptPeriod }, `полигоны ООПТ недоступны${inputs.oopt.error ? `: ${inputs.oopt.error}` : ''}`));
  } else {
    const share = sharePercent(inputs.oopt.areaKm2[iso] ?? 0, region.areaKm2);
    list.push(share == null
      ? nullIndicator({ ...ooptBase, period: ooptPeriod }, 'нет площади субъекта')
      : { ...ooptBase, value: round(share, 2), period: ooptPeriod });
  }

  // Estimate (until GFW_API_KEY): cover loss and loss per 100 000 ha of forest fund
  const loss = inputs.gfw.byIso[iso];
  const lossKind: IndicatorKind = loss?.live ? 'satellite' : 'estimate';
  const lossBase = {
    id: 'cover_loss', label: 'Потеря древесного покрова', unit: 'га',
    source: loss?.source ?? 'Hansen/UMD/Google/USGS/NASA via Global Forest Watch',
    kind: lossKind, definition: DEFINITIONS.coverLoss, approximate: !loss?.live,
  };
  const per100kBase = {
    id: 'loss_per_100k_ha', label: 'Потери на 100 тыс. га лесного фонда', unit: 'га / 100 000 га',
    source: `${lossBase.source}; лесной фонд — Рослесхоз`,
    kind: 'estimate' as const, definition: DEFINITIONS.lossPer100k, approximate: true,
  };
  if (!loss) {
    const reason = inputs.gfw.hasApiKey
      ? 'GFW не вернул данные по субъекту'
      : 'нет региональной оценки: без GFW_API_KEY доли известны только для 14 лесных субъектов';
    list.push(nullIndicator({ ...lossBase, period: null }, reason));
    list.push(nullIndicator({ ...per100kBase, period: null }, reason));
  } else {
    const period = String(loss.year);
    list.push({ ...lossBase, value: Math.round(loss.areaHa), period });
    const per100k = lossPer100kHa(loss.areaHa, forestFund.value);
    list.push(per100k == null
      ? nullIndicator({ ...per100kBase, period }, 'нет площади лесного фонда (Рослесхоз)')
      : { ...per100kBase, value: round(per100k, 1), period });
  }

  return list;
}

export function buildHotspotSeries(region: RegionIdentity, archive: FirmsArchive | null): { series: HotspotYear[]; reason: string | null } {
  const arch = regionArchive(archive, region.iso);
  if (!arch.ok) return { series: [], reason: arch.reason };
  const series: HotspotYear[] = [];
  for (const year of arch.years) {
    const counts = arch.region.years[String(year)];
    if (!counts) continue;
    series.push({ year, ...counts, vegetationPer10k: round(perArea(counts.vegetation, region.areaKm2), 2) });
  }
  return { series, reason: series.length ? null : 'в архиве нет лет по субъекту' };
}

export function reforestationIndicator(): Indicator {
  return nullIndicator({
    id: 'reforestation', label: 'Лесовосстановление', unit: 'тыс. га', period: null,
    source: `${ROSLESHOZ_SOURCE}; набор ReforestationArea (только итог по России)`,
    kind: 'official', definition: DEFINITIONS.reforestation,
  }, 'нет региональных данных');
}

export function buildRegionDetail(region: RegionIdentity, baikal: boolean, inputs: AssemblyInputs): RegionDetail {
  const { series, reason } = buildHotspotSeries(region, inputs.archive);
  return {
    ...region,
    baikal,
    indicators: buildIndicators(region, inputs),
    hotspotSeries: series,
    hotspotSeriesReason: reason,
    extraIndicators: [reforestationIndicator()],
  };
}
