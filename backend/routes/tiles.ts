/**
 * Tile proxy: /tiles/gfw/:layer/:z/:x/:y.png (layers: loss, dist, cover — see gfwTileLayers.ts).
 */
import { Router, Request, Response } from 'express';
import { GFW_TILE_LAYERS, parseTileRequest } from '../services/gfwTileLayers';
import { TRANSPARENT_PNG, renderGfwTile } from '../services/gfwTiles';
import { GFW_TILE_SOURCE, recordSourceAccess } from '../services/sourceAccess';
import { QualityError } from '../services/quality/result';

const router = Router();

router.get('/gfw/:layer/:z/:x/:y.png', async (req: Request, res: Response) => {
  const { layer, z, x, y } = req.params;
  const tile = parseTileRequest(layer, z, x, y);
  if (!tile) {
    res.status(404).end();
    return;
  }
  res.type('image/png');
  try {
    const png = await renderGfwTile(tile);
    res.set('Cache-Control', `public, max-age=${GFW_TILE_LAYERS[tile.layer].cacheSeconds}`).send(png);
  } catch (err: any) {
    console.warn(`GFW tile ${layer}/${z}/${x}/${y} failed:`, err.message);
    // Only upstream fetches get here (a Redis hit never throws): GFW did not give us a usable tile
    void recordSourceAccess(GFW_TILE_SOURCE[tile.layer], 'failed', err);
    // GFW answered 200 with something that is not a tile (HTML page, empty body): never cache it
    if (err instanceof QualityError) {
      res.status(502).set('Cache-Control', 'no-store').end();
      return;
    }
    // Short cache so a GFW hiccup does not stick in browsers or the CDN
    res.set('Cache-Control', 'public, max-age=300').send(TRANSPARENT_PNG);
  }
});

export default router;
