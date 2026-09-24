/**
 * Assembles GeoJSON polygons from OSM relation members returned by Overpass `out geom`.
 *
 * Overpass embeds each way member's node coordinates directly in the relation's `members`
 * array (no separate recursion query needed), but a boundary is frequently split across many
 * way segments that only share endpoints — Overpass does not stitch them into rings for us.
 * This is deliberately dependency-free (no osmtogeojson): the ring-merge and point-in-ring
 * logic below is the whole of what's needed for `boundary=national_park` /
 * `protected_area` multipolygons, and keeping it here avoids a new dependency for one file.
 */

export type Position = [number, number]; // [lon, lat], as GeoJSON expects
export type Ring = Position[];

export interface WayGeometryMember {
  role: string;
  geometry: Array<{ lat: number; lon: number }>;
}

const EPSILON = 1e-7;

function pointsEqual(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

function isClosed(ring: Ring): boolean {
  return ring.length > 2 && pointsEqual(ring[0], ring[ring.length - 1]);
}

function wayToRing(member: WayGeometryMember): Ring {
  return member.geometry.map(p => [p.lon, p.lat] as Position);
}

/**
 * Merges way segments sharing endpoints into closed rings. A segment that never finds a match
 * is force-closed by repeating its first point — better to show a slightly wrong shape than to
 * drop a reserve because one OSM way in its boundary is missing.
 */
export function assembleRings(ways: Ring[]): Ring[] {
  const remaining = ways.filter(w => w.length >= 2).map(w => w.slice());
  const rings: Ring[] = [];

  while (remaining.length) {
    let ring = remaining.shift()!;
    let progress = true;
    while (progress && !isClosed(ring)) {
      progress = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        if (pointsEqual(ring[ring.length - 1], seg[0])) {
          ring = ring.concat(seg.slice(1));
        } else if (pointsEqual(ring[ring.length - 1], seg[seg.length - 1])) {
          ring = ring.concat(seg.slice(0, -1).reverse());
        } else if (pointsEqual(ring[0], seg[seg.length - 1])) {
          ring = seg.slice(0, -1).concat(ring);
        } else if (pointsEqual(ring[0], seg[0])) {
          ring = seg.slice(1).reverse().concat(ring);
        } else {
          continue;
        }
        remaining.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (!isClosed(ring) && ring.length >= 3) ring = [...ring, ring[0]];
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function pointInRing(point: Position, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Pairs each hole with the outer ring that contains it; unmatched holes are dropped. */
function assignHoles(outerRings: Ring[], innerRings: Ring[]): Ring[][] {
  const polygons: Ring[][] = outerRings.map(r => [r]);
  for (const hole of innerRings) {
    const outerIndex = outerRings.findIndex(outer => pointInRing(hole[0], outer));
    if (outerIndex >= 0) polygons[outerIndex].push(hole);
  }
  return polygons;
}

/**
 * Builds a Polygon (one outer ring) or MultiPolygon (several) from a relation's way members.
 * Returns null when no outer ring could be assembled at all (e.g. all members missing geometry).
 */
export function buildMultiPolygon(members: WayGeometryMember[]): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const outerWays = members.filter(m => m.role !== 'inner').map(wayToRing);
  const innerWays = members.filter(m => m.role === 'inner').map(wayToRing);

  const outerRings = assembleRings(outerWays);
  if (outerRings.length === 0) return null;
  const innerRings = assembleRings(innerWays);
  const polygons = assignHoles(outerRings, innerRings);

  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}
