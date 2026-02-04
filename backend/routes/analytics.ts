import { Router, Request, Response } from 'express';
import databaseService from '../services/databaseService';
import { ForestArea, ForestChange } from '../models/forestArea';

const router = Router();

router.get('/forest-areas', async (req: Request, res: Response) => {
  try {
    const { bbox } = req.query;
    if (!bbox || typeof bbox !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid bbox parameter' });
    }

    const bboxArray = bbox.split(',').map(Number) as [number, number, number, number];
    if (bboxArray.length !== 4 || bboxArray.some(isNaN)) {
      return res.status(400).json({ error: 'Invalid bbox format. Expected: minX,minY,maxX,maxY' });
    }

    const areas = await databaseService.getForestAreas(bboxArray);
    res.json(areas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/forest-changes', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, forestAreaId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required parameters: startDate, endDate' });
    }

    const changes = await databaseService.getForestChanges(
      startDate as string,
      endDate as string,
      forestAreaId ? parseInt(forestAreaId as string) : undefined
    );
    res.json(changes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/statistics/:forestAreaId', async (req: Request, res: Response) => {
  try {
    const forestAreaId = parseInt(req.params.forestAreaId);
    if (isNaN(forestAreaId)) {
      return res.status(400).json({ error: 'Invalid forestAreaId' });
    }

    const stats = await databaseService.getForestStatistics(forestAreaId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
