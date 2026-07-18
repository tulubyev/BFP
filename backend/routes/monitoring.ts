import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { SpectralIndexCalculator, spectralIndicesInfo } from '../services/spectralIndices';
import { firmsService, getFIRMSInfo } from '../services/firmsService';
import { gfwService, getGFWInfo } from '../services/globalForestWatch';

const router = Router();

router.get('/forest-areas', async (req: Request, res: Response) => {
  try {
    const { region, forest_type, protection_status, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM gis.forest_areas WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (region) {
      query += ` AND region = $${paramIndex++}`;
      params.push(region);
    }
    if (forest_type) {
      query += ` AND forest_type = $${paramIndex++}`;
      params.push(forest_type);
    }
    if (protection_status) {
      query += ` AND protection_status = $${paramIndex++}`;
      params.push(protection_status);
    }

    query += ` ORDER BY area_ha DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching forest areas:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/forest-areas/geojson', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, region, forest_type, area_ha, protection_status, center_lat, center_lng, geojson FROM gis.forest_areas'
    );

    const features = result.rows.map(row => ({
      type: 'Feature',
      id: row.id,
      geometry: row.geojson ? JSON.parse(row.geojson) : {
        type: 'Point',
        coordinates: [row.center_lng, row.center_lat]
      },
      properties: {
        id: row.id,
        name: row.name,
        region: row.region,
        forest_type: row.forest_type,
        area_ha: row.area_ha,
        protection_status: row.protection_status
      }
    }));

    res.json({
      type: 'FeatureCollection',
      features
    });
  } catch (error) {
    console.error('Error fetching forest areas GeoJSON:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/forest-changes', async (req: Request, res: Response) => {
  try {
    const { change_type, severity, start_date, end_date, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM gis.forest_changes WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (change_type) {
      query += ` AND change_type = $${paramIndex++}`;
      params.push(change_type);
    }
    if (severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }
    if (start_date) {
      query += ` AND detected_date >= $${paramIndex++}`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND detected_date <= $${paramIndex++}`;
      params.push(end_date);
    }

    query += ` ORDER BY detected_date DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching forest changes:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/forest-changes/geojson', async (req: Request, res: Response) => {
  try {
    const { change_type } = req.query;
    
    let query = `SELECT id, change_type, severity, detected_date, area_ha, 
                        confidence, source, satellite, center_lat, center_lng, geojson 
                 FROM gis.forest_changes`;
    const params: any[] = [];

    if (change_type) {
      query += ' WHERE change_type = $1';
      params.push(change_type);
    }

    query += ' ORDER BY detected_date DESC LIMIT 500';
    
    const result = await pool.query(query, params);

    const features = result.rows.map(row => ({
      type: 'Feature',
      id: row.id,
      geometry: row.geojson ? JSON.parse(row.geojson) : {
        type: 'Point',
        coordinates: [row.center_lng, row.center_lat]
      },
      properties: {
        id: row.id,
        change_type: row.change_type,
        severity: row.severity,
        detected_date: row.detected_date,
        area_ha: row.area_ha,
        confidence: row.confidence,
        source: row.source,
        satellite: row.satellite
      }
    }));

    res.json({
      type: 'FeatureCollection',
      features
    });
  } catch (error) {
    console.error('Error fetching forest changes GeoJSON:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/fire-hotspots', async (req: Request, res: Response) => {
  try {
    const { days = 7, source } = req.query;
    
    let query = `SELECT * FROM gis.fire_hotspots 
                 WHERE acquisition_date >= CURRENT_DATE - INTERVAL '${days} days'`;
    const params: any[] = [];

    if (source) {
      query += ' AND source = $1';
      params.push(source);
    }

    query += ' ORDER BY acquisition_date DESC, acquisition_time DESC LIMIT 1000';
    
    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching fire hotspots:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/fire-hotspots/geojson', async (req: Request, res: Response) => {
  try {
    const { days = 7 } = req.query;
    
    const result = await pool.query(
      `SELECT id, latitude, longitude, brightness, frp, acquisition_date, 
              acquisition_time, satellite, confidence, daynight 
       FROM gis.fire_hotspots 
       WHERE acquisition_date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY acquisition_date DESC`
    );

    const features = result.rows.map(row => ({
      type: 'Feature',
      id: row.id,
      geometry: {
        type: 'Point',
        coordinates: [row.longitude, row.latitude]
      },
      properties: {
        brightness: row.brightness,
        frp: row.frp,
        date: row.acquisition_date,
        time: row.acquisition_time,
        satellite: row.satellite,
        confidence: row.confidence,
        daynight: row.daynight
      }
    }));

    res.json({
      type: 'FeatureCollection',
      features
    });
  } catch (error) {
    console.error('Error fetching fire hotspots GeoJSON:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/fire-hotspots/firms', async (req: Request, res: Response) => {
  try {
    const { days = 7 } = req.query;
    const hotspots = await firmsService.getBaikalHotspots(Number(days));
    const geojson = firmsService.toGeoJSON(hotspots);
    
    res.json({
      success: true,
      count: hotspots.length,
      source: 'NASA FIRMS',
      geojson
    });
  } catch (error) {
    console.error('Error fetching FIRMS data:', error);
    res.status(500).json({ success: false, error: 'FIRMS API error' });
  }
});

router.get('/monitoring-zones', async (req: Request, res: Response) => {
  try {
    const { zone_type, priority, active = true } = req.query;
    
    let query = 'SELECT * FROM gis.monitoring_zones WHERE active = $1';
    const params: any[] = [active];
    let paramIndex = 2;

    if (zone_type) {
      query += ` AND zone_type = $${paramIndex++}`;
      params.push(zone_type);
    }
    if (priority) {
      query += ` AND priority = $${paramIndex++}`;
      params.push(priority);
    }

    query += ' ORDER BY priority DESC, name';
    
    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching monitoring zones:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const { status = 'new', severity, limit = 50 } = req.query;
    
    let query = 'SELECT * FROM gis.alerts WHERE status = $1';
    const params: any[] = [status];
    let paramIndex = 2;

    if (severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }

    query += ` ORDER BY detected_at DESC LIMIT $${paramIndex}`;
    params.push(limit);
    
    const result = await pool.query(query, params);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const forestAreas = await pool.query(
      'SELECT COUNT(*) as count, SUM(area_ha) as total_area FROM gis.forest_areas'
    );
    
    const changes = await pool.query(
      `SELECT change_type, COUNT(*) as count, SUM(area_ha) as total_area 
       FROM gis.forest_changes 
       WHERE detected_date >= CURRENT_DATE - INTERVAL '1 year'
       GROUP BY change_type`
    );
    
    const recentFires = await pool.query(
      `SELECT COUNT(*) as count 
       FROM gis.fire_hotspots 
       WHERE acquisition_date >= CURRENT_DATE - INTERVAL '7 days'`
    );
    
    const activeAlerts = await pool.query(
      `SELECT severity, COUNT(*) as count 
       FROM gis.alerts 
       WHERE status IN ('new', 'acknowledged')
       GROUP BY severity`
    );

    res.json({
      success: true,
      data: {
        forest_areas: forestAreas.rows[0],
        changes_by_type: changes.rows,
        recent_fires_7d: recentFires.rows[0]?.count || 0,
        active_alerts: activeAlerts.rows
      }
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/spectral-indices/info', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: spectralIndicesInfo
  });
});

router.post('/spectral-indices/calculate', (req: Request, res: Response) => {
  try {
    const { index, bands, satellite = 'sentinel2' } = req.body;
    
    if (!index || !bands) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing index type or band values' 
      });
    }

    const bandValues = satellite === 'landsat' 
      ? SpectralIndexCalculator.fromLandsat(bands)
      : SpectralIndexCalculator.fromSentinel2(bands);

    let result;
    switch (index.toUpperCase()) {
      case 'NDVI':
        result = SpectralIndexCalculator.ndvi(bandValues);
        break;
      case 'NBR':
        result = SpectralIndexCalculator.nbr(bandValues);
        break;
      case 'NDWI':
        result = SpectralIndexCalculator.ndwi(bandValues);
        break;
      case 'EVI':
        result = SpectralIndexCalculator.evi(bandValues);
        break;
      case 'SAVI':
        result = SpectralIndexCalculator.savi(bandValues);
        break;
      case 'NDMI':
        result = SpectralIndexCalculator.ndmi(bandValues);
        break;
      default:
        return res.status(400).json({ 
          success: false, 
          error: `Unknown index type: ${index}` 
        });
    }

    res.json({
      success: true,
      index,
      ...result
    });
  } catch (error) {
    console.error('Error calculating spectral index:', error);
    res.status(500).json({ success: false, error: 'Calculation error' });
  }
});

router.get('/external-services/info', (req: Request, res: Response) => {
  res.json({
    success: true,
    services: {
      firms: getFIRMSInfo(),
      gfw: getGFWInfo()
    }
  });
});

router.get('/gfw/tree-cover-loss', async (req: Request, res: Response) => {
  try {
    const { start_year = 2001, end_year = 2023, region = 'all' } = req.query;
    const result = await gfwService.getRegionalTreeCoverLoss(
      String(region),
      Number(start_year),
      Number(end_year)
    );
    res.json({
      success: true,
      data_source: result.data_source,
      data_type: result.data_type,
      region,
      data: result.data,
    });
  } catch (error) {
    console.error('Error fetching GFW data:', error);
    res.status(500).json({ success: false, error: 'GFW API error' });
  }
});

router.get('/gfw/regions', (_req: Request, res: Response) => {
  const { RUSSIAN_FOREST_REGIONS } = require('../services/globalForestWatch');
  res.json({
    success: true,
    data: RUSSIAN_FOREST_REGIONS.map((r: any) => ({
      code: r.code,
      name: r.name,
      forestArea_ha: r.forestArea_ha,
      gadmCode: r.gadmCode ?? null,
      adm1: r.adm1 ?? null,
    }))
  });
});

router.get('/fire-hotspots/stats', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        EXTRACT(YEAR FROM acquisition_date)::int AS year,
        EXTRACT(MONTH FROM acquisition_date)::int AS month,
        COUNT(*) AS count,
        AVG(brightness) AS avg_brightness,
        AVG(frp) AS avg_frp
      FROM gis.fire_hotspots
      GROUP BY year, month
      ORDER BY year, month
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching fire stats:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/gfw/statistics', async (req: Request, res: Response) => {
  try {
    const stats = await gfwService.getForestStatistics();
    
    res.json({
      success: true,
      source: 'Global Forest Watch',
      data: stats
    });
  } catch (error) {
    console.error('Error fetching GFW statistics:', error);
    res.status(500).json({ success: false, error: 'GFW API error' });
  }
});

router.get('/lookup/:table', async (req: Request, res: Response) => {
  const allowedTables = ['forest_types', 'change_types', 'satellites', 'spectral_index_types'];
  const { table } = req.params;
  
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ success: false, error: 'Invalid table name' });
  }

  try {
    const result = await pool.query(`SELECT * FROM gis.${table} ORDER BY id`);
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error(`Error fetching ${table}:`, error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

export default router;
