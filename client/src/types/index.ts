export interface HealthResponse {
  status: string;
  timestamp: string;
}

export interface Geometry {
  type: string;
  coordinates: unknown;
}

export interface ForestArea {
  id: number;
  name: string;
  area_ha: number;
  forest_type: string;
  geom: Geometry;
  created_at: string;
}

export interface ForestChange {
  id: number;
  forest_area_id: number;
  change_type: 'fire' | 'logging' | 'disease' | 'recovery';
  change_date: string;
  area_ha: number;
  severity: number;
  notes?: string;
  geom: Geometry;
}

export interface ForestStatistics {
  total_changes: number;
  fire_count: number;
  logging_count: number;
  disease_count: number;
  recovery_count: number;
  total_area_affected: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface MapConfig {
  center: [number, number];
  zoom: number;
  bounds?: [[number, number], [number, number]];
}

export interface LayerConfig {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  type: 'raster' | 'vector' | 'tile';
}
