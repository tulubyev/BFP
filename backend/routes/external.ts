/**
 * External Data Sources Route
 * Aggregates data from Рослесхоз, GFW, and other open sources.
 */
import { Router, Request, Response } from 'express';
import {
  getWoodVolume,
  getReforestationArea,
  getForestlandArea,
  getForestFiresSummary,
  getForestFund,
  getAggregatedSummary,
  getWoodChecks,
  getSanitationActivities,
} from '../services/rosleskhozService';
import { getOOPT, ooptToGeoJSON } from '../services/overpassService';
import { SOURCE_REGISTRY } from '../services/sourceRegistry';

const router = Router();

// ─── Рослесхоз Open Data ────────────────────────────────────────────────────

/** GET /api/external/rosleshoz/summary — aggregated key metrics */
router.get('/rosleshoz/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await getAggregatedSummary();
    res.json({ success: true, data: summary });
  } catch (error: any) {
    console.error('Rosleshoz summary error:', error.message);
    res.status(502).json({ success: false, error: 'Не удалось получить данные Рослесхоза', detail: error.message });
  }
});

/** GET /api/external/rosleshoz/wood-volume — timber harvest by region (тыс. м³) */
router.get('/rosleshoz/wood-volume', async (_req: Request, res: Response) => {
  try {
    const data = await getWoodVolume();
    res.json({
      success: true,
      source: 'Рослесхоз',
      units: 'тыс. м³',
      count: data.length,
      data,
    });
  } catch (error: any) {
    console.error('Wood volume error:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});

/** GET /api/external/rosleshoz/reforestation — reforestation area by year */
router.get('/rosleshoz/reforestation', async (_req: Request, res: Response) => {
  try {
    const data = await getReforestationArea();
    res.json({
      success: true,
      source: 'Рослесхоз',
      units: 'тыс. га',
      count: data.length,
      data,
    });
  } catch (error: any) {
    console.error('Reforestation error:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});

/** GET /api/external/rosleshoz/forestland — forest land area by region */
router.get('/rosleshoz/forestland', async (_req: Request, res: Response) => {
  try {
    const data = await getForestlandArea();
    res.json({
      success: true,
      source: 'Рослесхоз',
      units: 'тыс. га',
      count: data.length,
      data,
    });
  } catch (error: any) {
    console.error('Forestland error:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});

/** GET /api/external/rosleshoz/fires — forest fires summary */
router.get('/rosleshoz/fires', async (_req: Request, res: Response) => {
  try {
    const data = await getForestFiresSummary();
    res.json({
      success: true,
      source: 'Рослесхоз',
      data,
    });
  } catch (error: any) {
    console.error('Fires error:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});

/** GET /api/external/rosleshoz/forest-fund — forest fund breakdown by region */
router.get('/rosleshoz/forest-fund', async (_req: Request, res: Response) => {
  try {
    const data = await getForestFund();
    res.json({
      success: true,
      source: 'Рослесхоз',
      units: 'тыс. га',
      count: data.length,
      data,
    });
  } catch (error: any) {
    console.error('Forest fund error:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});

/** GET /api/external/rosleshoz/wood-checks — timber use compliance checks */
router.get('/rosleshoz/wood-checks', async (_req: Request, res: Response) => {
  try {
    const data = await getWoodChecks();
    res.json({ success: true, source: 'Рослесхоз', count: data.length, data });
  } catch (error: any) {
    console.error('Wood checks error:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});

/** GET /api/external/rosleshoz/sanitation — sanitation activities (forest health) */
router.get('/rosleshoz/sanitation', async (_req: Request, res: Response) => {
  try {
    const data = await getSanitationActivities();
    res.json({ success: true, source: 'Рослесхоз', count: data.length, data });
  } catch (error: any) {
    console.error('Sanitation error:', error.message);
    res.status(502).json({ success: false, error: error.message });
  }
});

// ─── ООПТ (Protected Areas) from OpenStreetMap / Overpass ───────────────────

/**
 * GET /api/external/oopt — Russian protected areas (заповедники + нацпарки)
 * Source: OpenStreetMap via Overpass API © contributors, ODbL
 * Cached 12h server-side.
 */
router.get('/oopt', async (_req: Request, res: Response) => {
  try {
    const { features, source, fetchedAt } = await getOOPT();
    const geojson = ooptToGeoJSON(features);
    res.json({
      success: true,
      count: features.length,
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL (openstreetmap.org/copyright)',
      overpass_endpoint: source,
      fetched_at: fetchedAt,
      geojson,
    });
  } catch (err: any) {
    console.error('OOPT fetch error:', err.message);
    res.status(502).json({ success: false, error: 'Не удалось получить данные ООПТ из OSM', detail: err.message });
  }
});

/**
 * GET /api/external/sources — registry of all integrated data sources.
 * For load history and computed freshness, see GET /api/sources/status.
 */
router.get('/sources', (_req: Request, res: Response) => {
  res.json({ success: true, sources: SOURCE_REGISTRY });
});

export default router;
