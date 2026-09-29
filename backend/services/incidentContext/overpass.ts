/**
 * Overpass request for the incident context: one query per point (context.ts builds it), at most
 * one request to Overpass at a time for the whole process (OVERPASS_CONCURRENCY), so opening many
 * incident cards cannot hammer overpass-api.de. Same endpoint and User-Agent as overpassService.ts
 * (which is left alone); Overpass often answers 429/504 under load, so one retry after a pause.
 */
import axios from 'axios';
import { RESPONSE_LIMITS } from '../../utils/responseLimits';
import { createLimiter, withTimeout, type Limiter } from '../../utils/limiter';
import { buildContext, buildContextQuery, parseContextAnswer, RADIUS_KM, type IncidentContext } from './context';
import type { LatLon } from './geo';

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const USER_AGENT = 'forestwatch.ru/1.0 (+https://forestwatch.ru)';
/** Overpass-side `[timeout:]` and our HTTP timeout (a little longer, the server replies late). */
export const SERVER_TIMEOUT_SEC = 60;
export const HTTP_TIMEOUT_MS = 75_000;
export const OVERPASS_CONCURRENCY = 1;
/** Requests waiting for the Overpass slot; beyond that the card gets «нет данных» at once. */
export const OVERPASS_MAX_QUEUE = 20;
export const ATTEMPTS = 2;
export const RETRY_PAUSE_MS = 5_000;
/** Whole wait for one answer (queue + attempts): the card should not spin for minutes. */
export const TOTAL_TIMEOUT_MS = 180_000;

/** Status codes worth a retry: rate limited or gateway timeout (the server is busy). */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export type PostFn = (url: string, body: string, options: Record<string, unknown>) => Promise<{ data: unknown }>;

export interface ContextFetcherOptions {
  post?: PostFn;
  limiter?: Limiter;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  attempts?: number;
  totalTimeoutMs?: number;
}

const defaultPost: PostFn = (url, body, options) => axios.post(url, body, {
  ...options,
  timeout: HTTP_TIMEOUT_MS,
  maxContentLength: RESPONSE_LIMITS.overpassContext,
});

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const overpassLimiter = createLimiter(OVERPASS_CONCURRENCY, OVERPASS_MAX_QUEUE);

function isRetryable(err: any): boolean {
  const status = err?.response?.status;
  if (typeof status === 'number') return RETRY_STATUSES.has(status);
  // no response: connection reset or our timeout
  return err?.code === 'ECONNABORTED' || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT';
}

/**
 * Returns `(point) => IncidentContext`: queries Overpass through the shared limiter and parses the
 * answer. Rejects on any failure (HTTP error, broken answer, full queue, total timeout) — the caller
 * must not cache a failure.
 */
export function createContextFetcher(opts: ContextFetcherOptions = {}) {
  const post = opts.post ?? defaultPost;
  const limiter = opts.limiter ?? overpassLimiter;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => new Date());
  const attempts = opts.attempts ?? ATTEMPTS;
  const totalTimeoutMs = opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;

  async function request(point: LatLon): Promise<IncidentContext> {
    const body = new URLSearchParams({ data: buildContextQuery(point, RADIUS_KM, SERVER_TIMEOUT_SEC) }).toString();
    let lastErr: unknown = new Error('no attempts made');
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await post(OVERPASS_ENDPOINT, body, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        });
        return buildContext(point, parseContextAnswer(res.data), now().toISOString());
      } catch (err) {
        lastErr = err;
        console.warn(`incident context: Overpass attempt ${attempt}/${attempts} failed:`, String((err as Error)?.message).slice(0, 120));
        if (attempt < attempts && isRetryable(err)) await sleep(RETRY_PAUSE_MS);
        else break;
      }
    }
    throw lastErr;
  }

  return (point: LatLon): Promise<IncidentContext> =>
    withTimeout(limiter.run(() => request(point)), totalTimeoutMs, 'Overpass context');
}
