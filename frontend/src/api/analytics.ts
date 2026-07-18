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

export async function fetchDeforestationByRegion(
  region: string,
  startYear = 2001,
  endYear = 2023
): Promise<TreeCoverLossYear[]> {
  const res = await fetch(
    `/api/monitoring/gfw/tree-cover-loss?region=${region}&start_year=${startYear}&end_year=${endYear}`
  );
  if (!res.ok) throw new Error('GFW API error');
  const json = await res.json();
  return json.data as TreeCoverLossYear[];
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
