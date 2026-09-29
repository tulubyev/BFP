/**
 * Quality gate for the Overpass OOPT answer (future.md §5).
 *
 * - The answer must be a JSON object with an `elements` array; an HTML error page, a truncated
 *   JSON body (axios then hands over a string) or a `remark` reporting a runtime error (Overpass
 *   returns partial elements when the query times out or runs out of memory) rejects it.
 * - Each resulting geometry: WGS84 coordinates (finite, |lon| ≤ 180, |lat| ≤ 90); polygon rings
 *   of ≥ 4 positions, closed; area > 0. An invalid object is dropped and counted.
 * - The number of protected areas must be plausible: at least MIN_OOPT_FEATURES and at least
 *   MIN_SHARE_OF_LAST_GOOD of the last good list — otherwise the answer is taken as truncated.
 * The existing rule «an empty answer never replaces a good list» (isValid in overpassService.ts)
 * stays as it is; this gate only adds to it.
 */
import area from '@turf/area';
import { failed, excerpt, looksLikeMarkup, passed, type QualityResult } from './result';

export const SOURCE = 'oopt';
export const CHECK = 'overpass';
/** ≈ 130 national parks and zapovedniks in the 83 regions (2026). */
export const MIN_OOPT_FEATURES = 20;
export const MIN_SHARE_OF_LAST_GOOD = 0.5;

export type OoptGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point;

/** Why an Overpass body is not a usable answer, or null when it has an `elements` array. */
export function overpassAnswerProblem(data: unknown): string | null {
  if (typeof data === 'string') {
    if (!data.trim()) return 'empty response';
    return looksLikeMarkup(data) ? `HTML page instead of JSON: ${excerpt(data)}` : `not valid JSON (truncated?): ${excerpt(data)}`;
  }
  if (data === null || typeof data !== 'object') return `not a JSON object: ${excerpt(data)}`;
  const answer = data as { elements?: unknown; remark?: unknown };
  if (!Array.isArray(answer.elements)) return 'JSON without an "elements" array';
  if (typeof answer.remark === 'string' && /error/i.test(answer.remark)) {
    return `Overpass reported an error, answer is partial: ${excerpt(answer.remark, 120)}`;
  }
  return null;
}

function validPosition(p: unknown): boolean {
  if (!Array.isArray(p) || p.length < 2) return false;
  const [lon, lat] = p;
  return typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat)
    && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

function ringProblem(ring: unknown): string | null {
  if (!Array.isArray(ring) || ring.length < 4) return 'ring with < 4 positions';
  if (!ring.every(validPosition)) return 'coordinates outside WGS84';
  const [a, b] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) return 'ring not closed';
  return null;
}

/** Why a geometry cannot go on the map, or null when it is valid. */
export function geometryProblem(geometry: OoptGeometry | null | undefined): string | null {
  if (!geometry) return 'no geometry';
  if (geometry.type === 'Point') return validPosition(geometry.coordinates) ? null : 'point outside WGS84';
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!polygons || polygons.length === 0) return 'unsupported or empty geometry';
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return 'polygon without rings';
    for (const ring of polygon) {
      const problem = ringProblem(ring);
      if (problem) return problem;
    }
  }
  let m2: number;
  try {
    m2 = area({ type: 'Feature', properties: {}, geometry });
  } catch {
    return 'area cannot be computed';
  }
  return Number.isFinite(m2) && m2 > 0 ? null : 'zero area';
}

/** Why the feature count looks like a truncated answer, or null when it is plausible. */
export function countProblem(count: number, lastGoodCount: number | null | undefined): string | null {
  if (count < MIN_OOPT_FEATURES) return `only ${count} protected areas (< ${MIN_OOPT_FEATURES}) — truncated answer?`;
  if (lastGoodCount && count < lastGoodCount * MIN_SHARE_OF_LAST_GOOD) {
    return `only ${count} protected areas, last good list had ${lastGoodCount} (< ${MIN_SHARE_OF_LAST_GOOD * 100}%) — truncated answer?`;
  }
  return null;
}

/** Short tally of drop reasons: "2 × ring not closed, 1 × zero area". */
export function tallyProblems(problems: string[]): string | undefined {
  if (!problems.length) return undefined;
  const counts = new Map<string, number>();
  for (const p of problems) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].map(([r, n]) => `${n} × ${r}`).join(', ');
}

/**
 * Verdict on one parsed answer: `checked` objects had their geometry checked, `problems` lists why
 * each dropped one failed, `kept` protected areas remain after the geometry and scope filters.
 */
export function ooptVerdict(checked: number, problems: string[], kept: number, lastGoodCount: number | null | undefined): QualityResult {
  const note = tallyProblems(problems);
  const problem = countProblem(kept, lastGoodCount);
  if (problem) return failed(SOURCE, CHECK, note ? `${problem}; dropped ${note}` : problem, checked, problems.length);
  return passed(SOURCE, CHECK, checked, problems.length, note && `dropped ${note}`);
}
