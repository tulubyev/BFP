/** The GFW tile proxy and the STAC client report reachability to sourceAccess. */
jest.mock('../../backend/services/sourceAccess', () => {
  const actual = jest.requireActual('../../backend/services/sourceAccess');
  return { ...actual, recordSourceAccess: jest.fn(async () => undefined) };
});
jest.mock('../../backend/config/redis', () => ({ getRedis: jest.fn(() => null) }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

import axios from 'axios';
import express from 'express';
import type { AddressInfo } from 'net';
import tilesRouter from '../../backend/routes/tiles';
import { HttpStatusError, createStacClient } from '../../backend/services/imagery/stac';
import { TRANSPARENT_PNG, renderGfwTile } from '../../backend/services/gfwTiles';
import { recordSourceAccess } from '../../backend/services/sourceAccess';

const record = recordSourceAccess as jest.Mock;
const get = axios.get as jest.Mock;
const ID = 'S2A_T48UUE_20240714T043045_L2A';
const params = { bbox: [1, 2, 3, 4] as [number, number, number, number], datetime: 'a/b', sort: 'asc' as const, limit: 6, maxCloudCover: 80 };

beforeEach(() => {
  record.mockClear();
  get.mockReset();
});

describe('GFW tiles', () => {
  it('a tile fetched from GFW records a success for its layer source', async () => {
    get.mockResolvedValue({ status: 200, data: TRANSPARENT_PNG, headers: { 'content-type': 'image/png' } });
    await renderGfwTile({ layer: 'cover', z: 3, x: 1, y: 1 });
    expect(record).toHaveBeenCalledWith('gfw_cover', 'ok');
  });

  it('a 404 (no data there) still proves GFW answers', async () => {
    get.mockResolvedValue({ status: 404, data: Buffer.alloc(0) });
    await renderGfwTile({ layer: 'loss', z: 3, x: 1, y: 1 });
    expect(record).toHaveBeenCalledWith('gfw_loss', 'ok');
  });

  it('a failed fetch records no success', async () => {
    get.mockRejectedValue(new Error('timeout of 20000ms exceeded'));
    await expect(renderGfwTile({ layer: 'cover', z: 3, x: 1, y: 1 })).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it('the route records a failure and still serves a transparent tile', async () => {
    get.mockRejectedValue(new Error('HTTP 503'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = express();
    app.use('/tiles', tilesRouter);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/tiles/gfw/loss/3/1/1.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
      expect(record).toHaveBeenCalledWith('gfw_loss', 'failed', expect.any(Error));
    } finally {
      server.close();
      warn.mockRestore();
    }
  });

  it('an invalid tile request is not an access attempt', async () => {
    const app = express();
    app.use('/tiles', tilesRouter);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/tiles/gfw/nope/3/1/1.png`);
      expect(res.status).toBe(404);
      expect(record).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});

describe('Sentinel-2 catalogue (Earth Search)', () => {
  it('search: an answer with features is a success', async () => {
    await createStacClient(async () => ({ features: [] })).search(params);
    expect(record).toHaveBeenCalledWith('sentinel2', 'ok');
  });

  it('search: a network error is a failure', async () => {
    const err = new Error('fetch failed');
    await expect(createStacClient(async () => { throw err; }).search(params)).rejects.toThrow('fetch failed');
    expect(record).toHaveBeenCalledWith('sentinel2', 'failed', err);
    expect(record).not.toHaveBeenCalledWith('sentinel2', 'ok');
  });

  it('search: a malformed answer is a failure', async () => {
    await expect(createStacClient(async () => ({ type: 'error' })).search(params)).rejects.toThrow();
    expect(record).toHaveBeenCalledWith('sentinel2', 'failed', 'STAC search: no features array');
  });

  it('getItem: the item is a success, a 404 too (the catalogue answered)', async () => {
    await createStacClient(async () => ({ id: 'junk' })).getItem(ID);
    expect(record).toHaveBeenLastCalledWith('sentinel2', 'ok');
    await createStacClient(async url => { throw new HttpStatusError(404, url); }).getItem(ID);
    expect(record).toHaveBeenLastCalledWith('sentinel2', 'ok', undefined);
  });

  it('getItem: a catalogue outage is a failure even when the bucket copy saves the request', async () => {
    const client = createStacClient(async url => {
      if (url.includes('stac.test')) throw new HttpStatusError(502, url);
      return { id: 'junk' };
    }, 'https://stac.test/v1');
    await client.getItem(ID);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('sentinel2', 'failed', expect.any(HttpStatusError));
  });
});
