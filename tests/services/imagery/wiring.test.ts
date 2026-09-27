import { createInFlight, createPngRenderer } from '../../../backend/services/imagery';
import type { ImageRequest } from '../../../backend/services/imagery/request';
import { createLimiter } from '../../../backend/utils/limiter';
import { scene } from './helpers';

const request: ImageRequest = {
  sceneId: 'S2A_T48UUE_20240714T043045_L2A', render: 'swir', bbox: [103.05, 53.6, 103.09, 53.63],
  bboxParam: '103.05000,53.60000,103.09000,53.63000',
};
const KEY = 'imagery:s2:png:v1:S2A_T48UUE_20240714T043045_L2A:swir:103.05000,53.60000,103.09000,53.63000';

const memoryStore = () => {
  const map = new Map<string, Buffer>();
  return { map, get: async (k: string) => map.get(k) ?? null, set: async (k: string, v: Buffer) => { map.set(k, v); } };
};

describe('createInFlight', () => {
  it('shares one run between concurrent callers of the same key', async () => {
    const inFlight = createInFlight<number>();
    const fn = jest.fn(async () => 1);
    const [a, b] = await Promise.all([inFlight('k', fn), inFlight('k', fn)]);
    expect([a, b]).toEqual([1, 1]);
    expect(fn).toHaveBeenCalledTimes(1);
    await inFlight('k', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('createPngRenderer', () => {
  it('renders once, stores the PNG and serves later calls from the store', async () => {
    const store = memoryStore();
    const render = jest.fn(async () => Buffer.from('png'));
    const renderPng = createPngRenderer(store, render, createLimiter(2));
    await Promise.all([renderPng(scene(), request), renderPng(scene(), request)]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(store.map.get(KEY)?.toString()).toBe('png');
    expect((await renderPng(scene(), request)).toString()).toBe('png');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does not store a failed render', async () => {
    const store = memoryStore();
    const renderPng = createPngRenderer(store, async () => { throw new Error('COG 500'); }, createLimiter(2));
    await expect(renderPng(scene(), request)).rejects.toThrow('COG 500');
    expect(store.map.size).toBe(0);
  });

  it('gives up on a hung render and aborts it, freeing the slot', async () => {
    const limiter = createLimiter(1);
    let aborted = false;
    const renderPng = createPngRenderer(memoryStore(), (_s, _r, signal) => new Promise(() => {
      signal.addEventListener('abort', () => { aborted = true; });
    }), limiter, 30);
    await expect(renderPng(scene(), request)).rejects.toThrow('timed out');
    expect(aborted).toBe(true);
    expect(limiter.active).toBe(0);
  });
});
