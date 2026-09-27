/**
 * API protection (spec 2026-09-27-security-hardening, future.md §13): per-IP rate limits on /api/*,
 * a size limit on JSON request bodies and JSON answers for rejected bodies.
 *
 * Only /api/* is limited. /health (Docker healthcheck, CI smoke test), /tiles/*, /imagery/* PNGs,
 * /assets/* and /data/* are not: Beget CDN pulls them from a handful of addresses, and the
 * renderers behind them have their own concurrency limit.
 */
import express, { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';

/** Exactly one proxy (Traefik) sits in front of the app: req.ip = the address Traefik saw. */
export const TRUST_PROXY_HOPS = 1;

export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Requests per minute per IP across all of /api/*. */
export const API_RATE_LIMIT = 300;
/** Requests per minute per IP for expensive endpoints (counted in API_RATE_LIMIT too). */
export const EXPENSIVE_RATE_LIMIT = 20;

/**
 * Expensive endpoints: exports read the database live, incident imagery searches STAC and reads
 * Sentinel-2 COGs. Not here: /api/regions* (served from the cache) and /ndvi-series — the incident
 * card polls it every 5 s while a series is computed (12 requests/min per open card), the answer
 * is cheap job state, and the work behind it is bounded by its own queue (ndviSeries.ts).
 */
export const EXPENSIVE_API_PATHS: (string | RegExp)[] = [
  '/api/export',
  // case-insensitive like Express routing, so /IMAGERY cannot skip the limit
  /^\/api\/monitoring\/forest-changes\/[^/]+\/imagery\/?$/i,
];

export const RATE_LIMIT_MESSAGE = 'Слишком много запросов, попробуйте через минуту';

/** Largest JSON request body accepted; the API has no endpoint that needs more. */
export const JSON_BODY_LIMIT = '100kb';

export interface ApiProtectionOptions {
  windowMs?: number;
  apiLimit?: number;
  expensiveLimit?: number;
}

function limiter(limit: number, windowMs: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    // RateLimit-* headers (draft-6) and Retry-After on 429; no legacy X-RateLimit-*
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ success: false, error: RATE_LIMIT_MESSAGE });
    },
  });
}

/**
 * Sets `trust proxy` and mounts the /api rate limiters. Call before the routes (and before body
 * parsing, so a flood is rejected without reading bodies).
 */
export function applyApiProtection(app: Application, options: ApiProtectionOptions = {}): void {
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  app.set('trust proxy', TRUST_PROXY_HOPS);
  app.use('/api', limiter(options.apiLimit ?? API_RATE_LIMIT, windowMs));
  app.use(EXPENSIVE_API_PATHS, limiter(options.expensiveLimit ?? EXPENSIVE_RATE_LIMIT, windowMs));
}

export function jsonBodyParser(): RequestHandler {
  return express.json({ limit: JSON_BODY_LIMIT });
}

/**
 * Error handler for body-parser rejections: an oversized body → 413, malformed JSON → 400, both as
 * JSON like the rest of the API. Other errors go on to Express' default handler.
 */
export function bodyErrorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: `Слишком большой запрос (не больше ${JSON_BODY_LIMIT})` });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, error: 'Некорректный JSON в запросе' });
    return;
  }
  next(err);
}
