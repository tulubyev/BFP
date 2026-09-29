/**
 * Size limits for responses of external sources (future.md §13: timeouts and response size limits).
 * A broken or hostile upstream must not make us buffer gigabytes: axios aborts the transfer past
 * `maxContentLength`, fetch() bodies go through readBodyWithLimit().
 *
 * Values are generous margins over the sizes the code actually receives (a limit that trips on a
 * busy fire day would turn into «нет данных»):
 * - FIRMS VIIRS global 24 h CSV, one per satellite (firmsService): ~80 B per row; a peak global day
 *   is a few hundred thousand detections → up to ~30–40 MB per file. Limit 100 MB.
 * - Overpass OOPT (overpassService): all Russian national parks and zapovedniks with full geometry
 *   (`out geom`), tens of MB of JSON. Limit 256 MB.
 * - Overpass incident context (incidentContext/overpass.ts): roads and settlements within 15 km of
 *   a point; a few MB near a city (every street with geometry), KB in the taiga. Limit 64 MB.
 * - Rosleshoz open-data CSV (rosleskhozService): per-subject tables, KB to a few MB. Limit 50 MB;
 *   meta.csv is a handful of lines. Limit 1 MB.
 * - GFW tiles (gfwTiles): one 256/512 px PNG, tens to hundreds of KB. Limit 10 MB; the DIST-ALERT
 *   version probe is a redirect with an empty body. Limit 1 MB.
 * - GFW Data API queries (globalForestWatch): a few rows of JSON. Limit 10 MB.
 * - Earth Search STAC JSON (imagery/stac.ts): one page of scene items, tens of KB. Limit 10 MB.
 */
const MB = 1024 * 1024;

export const RESPONSE_LIMITS = {
  firmsCsv: 100 * MB,
  overpass: 256 * MB,
  overpassContext: 64 * MB,
  rosleshozCsv: 50 * MB,
  rosleshozMeta: 1 * MB,
  gfwTile: 10 * MB,
  gfwRedirect: 1 * MB,
  gfwQuery: 10 * MB,
  stacJson: 10 * MB,
} as const;

export class ResponseTooLargeError extends Error {
  constructor(public readonly limit: number, public readonly url?: string) {
    super(`response${url ? ` from ${url}` : ''} exceeds ${limit} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads a fetch() response body, failing fast on a `content-length` over `maxBytes` and aborting
 * once the streamed bytes pass it (content-length may be missing or wrong).
 */
export async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(maxBytes, res.url || undefined);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(maxBytes, res.url || undefined);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** readBodyWithLimit() + JSON.parse. */
export async function readJsonWithLimit(res: Response, maxBytes: number): Promise<any> {
  return JSON.parse((await readBodyWithLimit(res, maxBytes)).toString('utf8'));
}
