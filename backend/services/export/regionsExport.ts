/**
 * Regions export (GET /api/export/regions.csv|.json): the regionsService.list() table in long
 * format — one row per region and indicator. A missing value stays missing: null in JSON, an empty
 * cell in CSV, with the reason next to it — never 0.
 */
import type { RegionsListResponse } from '../regions/service';
import { EXPECTED_REGION_COUNT } from '../regions/registry';
import { GFW_CODE_TO_ISO } from '../regions/gfwRegions';
import { DEVIATION_WINDOW_YEARS, PER_AREA_KM2 } from '../regions/math';
import { toCsv } from './csv';
import { COVER_LOSS_WARNING, METHODOLOGY_URL, type ExportMetadataBase, type ExportSource } from './provenance';

export const REGION_COLUMNS = [
  'iso', 'name', 'baikal', 'indicator_id', 'label', 'value', 'unit', 'period', 'kind', 'approximate', 'source', 'reason',
] as const;

export type RegionColumn = (typeof REGION_COLUMNS)[number];
export type RegionExportRow = Record<RegionColumn, string | number | boolean | null>;

/** Long format: one row per (region, indicator), in the service's region and indicator order. */
export function toRegionRows(list: Pick<RegionsListResponse, 'regions'>): RegionExportRow[] {
  return list.regions.flatMap(region => region.indicators.map(ind => ({
    iso: region.iso,
    name: region.name,
    baikal: region.baikal,
    indicator_id: ind.id,
    label: ind.label,
    value: ind.value ?? null,
    unit: ind.unit,
    period: ind.period ?? null,
    kind: ind.kind,
    approximate: ind.approximate ?? false,
    source: ind.source,
    reason: ind.value == null ? ind.reason ?? null : null,
  })));
}

export interface RegionsExportMetadata extends ExportMetadataBase {
  dataset: 'regions';
  /** When the regional summary was built (it is cached up to 12 h). */
  dataBuiltAt: string;
  regionCount: number;
  files: {
    boundaries: string;
    firmsArchive: RegionsListResponse['archive'];
  };
  methods: {
    densityPerKm2: number;
    deviationBaselineYears: number;
    gfwEstimateRegions: number;
    kinds: Record<'official' | 'satellite' | 'estimate', string>;
  };
  sourceErrors: string[];
}

export function buildRegionsMetadata(args: {
  generatedAt: string;
  list: RegionsListResponse;
  count: number;
  sources: ExportSource[];
}): RegionsExportMetadata {
  const { list } = args;
  return {
    title: 'ForestWatch — региональные показатели (длинный формат)',
    dataset: 'regions',
    generatedAt: args.generatedAt,
    dataBuiltAt: list.generatedAt,
    count: args.count,
    regionCount: list.regions.length,
    sources: args.sources,
    files: { boundaries: list.boundariesFile, firmsArchive: list.archive },
    methods: {
      densityPerKm2: PER_AREA_KM2,
      deviationBaselineYears: DEVIATION_WINDOW_YEARS,
      gfwEstimateRegions: Object.keys(GFW_CODE_TO_ISO).length,
      kinds: { official: 'официальные данные', satellite: 'спутник', estimate: 'оценка' },
    },
    sourceErrors: list.diagnostics.sourceErrors,
    methodology: METHODOLOGY_URL,
    warnings: [
      'Пустое значение — нет данных (причина в колонке reason), а не ноль.',
      'Термоточки — спутниковые тепловые аномалии, не подтверждённые пожары.',
      COVER_LOSS_WARNING,
      `Субъектов: ${EXPECTED_REGION_COUNT}, границы OpenStreetMap; Крым, Севастополь и регионы 2022 г. не включены (решение владельца сайта).`,
    ],
  };
}

export function regionsToCsv(rows: RegionExportRow[]): string {
  return toCsv(REGION_COLUMNS, rows);
}

export function regionsToJson(metadata: RegionsExportMetadata, rows: RegionExportRow[]) {
  return { metadata, data: rows };
}
