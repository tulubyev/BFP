/**
 * Regional analytics API (spec 2026-09-26, part B).
 *   GET /api/regions       — the 83 regions with their indicators (Baikal regions first)
 *   GET /api/regions/:iso  — one region with the annual hotspot series and region-card indicators
 */
import { Router, Request, Response } from 'express';
import type { RegionsService } from '../services/regions/service';

export function createRegionsRouter(service: Pick<RegionsService, 'checkIso' | 'list' | 'detail'>): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      res.json(await service.list());
    } catch (err: any) {
      console.error('GET /api/regions failed:', err.message ?? err);
      res.status(503).json({ error: 'Региональные данные временно недоступны' });
    }
  });

  router.get('/:iso', async (req: Request, res: Response) => {
    let check;
    try {
      check = service.checkIso(req.params.iso);
    } catch (err: any) {
      console.error('GET /api/regions/:iso failed:', err.message ?? err);
      return res.status(503).json({ error: 'Региональные данные временно недоступны' });
    }
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    try {
      const region = await service.detail(check.iso);
      if (!region) return res.status(404).json({ error: `Субъект ${check.iso} не найден` });
      res.json(region);
    } catch (err: any) {
      console.error(`GET /api/regions/${check.iso} failed:`, err.message ?? err);
      res.status(503).json({ error: 'Региональные данные временно недоступны' });
    }
  });

  return router;
}
