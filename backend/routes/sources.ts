/**
 * GET /api/sources/status — registry + load journal + computed freshness for every data source.
 */
import { Router, Request, Response } from 'express';
import { getAllSourcesStatus } from '../services/sourceStatus';

const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const sources = await getAllSourcesStatus();
    res.json({ success: true, generatedAt: new Date().toISOString(), sources });
  } catch (err: any) {
    console.error('Sources status error:', err.message);
    res.status(500).json({ success: false, error: 'Не удалось получить статус источников данных', detail: err.message });
  }
});

export default router;
