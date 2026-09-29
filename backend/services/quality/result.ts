/**
 * Common result of a data-quality gate (future.md §5 «Контроль качества»): what a check looked at,
 * how many items it dropped, and — when the whole input was refused — why. A refused input is
 * thrown as a QualityError so cached()/warm() keep the last good value; the result itself goes to
 * the quality log (log.ts), the load journal and /api/sources/status.
 */

export interface QualityResult {
  /** Source id from sourceRegistry.ts (e.g. 'rosleshoz', 'oopt', 'gfw_loss'). */
  source: string;
  /** What was checked, stable per input kind (e.g. 'woodVolume', 'overpass', 'tile'). */
  check: string;
  /** false = the whole input was rejected and must not replace cached data. */
  ok: boolean;
  /** Items (rows, objects, tiles) looked at. */
  total: number;
  /** Items dropped as invalid; the rest was kept. */
  rejected: number;
  /** Why the input was rejected (ok = false) or a short note about dropped items. */
  reason?: string;
  checkedAt: string;
}

export class QualityError extends Error {
  constructor(public readonly result: QualityResult) {
    super(`${result.source}/${result.check}: ${result.reason ?? 'rejected by quality check'}`);
    this.name = 'QualityError';
  }
}

export function passed(source: string, check: string, total: number, rejected = 0, reason?: string): QualityResult {
  return { source, check, ok: true, total, rejected, ...(reason ? { reason } : {}), checkedAt: new Date().toISOString() };
}

export function failed(source: string, check: string, reason: string, total = 0, rejected = 0): QualityResult {
  return { source, check, ok: false, total, rejected, reason: reason.slice(0, 300), checkedAt: new Date().toISOString() };
}

/** Short excerpt of an unexpected body for a rejection reason (HTML error pages, truncated JSON). */
export function excerpt(body: unknown, max = 80): string {
  const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body) ?? String(body);
  return JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, max));
}

/** A body that is an HTML/XML page (error or maintenance page served instead of data). */
export function looksLikeMarkup(text: string): boolean {
  return /^\s*</.test(text);
}
