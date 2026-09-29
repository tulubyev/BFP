import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { firmsService } from '../services/firmsService';
import { gfwService } from '../services/globalForestWatch';
import { createForestChangesHandler } from '../services/incidentsService';
import { incidentsCache } from '../utils/incidentsCache';
import { buildForestChangesGeojsonQuery, toGeojsonFeature } from '../services/forestChangesGeojson';
import { createIncidentImageryHandler, createNdviSeriesHandler } from './imagery';
import { createIncidentImageryDeps, createNdviSeriesDeps } from '../services/imagery';
import { parseYear } from '../utils/queryParams';
import { HOTSPOT_RETENTION_DAYS } from '../services/hotspotRetention';
import { createIncidentHotspotsHandler } from './incidentHotspots';
import { createIncidentHotspotsDeps } from '../services/incidentHotspotsDeps';

const router = Router();

router.get('/forest-changes', createForestChangesHandler(pool, incidentsCache));

// Sentinel-2 before/after scenes for one incident (cached 24 h per last_seen)
router.get('/forest-changes/:id/imagery', createIncidentImageryHandler(createIncidentImageryDeps(pool)));
// Summer NDVI by year, computed in the background: `pending` + progress until ready
router.get('/forest-changes/:id/ndvi-series', createNdviSeriesHandler(createNdviSeriesDeps(pool)));
// FIRMS hotspots of one FIRMS incident (≤ 500) and its OOPT relation (cached 10 min per last_seen)
router.get('/forest-changes/:id/hotspots', createIncidentHotspotsHandler(createIncidentHotspotsDeps(pool)));

// Map layer «Инциденты»: the feed's filters (change_type, region, start_date, end_date,
// static_sources — static heat sources hidden by default), newest first, at most GEOJSON_LIMIT rows
router.get('/forest-changes/geojson', async (req: Request, res: Response) => {
  try {
    const { sql, params } = buildForestChangesGeojsonQuery(req.query);
    const result = await pool.query(sql, params);
    res.json({ type: 'FeatureCollection', features: result.rows.map(toGeojsonFeature) });
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
    // The history keeps the last HOTSPOT_RETENTION_DAYS days (hotspotRetention.ts): daily counts
    const result = await pool.query(`
      SELECT
        to_char(acquisition_date, 'YYYY-MM-DD') AS date,
        COUNT(*)::int AS count,
        AVG(frp)::float8 AS avg_frp
      FROM gis.fire_hotspots
      GROUP BY acquisition_date
      ORDER BY acquisition_date
    `);
    res.json({ success: true, retention_days: HOTSPOT_RETENTION_DAYS, data: result.rows });
  } catch (error) {
    console.error('Error fetching fire stats:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

export default router;
