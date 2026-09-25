/** Regional analytics API (backend/routes/regions.ts). Types mirror backend/services/regions. */

export type IndicatorKind = 'official' | 'satellite' | 'estimate';

export interface Indicator {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  period: string | null;
  source: string;
  kind: IndicatorKind;
  definition: string;
  reason?: string;
  approximate?: boolean;
}

export interface RegionSummary {
  iso: string;
  name: string;
  areaKm2: number;
  baikal: boolean;
  indicators: Indicator[];
}

export interface HotspotYear {
  year: number;
  vegetation: number;
  static: number;
  offshore: number;
  frpVegetation: number;
  vegetationPer10k: number | null;
}

export interface ArchiveInfo {
  file: string;
  generatedAt: string;
  years: number[];
  source: { name: string; urls: string[]; license: string };
}

export interface RegionsListResponse {
  generatedAt: string;
  boundariesFile: string;
  archive: ArchiveInfo | null;
  regions: RegionSummary[];
  diagnostics: { unmappedRosleshozNames: string[]; sourceErrors: string[] };
}

export interface RegionDetailResponse extends RegionSummary {
  hotspotSeries: HotspotYear[];
  hotspotSeriesReason: string | null;
  extraIndicators: Indicator[];
  generatedAt: string;
  archive: ArchiveInfo | null;
  boundariesFile: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchRegionsList(): Promise<RegionsListResponse> {
  return getJson<RegionsListResponse>('/api/regions');
}

export function fetchRegionDetail(iso: string): Promise<RegionDetailResponse> {
  return getJson<RegionDetailResponse>(`/api/regions/${encodeURIComponent(iso)}`);
}
