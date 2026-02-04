import { Geometry } from 'geojson';

export interface ForestArea {
  id: number;
  name: string;
  area_ha: number;
  forest_type: string;
  geom: Geometry;
  created_at: Date;
}

export interface ForestChange {
  id: number;
  forest_area_id: number;
  change_type: 'fire' | 'logging' | 'disease' | 'recovery';
  change_date: Date;
  area_ha: number;
  severity: number; // 1-5 scale
  notes: string;
  geom: Geometry;
}