import { Router, Request, Response } from 'express';
import titilerService from '@/services/titilerService';

const router = Router();

/**
 * GET /api/titiler/info
 * Get information about a COG file
 */
router.get('/info', async (req: Request, res: Response) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid URL parameter' });
    }

    const info = await titilerService.getInfo(url);
    res.json(info);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/titiler/tile-url
 * Get tile URL for a COG file with optional processing
 */
router.get('/tile-url', (req: Request, res: Response) => {
  try {
    const { url, expression, colormap, rescale } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid URL parameter' });
    }

    const tileUrl = titilerService.getTileUrl({
      url,
      expression: expression as string,
      colormap: colormap as string,
      rescale: rescale as string
    });

    res.json({ tileUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/titiler/statistics
 * Get statistics for a COG file
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const { url, expression } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid URL parameter' });
    }

    const stats = await titilerService.getStatistics(url, expression as string);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/titiler/preview
 * Get a preview image of a COG file
 */
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const { url, width } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid URL parameter' });
    }

    const buffer = await titilerService.getPreview(url, parseInt(width as string) || 512);
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;