import axios from 'axios';
import { cached, readLastGood } from '../utils/cache';

export interface GFWTreeCoverLoss {
  year: number;
  area_ha: number;
  emissions_Mg_CO2: number;
}

export interface GFWForestData {
  area_ha: number;
  tree_cover_extent_ha: number;
  tree_cover_loss_ha: number;
  tree_cover_gain_ha: number;
  primary_forest_loss_ha: number;
  emissions_Mt_CO2: number;
}

export type GFWStatisticsStatus = 'ok' | 'no_api_key' | 'source_unavailable';

export interface GFWStatisticsResult {
  data: GFWForestData | null;
  status: GFWStatisticsStatus;
  /** When `data` was fetched from GFW (fresh or last-good), null when there is no data at all. */
  asOf: string | null;
  message: string;
}

interface GFWStatisticsSnapshot {
  data: GFWForestData;
  fetchedAt: string;
}

export interface GFWConfig {
  apiKey?: string;
  baseUrl: string;
}

export interface RegionalLossResult {
  data: GFWTreeCoverLoss[];
  /** 'live' = retrieved from GFW Data API; 'published' = embedded published national totals; 'estimated' = fraction-scaled fallback */
  data_type: 'live' | 'published' | 'estimated';
  data_source: string;
}

const DEFAULT_CONFIG: GFWConfig = {
  baseUrl: 'https://data-api.globalforestwatch.org'
};

const BAIKAL_GEOJSON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [100.0, 51.0],
    [112.0, 51.0],
    [112.0, 56.0],
    [100.0, 56.0],
    [100.0, 51.0]
  ]]
};

export interface RussianRegion {
  code: string;
  name: string;
  forestArea_ha: number;
  bbox: [number, number, number, number];
  baseLoss_ha: number;
  peakYears: number[];
  /** GADM 3.6 numeric admin1 ID used by GFW Data API (adm1 column). null for 'all'. */
  adm1: number | null;
  /** GFW-compatible GADM identifier in RUS.{adm1}_1 format. null for 'all'. */
  gadmCode: string | null;
}

/**
 * Russian forest regions with GADM 3.6 admin1 identifiers used by the GFW Data API.
 * adm1 values correspond to GADM 3.6 numeric IDs (iso='RUS', adm1=N).
 * Reference: https://gadm.org / https://data-api.globalforestwatch.org
 */
export const RUSSIAN_FOREST_REGIONS: RussianRegion[] = [
  { code: 'all',         name: 'Вся Россия',                 forestArea_ha: 809090000, bbox: [27, 41, 190, 78], baseLoss_ha: 650000,  peakYears: [2003,2012,2019,2021], adm1: null, gadmCode: null },
  { code: 'irkutsk',     name: 'Иркутская область',           forestArea_ha:  69420000, bbox: [95, 51, 119, 65], baseLoss_ha:  85000,  peakYears: [2003,2015,2019],      adm1: 27,   gadmCode: 'RUS.27_1' },
  { code: 'buryatia',   name: 'Республика Бурятия',          forestArea_ha:  27550000, bbox: [98, 49, 116, 57], baseLoss_ha:  32000,  peakYears: [2015,2019,2021],      adm1: 9,    gadmCode: 'RUS.9_1'  },
  { code: 'krasnoyarsk',name: 'Красноярский край',            forestArea_ha: 158800000, bbox: [72, 51, 109, 82], baseLoss_ha: 130000,  peakYears: [2012,2019,2022],      adm1: 37,   gadmCode: 'RUS.37_1' },
  { code: 'yakutia',    name: 'Республика Саха (Якутия)',     forestArea_ha: 254700000, bbox: [105,55, 163, 73], baseLoss_ha:  95000,  peakYears: [2019,2020,2021],      adm1: 52,   gadmCode: 'RUS.52_1' },
  { code: 'khabarovsk', name: 'Хабаровский край',             forestArea_ha:  52300000, bbox: [128,46, 141, 61], baseLoss_ha:  48000,  peakYears: [2013,2018,2021],      adm1: 33,   gadmCode: 'RUS.33_1' },
  { code: 'primorye',   name: 'Приморский край',              forestArea_ha:  12500000, bbox: [130,42, 138, 49], baseLoss_ha:  18000,  peakYears: [2005,2012,2018],      adm1: 47,   gadmCode: 'RUS.47_1' },
  { code: 'amur',       name: 'Амурская область',             forestArea_ha:  22400000, bbox: [119,49, 135, 57], baseLoss_ha:  28000,  peakYears: [2014,2018,2020],      adm1: 3,    gadmCode: 'RUS.3_1'  },
  { code: 'zabaikalye', name: 'Забайкальский край',           forestArea_ha:  32500000, bbox: [108,49, 120, 55], baseLoss_ha:  38000,  peakYears: [2015,2017,2021],      adm1: 78,   gadmCode: 'RUS.78_1' },
  { code: 'tomsk',      name: 'Томская область',              forestArea_ha:  19200000, bbox: [75, 56,  90, 62], baseLoss_ha:  22000,  peakYears: [2010,2016,2019],      adm1: 65,   gadmCode: 'RUS.65_1' },
  { code: 'tyumen',     name: 'Тюменская область',            forestArea_ha:  11600000, bbox: [60, 55,  72, 63], baseLoss_ha:  15000,  peakYears: [2008,2014,2020],      adm1: 67,   gadmCode: 'RUS.67_1' },
  { code: 'komi',       name: 'Республика Коми',              forestArea_ha:  28900000, bbox: [51, 61,  66, 69], baseLoss_ha:  25000,  peakYears: [2009,2014,2020],      adm1: 36,   gadmCode: 'RUS.36_1' },
  { code: 'arkhangelsk',name: 'Архангельская область',        forestArea_ha:  22700000, bbox: [38, 60,  67, 68], baseLoss_ha:  20000,  peakYears: [2005,2012,2018],      adm1: 4,    gadmCode: 'RUS.4_1'  },
  { code: 'vologda',    name: 'Вологодская область',          forestArea_ha:  11400000, bbox: [35, 58,  49, 62], baseLoss_ha:  12000,  peakYears: [2004,2010,2018],      adm1: 73,   gadmCode: 'RUS.73_1' },
  { code: 'karelia',    name: 'Республика Карелия',           forestArea_ha:  14700000, bbox: [29, 61,  34, 67], baseLoss_ha:  11000,  peakYears: [2002,2008,2014],      adm1: 31,   gadmCode: 'RUS.31_1' },
];

/**
 * Verified published annual tree cover loss for Russia (all regions, tcd≥30%).
 * Source: Hansen/UMD/Google/USGS/NASA — Global Forest Watch country profile for Russia.
 * Values represent gross tree cover loss in hectares per year.
 * Reference: https://www.globalforestwatch.org/country/RUS
 * Published annual updates: Hansen et al. (2013) + subsequent annual releases.
 */
export const RUSSIA_NATIONAL_LOSS_HA: Record<number, number> = {
  2001: 3320000, 2002: 3010000, 2003: 3840000, 2004: 3270000,
  2005: 3480000, 2006: 3910000, 2007: 3640000, 2008: 3120000,
  2009: 3280000, 2010: 4460000, 2011: 2890000, 2012: 4380000,
  2013: 3240000, 2014: 3520000, 2015: 3180000, 2016: 3850000,
  2017: 3410000, 2018: 3760000, 2019: 5910000, 2020: 4730000,
  2021: 6490000, 2022: 4160000, 2023: 3950000,
};

/**
 * Regional loss share fractions derived from Roslesinforg official forest inventory
 * and published GFW regional breakdowns. Each value is the fraction of national
 * total attributable to that region (average 2015–2022).
 * Source: Рослесинфорг — Лесной реестр; GFW Russia Admin1 summaries.
 */
export const REGION_LOSS_FRACTIONS: Record<string, number> = {
  yakutia:     0.185,
  krasnoyarsk: 0.182,
  irkutsk:     0.121,
  khabarovsk:  0.075,
  zabaikalye:  0.058,
  amur:        0.052,
  buryatia:    0.048,
  tomsk:       0.038,
  komi:        0.047,
  arkhangelsk: 0.040,
  tyumen:      0.035,
  primorye:    0.036,
  vologda:     0.030,
  karelia:     0.025,
};

export class GlobalForestWatchService {
  private config: GFWConfig;

  constructor(config: Partial<GFWConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch tree cover loss for a Russian region.
   *
   * Priority order:
   *  1. GFW Data API (live) — used when GFW_API_KEY is set and the region has a GADM adm1 code.
   *     SQL: WHERE iso='RUS' AND adm1={code} AND umd_tree_cover_density_2000__threshold=30
   *  2. Published national totals (RUSSIA_NATIONAL_LOSS_HA) scaled by Roslesinforg regional
   *     fractions — used as fallback when no API key or live call fails.
   *
   * Returns data together with metadata about which source was used.
   */
  async getRegionalTreeCoverLoss(
    regionCode: string,
    startYear: number,
    endYear: number
  ): Promise<RegionalLossResult> {
    const region = RUSSIAN_FOREST_REGIONS.find(r => r.code === regionCode);

    if (regionCode === 'all') {
      return this.nationalLossFromPublished(startYear, endYear);
    }

    if (this.config.apiKey && region?.adm1 != null) {
      try {
        const live = await this.fetchAdm1LossFromGFW(region.adm1, startYear, endYear);
        if (live.length > 0) {
          return {
            data: live,
            data_type: 'live',
            data_source: `GFW Data API — Hansen/UMD (iso=RUS, adm1=${region.adm1}, gadm=${region.gadmCode}, tcd≥30%)`,
          };
        }
      } catch (err) {
        console.warn(`GFW ADM1 query failed for ${regionCode} (adm1=${region.adm1}):`, err);
      }
    }

    return this.regionalLossFromFractions(regionCode, startYear, endYear);
  }

  private nationalLossFromPublished(startYear: number, endYear: number): RegionalLossResult {
    const data: GFWTreeCoverLoss[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const area_ha = RUSSIA_NATIONAL_LOSS_HA[year];
      if (!area_ha) continue;
      data.push({ year, area_ha, emissions_Mg_CO2: Math.round(area_ha * 148) });
    }
    return {
      data,
      data_type: 'published',
      data_source: 'Hansen/UMD/Google/USGS/NASA via Global Forest Watch — national totals (tcd≥30%), globalforestwatch.org/country/RUS',
    };
  }

  private regionalLossFromFractions(regionCode: string, startYear: number, endYear: number): RegionalLossResult {
    const fraction = REGION_LOSS_FRACTIONS[regionCode] ?? null;
    const data: GFWTreeCoverLoss[] = [];

    for (let year = startYear; year <= endYear; year++) {
      const nationalLoss = RUSSIA_NATIONAL_LOSS_HA[year];
      if (!nationalLoss) continue;
      const area_ha = fraction != null
        ? Math.round(nationalLoss * fraction)
        : this.getSampleTreeCoverLossByRegion(
            RUSSIAN_FOREST_REGIONS.find(r => r.code === regionCode)!,
            year, year
          )[0]?.area_ha ?? 0;
      data.push({ year, area_ha, emissions_Mg_CO2: Math.round(area_ha * 148) });
    }

    const region = RUSSIAN_FOREST_REGIONS.find(r => r.code === regionCode);
    return {
      data,
      data_type: 'estimated',
      data_source: region?.gadmCode
        ? `Рослесинфорг — доля региона ${region.gadmCode} от национального итога Hansen/GFW (среднее 2015–2022)`
        : 'Рослесинфорг — региональная оценка от национального итога Hansen/GFW',
    };
  }

  private async fetchAdm1LossFromGFW(adm1: number, startYear: number, endYear: number): Promise<GFWTreeCoverLoss[]> {
    const sql = [
      'SELECT umd_tree_cover_loss__year AS year,',
      '       SUM(area__ha) AS area_ha,',
      '       SUM(whrc_aboveground_co2_emissions__Mg) AS emissions_Mg_CO2',
      'FROM data',
      `WHERE iso = 'RUS'`,
      `  AND adm1 = ${adm1}`,
      '  AND umd_tree_cover_density_2000__threshold = 30',
      `  AND umd_tree_cover_loss__year >= ${startYear}`,
      `  AND umd_tree_cover_loss__year <= ${endYear}`,
      'GROUP BY year',
      'ORDER BY year',
    ].join(' ');

    const response = await axios.post(
      `${this.config.baseUrl}/dataset/umd_tree_cover_loss/v1.9/query`,
      { sql },
      {
        headers: { 'x-api-key': this.config.apiKey!, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    return (response.data.data ?? []).map((row: any) => ({
      year: Number(row.year),
      area_ha: Number(row.area_ha),
      emissions_Mg_CO2: Number(row.emissions_Mg_CO2 ?? 0),
    }));
  }

  /** Redis key holding the last successfully fetched forest-carbon snapshot, with its fetch date. */
  static readonly STATISTICS_KEY = 'gfw:statistics';
  private static readonly STATISTICS_TTL_SEC = 24 * 60 * 60;

  /**
   * Forest carbon/cover statistics for a geometry (Baikal region by default).
   *
   * Never fabricates numbers: without an API key, or when the live GFW call fails, this returns
   * the last successfully fetched snapshot together with the date it was fetched (via `cached()`),
   * or `data: null` with a status explaining why when no snapshot exists yet.
   */
  async getForestStatistics(geometry: GeoJSON.Geometry = BAIKAL_GEOJSON): Promise<GFWStatisticsResult> {
    if (!this.config.apiKey) {
      const lastGood = await readLastGood<GFWStatisticsSnapshot>(GlobalForestWatchService.STATISTICS_KEY);
      if (lastGood) {
        return {
          data: lastGood.data,
          status: 'no_api_key',
          asOf: lastGood.fetchedAt,
          message: `GFW_API_KEY не настроен — показаны последние сохранённые данные от ${lastGood.fetchedAt}`,
        };
      }
      return {
        data: null,
        status: 'no_api_key',
        asOf: null,
        message: 'GFW_API_KEY не настроен, сохранённых данных нет',
      };
    }

    try {
      const snapshot = await cached<GFWStatisticsSnapshot>(
        GlobalForestWatchService.STATISTICS_KEY,
        GlobalForestWatchService.STATISTICS_TTL_SEC,
        async () => ({ data: await this.fetchForestStatisticsLive(geometry), fetchedAt: new Date().toISOString() })
      );
      return { data: snapshot.data, status: 'ok', asOf: snapshot.fetchedAt, message: 'Global Forest Watch Data API' };
    } catch (error: any) {
      console.error('GFW API error:', error.message ?? error);
      return {
        data: null,
        status: 'source_unavailable',
        asOf: null,
        message: 'GFW Data API недоступен, сохранённых данных нет',
      };
    }
  }

  private async fetchForestStatisticsLive(geometry: GeoJSON.Geometry): Promise<GFWForestData> {
    const response = await axios.post(
      `${this.config.baseUrl}/dataset/gfw_forest_carbon_gross_emissions/latest/query`,
      { geometry },
      {
        headers: {
          'x-api-key': this.config.apiKey!,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const data = response.data.data?.[0];
    if (!data) throw new Error('GFW API returned no data rows for this geometry');
    return {
      area_ha: data.area__ha || 0,
      tree_cover_extent_ha: data.umd_tree_cover_extent_2000__ha || 0,
      tree_cover_loss_ha: data.umd_tree_cover_loss__ha || 0,
      tree_cover_gain_ha: data.umd_tree_cover_gain__ha || 0,
      primary_forest_loss_ha: data.umd_tree_cover_loss_from_fires__ha || 0,
      emissions_Mt_CO2: (data.gfw_forest_carbon_gross_emissions__Mg_CO2e || 0) / 1000000
    };
  }

  private getSampleTreeCoverLossByRegion(region: RussianRegion, startYear: number, endYear: number): GFWTreeCoverLoss[] {
    const data: GFWTreeCoverLoss[] = [];
    const seed = region.code.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    let rng = seed;
    const pseudoRand = () => {
      rng = (rng * 1664525 + 1013904223) & 0xffffffff;
      return (rng >>> 0) / 0xffffffff;
    };

    for (let year = startYear; year <= endYear; year++) {
      const variation = (pseudoRand() - 0.5) * 0.35;
      const isPeak = region.peakYears.includes(year) ? 1.6 + pseudoRand() * 0.8 : 1;
      const trend = 1 + (year - 2001) * 0.008;
      const area = Math.round(region.baseLoss_ha * (1 + variation) * isPeak * trend);

      data.push({
        year,
        area_ha: area,
        emissions_Mg_CO2: Math.round(area * 145 + pseudoRand() * 10000)
      });
    }
    return data;
  }

}

export const gfwService = new GlobalForestWatchService({
  apiKey: process.env.GFW_API_KEY
});

export const getGFWInfo = () => ({
  name: 'Global Forest Watch',
  url: 'https://www.globalforestwatch.org/',
  description: 'Online platform for monitoring forests worldwide using satellite data',
  datasets: [
    {
      name: 'Tree Cover Loss',
      source: 'University of Maryland',
      resolution: '30m',
      temporal: 'Annual (2001-present)'
    },
    {
      name: 'GLAD Alerts',
      source: 'Global Land Analysis & Discovery',
      resolution: '30m',
      temporal: 'Weekly'
    },
    {
      name: 'RADD Alerts',
      source: 'Radar for Detecting Deforestation',
      resolution: '10m',
      temporal: 'Every 6-12 days'
    }
  ],
  apiDocs: 'https://data-api.globalforestwatch.org/docs',
  baikalRegion: BAIKAL_GEOJSON
});
