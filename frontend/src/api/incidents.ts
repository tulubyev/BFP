export type IncidentType = 'fire' | 'logging' | 'disease' | 'windfall' | 'regrowth' | 'other';

export interface Incident {
  id: number;
  forest_area_id: number | null;
  forest_area_name?: string | null;
  region?: string | null;
  change_type: IncidentType | string;
  severity?: string | null;
  detected_date: string;
  confirmed_date?: string | null;
  area_ha?: number | string | null;
  confidence?: number | string | null;
  source?: string | null;
  satellite?: string | null;
  scene_id?: string | null;
  center_lat?: number | string | null;
  center_lng?: number | string | null;
  metadata?: Record<string, unknown>;
}

export interface IncidentFilters {
  type?: string;
  region?: string;
  startDate?: string;
  endDate?: string;
  sort?: 'date_desc' | 'date_asc' | 'area_desc' | 'area_asc';
  page?: number;
  limit?: number;
}

export interface IncidentsResponse {
  success: boolean;
  count: number;
  total: number;
  limit: number;
  offset: number;
  regions: string[];
  data: Incident[];
  error?: string;
  /** 'live' = fresh from the database, 'cache' = last known-good result served while the DB is down. */
  mode?: 'live' | 'cache';
  /** ISO timestamp of when a 'cache' result was originally fetched. */
  fetched_at?: string;
}

/** Thrown by getIncidents() for a non-2xx response; `status` lets callers tell a 503 (DB down, no cache) apart from other errors. */
export class IncidentsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IncidentsApiError';
    this.status = status;
  }
}

export function buildIncidentQuery(filters: IncidentFilters = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type) params.set('change_type', filters.type);
  if (filters.region) params.set('region', filters.region);
  if (filters.startDate) params.set('start_date', filters.startDate);
  if (filters.endDate) params.set('end_date', filters.endDate);
  params.set('sort', filters.sort || 'date_desc');
  const limit = filters.limit || 12;
  params.set('limit', String(limit));
  params.set('offset', String(((filters.page || 1) - 1) * limit));
  return params;
}

export async function getIncidents(filters: IncidentFilters = {}): Promise<IncidentsResponse> {
  const params = buildIncidentQuery(filters);
  const response = await fetch(`/api/monitoring/forest-changes?${params}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new IncidentsApiError(body?.error || 'Не удалось загрузить события', response.status);
  }
  return body as IncidentsResponse;
}