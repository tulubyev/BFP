import pool from '@/config/database';
import { ForestArea, ForestChange } from '@/models/forestArea';
import { Geometry } from 'geojson';
import format from 'pg-format';

export class DatabaseService {
  /**
   * Get forest areas within a bounding box
   */
  async getForestAreas(bbox: [number, number, number, number]): Promise<ForestArea[]> {
    const query = `
      SELECT id, name, area_ha, forest_type, 
             ST_AsGeoJSON(geom)::json as geom, 
             created_at
      FROM forest_areas
      WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
    `;
    
    const result = await pool.query(query, bbox);
    return result.rows;
  }

  /**
   * Get forest changes within a time period
   */
  async getForestChanges(
    startDate: string, 
    endDate: string, 
    forestAreaId?: number
  ): Promise<ForestChange[]> {
    let query = `
      SELECT id, forest_area_id, change_type, change_date, 
             area_ha, severity, notes,
             ST_AsGeoJSON(geom)::json as geom
      FROM forest_changes
      WHERE change_date BETWEEN $1 AND $2
    `;
    
    const params: any[] = [startDate, endDate];
    
    if (forestAreaId) {
      query += ' AND forest_area_id = $3';
      params.push(forestAreaId);
    }
    
    query += ' ORDER BY change_date DESC';
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get statistics for a forest area
   */
  async getForestStatistics(forestAreaId: number): Promise<any> {
    const query = `
      SELECT 
        COUNT(*) as total_changes,
        SUM(CASE WHEN change_type = 'fire' THEN 1 ELSE 0 END) as fire_count,
        SUM(CASE WHEN change_type = 'logging' THEN 1 ELSE 0 END) as logging_count,
        SUM(CASE WHEN change_type = 'disease' THEN 1 ELSE 0 END) as disease_count,
        SUM(CASE WHEN change_type = 'recovery' THEN 1 ELSE 0 END) as recovery_count,
        SUM(area_ha) as total_area_affected
      FROM forest_changes
      WHERE forest_area_id = $1
    `;
    
    const result = await pool.query(query, [forestAreaId]);
    return result.rows[0];
  }

  /**
   * Insert a new forest area
   */
  async insertForestArea(area: Omit<ForestArea, 'id' | 'created_at'>): Promise<ForestArea> {
    const query = `
      INSERT INTO forest_areas (name, area_ha, forest_type, geom)
      VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4))
      RETURNING id, name, area_ha, forest_type, 
                ST_AsGeoJSON(geom)::json as geom, 
                created_at
    `;
    
    const values = [
      area.name,
      area.area_ha,
      area.forest_type,
      JSON.stringify(area.geom)
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Insert a new forest change
   */
  async insertForestChange(change: Omit<ForestChange, 'id'>): Promise<ForestChange> {
    const query = `
      INSERT INTO forest_changes (
        forest_area_id, change_type, change_date, 
        area_ha, severity, notes, geom
      )
      VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromGeoJSON($7))
      RETURNING id, forest_area_id, change_type, change_date, 
                area_ha, severity, notes,
                ST_AsGeoJSON(geom)::json as geom
    `;
    
    const values = [
      change.forest_area_id,
      change.change_type,
      change.change_date,
      change.area_ha,
      change.severity,
      change.notes,
      JSON.stringify(change.geom)
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }
}

export default new DatabaseService();