/**
 * GET /api/sources/status — registry + load journal + computed freshness for every data source,
 * plus the latest data-quality check results (`quality`, see services/quality/log.ts).
 */
import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { getAllSourcesStatus } from '../services/sourceStatus';
import { readQuality } from '../services/quality/log';

const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const statuses = await getAllSourcesStatus(new Date(), pool);
    // Latest data-quality gate results per source (services/quality/): dropped items, rejections
    const sources = await Promise.all(statuses.map(async s => ({ ...s, quality: await readQuality(s.id) })));
    res.json({ success: true, generatedAt: new Date().toISOString(), sources });
  } catch (err: any) {
    console.error('Sources status error:', err.message);
    res.status(500).json({ success: false, error: 'Не удалось получить статус источников данных', detail: err.message });
  }
});

export default router;
