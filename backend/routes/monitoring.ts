import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { firmsService } from '../services/firmsService';
import { gfwService } from '../services/globalForestWatch';
import { createForestChangesHandler } from '../services/incidentsService';
import { incidentsCache } from '../utils/incidentsCache';
import { notStaticSourceSql } from '../services/forestChangesQuery';
import { createIncidentImageryHandler, createNdviSeriesHandler } from './imagery';
import { createIncidentImageryDeps, createNdviSeriesDeps } from '../services/imagery';
import { parseYear } from '../utils/queryParams';

const router = Router();

router.get('/forest-changes', createForestChangesHandler(pool, incidentsCache));

// Sentinel-2 before/after scenes for one incident (cached 24 h per last_seen)
router.get('/forest-changes/:id/imagery', createIncidentImageryHandler(createIncidentImageryDeps(pool)));
// Summer NDVI by year, computed in the background: `pending` + progress until ready
router.get('/forest-changes/:id/ndvi-series', createNdviSeriesHandler(createNdviSeriesDeps(pool)));

router.get('/forest-changes/geojson', async (req: Request, res: Response) => {
  try {
    const { change_type } = req.query;
    
    let query = `SELECT id, change_type, severity, detected_date, area_ha, 
                        confidence, source, satellite, center_lat, center_lng, geojson 
                 FROM gis.forest_changes`;
    const params: any[] = [];

    // Static heat sources (gas flares) are not forest events; hidden as in /forest-changes.
    query += ` WHERE ${notStaticSourceSql('forest_changes')}`;
    if (change_type) {
      query += ' AND change_type = $1';
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

router.get('/fire-hotspots/firms', async (req: Request, res: Response) => {
  try {
    // bbox param: "west,south,east,north" — defaults to all of Russia
    const { bbox } = req.query;
    let area: { west: number; south: number; east: number; north: number } | undefined;
    if (bbox && typeof bbox === 'string') {
      const parts = bbox.split(',').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        area = { west: parts[0], south: parts[1], east: parts[2], north: parts[3] };
      }
    }
    // Fetch from public NRT CSV (covers all of Russia by default)
    const hotspots = await firmsService.getHotspotsFromPublicCSV(area);
    const geojson = firmsService.toGeoJSON(hotspots);

    res.json({
      success: true,
      count: hotspots.length,
      source: 'NASA FIRMS VIIRS NRT (public CSV, no API key required)',
      license: 'NASA Open Data',
      geojson,
    });
  } catch (error) {
    console.error('Error fetching FIRMS data:', error);
    res.status(502).json({ success: false, error: 'NASA FIRMS CSV unavailable' });
  }
});

router.get('/gfw/tree-cover-loss', async (req: Request, res: Response) => {
  try {
    const { region = 'all' } = req.query;
    const result = await gfwService.getRegionalTreeCoverLoss(
      String(region),
      parseYear(req.query.start_year, 2001),
      parseYear(req.query.end_year, 2023)
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

export default router;
