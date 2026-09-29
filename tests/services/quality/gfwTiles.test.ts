/**
 * The GFW tile gate in renderGfwTile() and the tile route: a non-PNG answer is never cached and
 * the route answers 502 (no-store) instead of a transparent tile.
 */
jest.mock('../../../backend/config/redis', () => ({ getRedis: jest.fn() }));
jest.mock('axios');

import axios from 'axios';
import express from 'express';
import type { AddressInfo } from 'net';
import { getRedis } from '../../../backend/config/redis';
import { renderGfwTile, TRANSPARENT_PNG } from '../../../backend/services/gfwTiles';
import { readQuality } from '../../../backend/services/quality/log';
import { QualityError } from '../../../backend/services/quality/result';
import tileRoutes from '../../../backend/routes/tiles';

const mockedAxios = axios as jest.Mocked<typeof axios>;

class FakeRedis {
  buffers = new Map<string, Buffer>();
  strings = new Map<string, string>();
  async getBuffer(key: string) { return this.buffers.get(key) ?? null; }
  async get(key: string) { return this.strings.get(key) ?? null; }
  async set(key: string, value: string | Buffer) {
    if (Buffer.isBuffer(value)) this.buffers.set(key, value);
    else this.strings.set(key, value);
    return 'OK';
  }
  async hset() { return 1; }
  async hgetall() { return {}; }
  async expire() { return 1; }
}

const HTML = Buffer.from('<!DOCTYPE html><html><body>Service Unavailable</body></html>');
const tileAnswer = (body: Buffer, contentType: string) => ({ status: 200, data: body, headers: { 'content-type': contentType } });

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  (getRedis as jest.Mock).mockReturnValue(redis);
  mockedAxios.get.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('renderGfwTile quality gate', () => {
  it('passes a PNG through (cover) and caches it', async () => {
    mockedAxios.get.mockResolvedValue(tileAnswer(TRANSPARENT_PNG, 'image/png'));
    await expect(renderGfwTile({ layer: 'cover', z: 3, x: 5, y: 2 })).resolves.toEqual(TRANSPARENT_PNG);
    expect(redis.buffers.has('tile:gfw:cover:3/5/2')).toBe(true);
  });

  it.each([
    ['an HTML page', HTML, 'text/html'],
    ['an empty body', Buffer.alloc(0), 'image/png'],
    ['HTML labelled image/png', HTML, 'image/png'],
  ])('refuses %s and caches nothing', async (_label, body, type) => {
    mockedAxios.get.mockResolvedValue(tileAnswer(body, type));
    await expect(renderGfwTile({ layer: 'loss', z: 4, x: 1, y: 1 })).rejects.toBeInstanceOf(QualityError);
    expect(redis.buffers.size).toBe(0);
    const [state] = await readQuality('gfw_loss');
    expect(state.last).toMatchObject({ check: 'tile', ok: false });
    expect(state.last.reason).toMatch(/^4\/1\/1: /);
  });

  it('refuses a PNG signature with a corrupt body (cannot be decoded for colouring)', async () => {
    const corrupt = Buffer.concat([TRANSPARENT_PNG.subarray(0, 40), Buffer.alloc(40, 7)]);
    mockedAxios.get.mockResolvedValue(tileAnswer(corrupt, 'image/png'));
    await expect(renderGfwTile({ layer: 'loss', z: 4, x: 2, y: 2 })).rejects.toThrow(/cannot be decoded/);
    expect(redis.buffers.size).toBe(0);
  });

  it('a 404 is still an empty (transparent) tile, not an error', async () => {
    mockedAxios.get.mockResolvedValue({ status: 404, data: Buffer.from('Not found'), headers: { 'content-type': 'text/plain' } });
    await expect(renderGfwTile({ layer: 'cover', z: 3, x: 1, y: 1 })).resolves.toEqual(TRANSPARENT_PNG);
  });

  it('refuses a DIST-ALERT version that is not a real vYYYYMMDD date', async () => {
    mockedAxios.get.mockResolvedValue({ status: 302, data: '', headers: { location: '/umd_glad_dist_alerts/v20261399/dynamic/0/0/0.png' } });
    await expect(renderGfwTile({ layer: 'dist', z: 3, x: 1, y: 1 })).rejects.toThrow(/gfw_dist\/dist-version: version v20261399 is not a real date/);
    const [state] = await readQuality('gfw_dist');
    expect(state).toMatchObject({ check: 'dist-version', last: { ok: false } });
  });
});

describe('GET /tiles/gfw/* with a bad upstream answer', () => {
  async function get(path: string) {
    const app = express();
    app.use('/tiles', tileRoutes);
    const server = app.listen(0);
    try {
      return await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/tiles${path}`);
    } finally {
      server.close();
    }
  }

  it('answers 502 with no-store for an HTML page instead of a tile', async () => {
    mockedAxios.get.mockResolvedValue(tileAnswer(HTML, 'text/html'));
    const res = await get('/gfw/cover/3/1/1.png');
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps the short-cached transparent tile for a network error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNRESET'));
    const res = await get('/gfw/cover/3/1/1.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });
});
