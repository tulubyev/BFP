/** GET /api/monitoring/forest-changes/:id/context (backend/routes/incidentContext.ts). */

export interface NearestRoad {
  osm_id: number;
  osm_url: string;
  /** OSM `highway` value: trunk, secondary, track, … */
  highway: string;
  name: string | null;
  ref: string | null;
  surface: string | null;
  paved: boolean;
  /** No `surface` tag: taken as paved by the road class. */
  paved_by_class: boolean;
  distance_km: number;
  bearing_deg: number;
  /** «на северо-восток» */
  direction: string;
}

export interface NearestSettlement {
  osm_id: number;
  osm_type: 'node' | 'way' | 'relation';
  osm_url: string;
  place: 'city' | 'town' | 'village' | 'hamlet';
  name: string | null;
  distance_km: number;
  bearing_deg: number;
  direction: string;
}

export interface IncidentContextResponse {
  success: true;
  incident_id: number;
  point: { lat: number; lon: number };
  radius_km: number;
  nearest_road: NearestRoad | null;
  nearest_paved_road: NearestRoad | null;
  nearest_track: NearestRoad | null;
  nearest_settlement: NearestSettlement | null;
  data_date: string;
  fetched_at: string;
  source: string;
  license: string;
  note: string;
}

export const incidentContextUrl = (id: number) => `/api/monitoring/forest-changes/${id}/context`;

export async function getIncidentContext(id: number, signal?: AbortSignal): Promise<IncidentContextResponse> {
  const response = await fetch(incidentContextUrl(id), { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error || 'Не удалось загрузить дороги и населённые пункты');
  return body as IncidentContextResponse;
}
