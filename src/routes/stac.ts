import { Router, Request, Response } from 'express';
import stacService from '@/services/stacService';

const router = Router();

/**
 * POST /api/stac/search
 * Search for STAC items
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const params = req.body;
    const results = await stacService.search(params);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stac/collections
 * Get available collections
 */
router.get('/collections', async (req: Request, res: Response) => {
  try {
    const collections = await stacService.getCollections();
    res.json(collections);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stac/items/:collectionId/:itemId
 * Get a specific STAC item
 */
router.get('/items/:collectionId/:itemId', async (req: Request, res: Response) => {
  try {
    const { collectionId, itemId } = req.params;
    const item = await stacService.getItem(collectionId, itemId);
    res.json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stac/baikal/sentinel2
 * Search for Sentinel-2 scenes over Baikal region
 */
router.get('/baikal/sentinel2', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, maxCloudCover } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required parameters: startDate, endDate' });
    }

    const items = await stacService.searchSentinel2(
      startDate as string, 
      endDate as string, 
      parseInt(maxCloudCover as string) || 20
    );
    
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stac/baikal/landsat
 * Search for Landsat scenes over Baikal region
 */
router.get('/baikal/landsat', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, maxCloudCover } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required parameters: startDate, endDate' });
    }

    const items = await stacService.searchLandsat(
      startDate as string, 
      endDate as string, 
      parseInt(maxCloudCover as string) || 20
    );
    
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;