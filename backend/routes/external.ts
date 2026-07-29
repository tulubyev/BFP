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
  DATASETS,
} from '../services/rosleskhozService';

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

// ─── Data Sources Registry ───────────────────────────────────────────────────

/** GET /api/external/sources — list of all integrated data sources */
router.get('/sources', (_req: Request, res: Response) => {
  res.json({
    success: true,
    sources: [
      {
        id: 'rosleshoz',
        name: 'Рослесхоз — Открытые данные',
        url: 'https://rosleshoz.gov.ru/opendata/',
        license: 'Открытые данные РФ (CC0)',
        update_frequency: 'Ежегодно / ежеквартально',
        formats: ['CSV'],
        datasets: Object.keys(DATASETS).map(k => ({
          key: k,
          url: 'https://rosleshoz.gov.ru' + DATASETS[k as keyof typeof DATASETS],
        })),
        endpoints: [
          '/api/external/rosleshoz/summary',
          '/api/external/rosleshoz/wood-volume',
          '/api/external/rosleshoz/reforestation',
          '/api/external/rosleshoz/forestland',
          '/api/external/rosleshoz/fires',
          '/api/external/rosleshoz/forest-fund',
          '/api/external/rosleshoz/wood-checks',
          '/api/external/rosleshoz/sanitation',
        ],
      },
      {
        id: 'gfw_tiles',
        name: 'Global Forest Watch — Tile Layers',
        url: 'https://www.globalforestwatch.org/',
        license: 'CC BY 4.0',
        update_frequency: 'Ежегодно (потери), еженедельно (GLAD)',
        formats: ['PNG tiles (XYZ)'],
        layers: [
          {
            name: 'Потери леса (Hansen/UMD)',
            url: 'https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.9/tcd_30/{z}/{x}/{y}.png',
          },
          {
            name: 'GLAD Deforestation Alerts',
            url: 'https://tiles.globalforestwatch.org/umd_glad_landsat_alerts/v20230224/dynamic/{z}/{x}/{y}.png?implementation=default',
          },
        ],
      },
      {
        id: 'firms',
        name: 'NASA FIRMS — Fire Hotspots',
        url: 'https://firms.modaps.eosdis.nasa.gov/',
        license: 'Открытые данные NASA',
        update_frequency: 'Ежедневно / в реальном времени',
        formats: ['GeoJSON (через /api/monitoring/fire-hotspots/firms)'],
      },
      {
        id: 'fgis_lk',
        name: 'ФГИС ЛК — Федеральная лесная информационная система',
        url: 'https://pub.fgislk.gov.ru/',
        license: 'Данные Рослесхоза',
        update_frequency: 'Оперативно',
        formats: ['WMS'],
        wms_url: 'https://pub.fgislk.gov.ru/plk/geoservermaster/geoserver/ows',
        note: 'WMS слои доступны напрямую из браузера',
      },
      {
        id: 'openstreetmap',
        name: 'OpenStreetMap',
        url: 'https://www.openstreetmap.org/',
        license: 'ODbL',
        formats: ['XYZ tiles'],
      },
      {
        id: 'esri',
        name: 'ESRI ArcGIS Online',
        url: 'https://server.arcgisonline.com/',
        license: 'Esri Master License',
        formats: ['XYZ tiles, WMS'],
      },
    ],
  });
});

export default router;
