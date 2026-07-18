export interface TreeCoverLossYear {
  year: number;
  area_ha: number;
  emissions_Mg_CO2: number;
}

export interface RegionInfo {
  code: string;
  name: string;
  forestArea_ha: number;
}

export interface FireStat {
  year: number;
  month: number;
  count: string;
  avg_brightness: string;
  avg_frp: string;
}

export interface DeforestationResponse {
  data: TreeCoverLossYear[];
  data_source: string;
  data_type: 'published' | 'estimated';
  region: string;
}

export async function fetchDeforestationByRegion(
  region: string,
  startYear = 2001,
  endYear = 2023
): Promise<DeforestationResponse> {
  const res = await fetch(
    `/api/monitoring/gfw/tree-cover-loss?region=${region}&start_year=${startYear}&end_year=${endYear}`
  );
  if (!res.ok) throw new Error('GFW API error');
  const json = await res.json();
  return {
    data: json.data as TreeCoverLossYear[],
    data_source: json.data_source as string,
    data_type: (json.data_type ?? 'estimated') as 'published' | 'estimated',
    region: String(json.region),
  };
}

export async function fetchRegions(): Promise<RegionInfo[]> {
  const res = await fetch('/api/monitoring/gfw/regions');
  if (!res.ok) throw new Error('Regions API error');
  const json = await res.json();
  return json.data as RegionInfo[];
}

export async function fetchFireStats(): Promise<FireStat[]> {
  const res = await fetch('/api/monitoring/fire-hotspots/stats');
  if (!res.ok) throw new Error('Fire stats API error');
  const json = await res.json();
  return json.data as FireStat[];
}

export async function fetchForestChanges(): Promise<any[]> {
  const res = await fetch('/api/monitoring/forest-changes');
  if (!res.ok) throw new Error('Forest changes API error');
  const json = await res.json();
  return json.data;
}
