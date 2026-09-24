/**
 * Рослесхоз Open Data Service
 * Fetches and caches official CSV datasets from rosleshoz.gov.ru/opendata/
 * Data is published under the Russian Open Data license (CC0-compatible).
 */
import axios from 'axios';
import { cached, warm } from '../utils/cache';

const BASE = 'https://rosleshoz.gov.ru';

// Dataset URLs discovered from the opendata registry page
export const DATASETS = {
  woodVolume: '/opendata/7705598840-WoodVolume/data-20260427T0000structure-20260427T0000.csv',
  foresFundFires: '/opendata/7705598840-ForesFundFires/data-20240508T0000structure-20240508T0000.csv',
  foresFundFiresArea: '/opendata/7705598840-ForesFundFiresArea/data-20240508T0000structure-20240508T0000.csv',
  reforestationArea: '/opendata/7705598840-ReforestationArea/data-20260506T0000structure-20260506T0000.csv',
  forestFund: '/opendata/7705598840-ForestFund/data-20260521T0000structure-20260521T0000.csv',
  forestlandArea: '/opendata/7705598840-ForestlandArea/data-20260519T0000structure-20260519T0000.csv',
  woodStock: '/opendata/7705598840-WoodStock/data-20260520T0000structure-20260520T0000.csv',
  woodChecks: '/opendata/7705598840-WoodChecks/data-20260520T0000structure-20260520T0000.csv',
  sanitationActivities: '/opendata/7705598840-SanitationActivities/data-20260617T0000structure-20260617T0000.csv',
  aerialWorks: '/opendata/7705598840-AerialWorks/data-20260617T0000structure-20260617T0000.csv',
  registerForestFires: '/opendata/7705598840-RegisterForestFires/data-20240508T0000structure-20240508T0000.csv',
  fireCover: '/opendata/7705598840-FireCover/data-20240508T0000structure-20240508T0000.csv',
  mineralizedStrips: '/opendata/7705598840-MineralizedStrips/data-20240508T0000structure-20240508T0000.csv',
};

// Refreshed in the background every 12h (jobs/refresh.ts); TTL outlives several missed runs
const TTL_SEC = 3 * 24 * 60 * 60;

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h.trim()] = (values[i] ?? '').trim(); });
    return obj;
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

const HTTP_HEADERS = { 'User-Agent': 'Mozilla/5.0 ForestMonitor/1.0' };

/** Newest `data-…csv` path listed in a dataset's meta.csv (only rosleshoz.gov.ru links). */
export function latestDataPath(metaCsv: string): string | null {
  const paths = [...metaCsv.matchAll(/^data-[^,]+,https?:\/\/rosleshoz\.gov\.ru(\/opendata\/[^\s,]+\.csv)\s*$/gm)]
    .map(m => m[1])
    .sort();
  return paths.length ? paths[paths.length - 1] : null;
}

/** Datasets are republished under new file names; meta.csv points at the current one. */
async function resolveDatasetPath(key: keyof typeof DATASETS): Promise<string> {
  const fallback = DATASETS[key];
  try {
    const dir = fallback.slice(0, fallback.lastIndexOf('/'));
    const meta = await axios.get<string>(`${BASE}${dir}/meta.csv`, { timeout: 15000, headers: HTTP_HEADERS, responseType: 'text' });
    return latestDataPath(meta.data) ?? fallback;
  } catch (err: any) {
    console.warn(`Rosleshoz meta.csv for ${key} failed, using known file:`, err.message);
    return fallback;
  }
}

const isNonEmpty = (data: unknown) => data != null && (!Array.isArray(data) || data.length > 0);

async function loadDataset<T>(key: keyof typeof DATASETS, transform: (rows: Record<string, string>[]) => T): Promise<T> {
  const response = await axios.get(BASE + (await resolveDatasetPath(key)), { timeout: 15000, headers: HTTP_HEADERS });
  return transform(parseCSV(response.data));
}

type Transform = (rows: Record<string, string>[]) => unknown;
/** Datasets requested so far and how they are parsed — the background refresh re-runs these. */
const loaded = new Map<keyof typeof DATASETS, Transform>();

async function fetchDataset<T>(key: keyof typeof DATASETS, transform: (rows: Record<string, string>[]) => T): Promise<T> {
  loaded.set(key, transform);
  return cached(`rosleshoz:${key}`, TTL_SEC, () => loadDataset(key, transform), { isValid: isNonEmpty });
}

/** Re-downloads every dataset used by the API (the summary covers the home page). */
export async function refreshRosleshoz(): Promise<boolean> {
  await getAggregatedSummary();
  const results = await Promise.all(
    [...loaded].map(([key, transform]) => warm(`rosleshoz:${key}`, TTL_SEC, () => loadDataset(key, transform), { isValid: isNonEmpty })),
  );
  return results.every(Boolean);
}

// ─── Typed fetch methods ────────────────────────────────────────────────────

export interface WoodVolumeEntry {
  region: string;
  volume_thousand_m3: number;
}

export async function getWoodVolume(): Promise<WoodVolumeEntry[]> {
  return fetchDataset('woodVolume', rows =>
    rows.map(r => ({
      region: r.region ?? r['region'] ?? '',
      volume_thousand_m3: parseFloat(r.volume ?? r['volume'] ?? '0') || 0,
    })).filter(r => r.region)
  );
}

export interface ReforestationEntry {
  year: number;
  area_thousand_ha: number;
}

export async function getReforestationArea(): Promise<ReforestationEntry[]> {
  return fetchDataset('reforestationArea', rows =>
    rows.map(r => ({
      year: parseInt(r.year ?? '0') || 0,
      area_thousand_ha: parseFloat(r.area ?? '0') || 0,
    })).filter(r => r.year > 2000).sort((a, b) => a.year - b.year)
  );
}

export interface ForestlandEntry {
  subject: string;
  area_thousand_ha: number;
}

export async function getForestlandArea(): Promise<ForestlandEntry[]> {
  return fetchDataset('forestlandArea', rows =>
    rows.map(r => ({
      subject: r.subjects ?? r.subject ?? '',
      area_thousand_ha: parseFloat(r.area ?? '0') || 0,
    })).filter(r => r.subject)
  );
}

export interface ForestFiresSummary {
  /** Number of fire events in 2023 (from the ForesFundFires dataset) */
  events_2023: Record<string, number>;
  /** Total burned area in thousand hectares */
  total_area_thousand_ha: number;
}

export async function getForestFiresSummary(): Promise<ForestFiresSummary> {
  const [firesRows, areaRows] = await Promise.all([
    fetchDataset('foresFundFires', r => r),
    fetchDataset('foresFundFiresArea', r => r),
  ]);
  const events_2023: Record<string, number> = {};
  for (const row of firesRows) {
    const key = row.name ?? 'unknown';
    const val = parseFloat(row.number2023 ?? row.value ?? '0') || 0;
    events_2023[key] = val;
  }
  const total_area_thousand_ha = parseFloat(areaRows[0]?.area ?? '0') || 0;
  return { events_2023, total_area_thousand_ha };
}

export interface WoodCheckEntry {
  /** Raw keys depend on actual CSV structure */
  [key: string]: string;
}

export async function getWoodChecks(): Promise<WoodCheckEntry[]> {
  return fetchDataset('woodChecks', rows => rows);
}

export interface SanitationEntry {
  [key: string]: string;
}

export async function getSanitationActivities(): Promise<SanitationEntry[]> {
  return fetchDataset('sanitationActivities', rows => rows);
}

export interface ForestFundEntry {
  region: string;
  total_thousand_ha: number;
  operational_thousand_ha: number;
  protective_thousand_ha: number;
  protected_thousand_ha: number;
  woodiness_percent: number;
}

export async function getForestFund(): Promise<ForestFundEntry[]> {
  return fetchDataset('forestFund', rows =>
    rows.map(r => ({
      region: r.region ?? '',
      total_thousand_ha: parseFloat(r.total_materials ?? r.total ?? '0') || 0,
      operational_thousand_ha: parseFloat(r.operational ?? '0') || 0,
      protective_thousand_ha: parseFloat(r.protective ?? '0') || 0,
      protected_thousand_ha: parseFloat(r.protected ?? '0') || 0,
      woodiness_percent: parseFloat(r.woodiness ?? '0') || 0,
    })).filter(r => r.region)
  );
}

export interface AggregatedSummary {
  source: 'Рослесхоз (opendata)';
  license: 'Открытые данные РФ (CC0)';
  updated: string;
  total_wood_volume_thousand_m3: number;
  total_forestland_area_thousand_ha: number;
  reforestation_latest: ReforestationEntry | null;
  fires_area_thousand_ha: number;
  regions_wood_volume: WoodVolumeEntry[];
}

export async function getAggregatedSummary(): Promise<AggregatedSummary> {
  const [woodVolume, forestland, reforestation, fires] = await Promise.all([
    getWoodVolume(),
    getForestlandArea(),
    getReforestationArea(),
    getForestFiresSummary(),
  ]);

  const totalRow = woodVolume.find(r =>
    r.region.toLowerCase().includes('российская федерация') ||
    r.region.toLowerCase().includes('всего по')
  );
  const forestlandTotal = forestland.find(r =>
    r.subject.toLowerCase().includes('всего') ||
    r.subject.toLowerCase().includes('российская федерация')
  );

  const reforestationLatest = reforestation.length > 0
    ? reforestation[reforestation.length - 1]
    : null;

  return {
    source: 'Рослесхоз (opendata)',
    license: 'Открытые данные РФ (CC0)',
    updated: new Date().toISOString(),
    total_wood_volume_thousand_m3: totalRow?.volume_thousand_m3 ?? 0,
    total_forestland_area_thousand_ha: forestlandTotal?.area_thousand_ha ?? 0,
    reforestation_latest: reforestationLatest,
    fires_area_thousand_ha: fires.total_area_thousand_ha,
    regions_wood_volume: woodVolume.filter(r =>
      !r.region.toLowerCase().includes('всего') &&
      !r.region.toLowerCase().includes('российская федерация')
    ),
  };
}
