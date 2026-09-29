import fixture from '../../fixtures/overpass/incident-context.json';
import {
  ATTEMPTS, HTTP_TIMEOUT_MS, OVERPASS_CONCURRENCY, OVERPASS_ENDPOINT, OVERPASS_MAX_QUEUE, RETRY_PAUSE_MS, USER_AGENT,
  createContextFetcher, overpassLimiter, type PostFn,
} from '../../../backend/services/incidentContext/overpass';
import { QueueFullError, TimeoutError, createLimiter } from '../../../backend/utils/limiter';
import { RESPONSE_LIMITS } from '../../../backend/utils/responseLimits';

const P = { lat: 52.3, lon: 104.2 };
const now = () => new Date('2026-09-29T10:00:00.000Z');
const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
const tick = () => new Promise(r => setImmediate(r));

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe('settings', () => {
  it('one Overpass request at a time, bounded queue, one retry', () => {
    expect(OVERPASS_CONCURRENCY).toBe(1);
    expect(OVERPASS_MAX_QUEUE).toBeGreaterThan(0);
    expect(overpassLimiter.active).toBe(0);
    expect(ATTEMPTS).toBe(2);
    expect(OVERPASS_ENDPOINT).toBe('https://overpass-api.de/api/interpreter');
    expect(HTTP_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(RESPONSE_LIMITS.overpassContext).toBeGreaterThanOrEqual(16 * 1024 * 1024);
  });
});

describe('createContextFetcher', () => {
  it('posts the query form-encoded with our User-Agent and builds the context from the answer', async () => {
    const post = jest.fn<ReturnType<PostFn>, Parameters<PostFn>>().mockResolvedValue({ data: fixture });
    const fetchContext = createContextFetcher({ post, limiter: createLimiter(1), now });
    const ctx = await fetchContext(P);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, options] = post.mock.calls[0];
    expect(url).toBe(OVERPASS_ENDPOINT);
    const data = new URLSearchParams(body).get('data')!;
    expect(data).toContain('way(around:15000,52.30000,104.20000)');
    expect(options).toEqual({ headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT } });
    expect(ctx.nearest_road?.osm_id).toBe(1001);
    expect(ctx.nearest_settlement?.name).toBe('Ключи');
    expect(ctx.fetched_at).toBe('2026-09-29T10:00:00.000Z');
    expect(ctx.data_date).toBe('2026-09-28T21:14:03Z');
  });

  it('retries once after a pause on 504/429, then succeeds', async () => {
    const sleep = jest.fn(async () => undefined);
    const post = jest.fn().mockRejectedValueOnce(httpError(504)).mockResolvedValueOnce({ data: fixture });
    const ctx = await createContextFetcher({ post, sleep, limiter: createLimiter(1), now })(P);
    expect(post).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(RETRY_PAUSE_MS);
    expect(ctx.nearest_track?.osm_id).toBe(1004);

    const post429 = jest.fn().mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce({ data: fixture });
    await createContextFetcher({ post: post429, sleep, limiter: createLimiter(1), now })(P);
    expect(post429).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempts and rejects with the last error', async () => {
    const post = jest.fn().mockRejectedValue(httpError(504));
    await expect(createContextFetcher({ post, sleep: async () => undefined, limiter: createLimiter(1) })(P)).rejects.toThrow(/504/);
    expect(post).toHaveBeenCalledTimes(ATTEMPTS);
  });

  it('does not retry a request error (400) or a broken answer', async () => {
    const sleep = jest.fn(async () => undefined);
    const bad = jest.fn().mockRejectedValue(httpError(400));
    await expect(createContextFetcher({ post: bad, sleep, limiter: createLimiter(1) })(P)).rejects.toThrow(/400/);
    expect(bad).toHaveBeenCalledTimes(1);
    const html = jest.fn().mockResolvedValue({ data: '<html>busy</html>' });
    await expect(createContextFetcher({ post: html, sleep, limiter: createLimiter(1) })(P)).rejects.toThrow(/не JSON/);
    const remark = jest.fn().mockResolvedValue({ data: { elements: [], remark: 'runtime error: Query timed out' } });
    await expect(createContextFetcher({ post: remark, sleep, limiter: createLimiter(1) })(P)).rejects.toThrow(/timed out/);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('runs one Overpass request at a time; the next waits for the slot', async () => {
    const gates = [deferred<{ data: unknown }>(), deferred<{ data: unknown }>()];
    let calls = 0;
    const post = jest.fn(() => gates[calls++].promise);
    const fetchContext = createContextFetcher({ post, limiter: createLimiter(1), now });
    const first = fetchContext(P);
    const second = fetchContext({ lat: 52.4, lon: 104.3 });
    await tick();
    expect(post).toHaveBeenCalledTimes(1);
    gates[0].resolve({ data: fixture });
    await first;
    await tick();
    expect(post).toHaveBeenCalledTimes(2);
    gates[1].resolve({ data: { elements: [] } });
    expect((await second).nearest_road).toBeNull();
  });

  it('a full queue is refused at once; a long wait times out', async () => {
    const gate = deferred<{ data: unknown }>();
    const limiter = createLimiter(1, 1);
    const post = jest.fn(() => gate.promise);
    const fetchContext = createContextFetcher({ post, limiter, now });
    const running = fetchContext(P);
    const queued = fetchContext(P);
    await expect(fetchContext(P)).rejects.toBeInstanceOf(QueueFullError);

    const slow = createContextFetcher({ post: () => new Promise(() => undefined), limiter: createLimiter(1), totalTimeoutMs: 20 });
    await expect(slow(P)).rejects.toBeInstanceOf(TimeoutError);

    gate.resolve({ data: fixture });
    await expect(running).resolves.toBeDefined();
    await expect(queued).resolves.toBeDefined();
  });
});
