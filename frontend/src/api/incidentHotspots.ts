/** GET /api/monitoring/forest-changes/:id/hotspots (backend/routes/incidentHotspots.ts). */

export interface IncidentHotspot {
  lat: number;
  lon: number;
  /** FIRMS code: N = Suomi NPP, N20 = NOAA-20, N21 = NOAA-21. */
  satellite: string;
  /** ISO UTC. */
  acquired_at: string;
  confidence: string | null;
  frp: number | null;
}

interface OoptRef {
  id: number;
  name: string;
  osm_url: string;
  protect_class: string | null;
  boundary: string | null;
}

export type OoptRelation =
  | ({ relation: 'inside' } & OoptRef)
  | ({ relation: 'near'; distance_km: number } & OoptRef)
  | { relation: 'none'; radius_km: number };

export interface OoptProximity {
  result: OoptRelation;
  data_date: string;
  note: string;
  source: string;
  point: 'center';
}

export interface IncidentHotspotsResponse {
  success: true;
  incident_id: number;
  count: number;
  truncated: boolean;
  limit: number;
  buffer_m: number;
  window: { from: string; to: string };
  source: string;
  license: string;
  hotspots: IncidentHotspot[];
  oopt: OoptProximity | null;
  oopt_error?: string;
}

export const incidentHotspotsUrl = (id: number) => `/api/monitoring/forest-changes/${id}/hotspots`;

export async function getIncidentHotspots(id: number, signal?: AbortSignal): Promise<IncidentHotspotsResponse> {
  const response = await fetch(incidentHotspotsUrl(id), { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error || 'Не удалось загрузить термоточки');
  return body as IncidentHotspotsResponse;
}
