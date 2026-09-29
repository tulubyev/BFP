/**
 * /api/sources/status carries the latest data-quality gate results per source (`quality`).
 */
jest.mock('../../backend/config/database', () => ({ __esModule: true, default: {} }));
jest.mock('../../backend/services/sourceStatus', () => ({
  getAllSourcesStatus: jest.fn(async () => [{ id: 'oopt', state: 'fresh' }, { id: 'gfw_loss', state: 'unknown' }]),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import sourcesRoutes from '../../backend/routes/sources';
import { reportQuality } from '../../backend/services/quality/log';
import { failed } from '../../backend/services/quality/result';

it('adds the quality checks of each source to the status', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  reportQuality(failed('gfw_loss', 'tile', '4/1/1: content type "text/html" instead of image/png', 1, 1));
  const app = express();
  app.use('/api/sources', sourcesRoutes);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sources/status`);
    const body = await res.json();
    const bySource = Object.fromEntries(body.sources.map((s: any) => [s.id, s]));
    expect(bySource.oopt.quality).toEqual([]);
    expect(bySource.gfw_loss.quality).toEqual([expect.objectContaining({
      check: 'tile', checks: 1, rejections: 1,
      last: expect.objectContaining({ ok: false, reason: expect.stringMatching(/text\/html/) }),
    })]);
  } finally {
    server.close();
    jest.restoreAllMocks();
  }
});
