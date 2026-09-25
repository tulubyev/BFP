import {
  buildNewIncident, INCIDENT_METHOD, isMatchable, mergeIntoIncident, planIncidents, statusAt,
  type ExistingIncident, type IncidentRow,
} from '../../../backend/services/firmsHistory/incidents';
import { clusterPoints, pointsBbox } from '../../../backend/services/firmsHistory/clusters';
import { point } from './fixtures';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

/** An existing incident as the store would load it after `row` was written with `id`. */
function stored(id: number, row: IncidentRow): ExistingIncident {
  return {
    id,
    satellite: row.satellite,
    center: { lat: row.center_lat, lon: row.center_lng },
    bbox: { minLat: row.bbox_min_lat, minLon: row.bbox_min_lng, maxLat: row.bbox_max_lat, maxLon: row.bbox_max_lng },
    metadata: JSON.parse(JSON.stringify(row.metadata)),
  };
}

describe('statusAt', () => {
  it('turns inactive after 48 h without new points', () => {
    expect(statusAt(hoursAgo(47.9), NOW)).toBe('active');
    expect(statusAt(hoursAgo(48.1), NOW)).toBe('inactive');
  });
});

describe('buildNewIncident', () => {
  const cluster = [
    point(11, 52.0005, 104.0005, { acquiredAt: hoursAgo(10), satellite: 'N20', confidence: 'high', frp: 20.5 }),
    point(10, 52.0006, 104.0006, { acquiredAt: hoursAgo(20), satellite: 'N', frp: 5 }),
    point(12, 52.01, 104.01, { acquiredAt: hoursAgo(2), satellite: 'N', frp: null }),
  ];
  const row = buildNewIncident(cluster, NOW);

  it('fills the forest_changes fields from the points', () => {
    expect(row).toMatchObject({
      change_type: 'fire',
      source: 'firms',
      detected_date: hoursAgo(20).slice(0, 10),
      satellite: 'N,N20',
      area_ha: 28.12, // 2 unique pixels × 14.06
      confidence: 0.33,
      bbox_min_lat: 52.0005, bbox_min_lng: 104.0005, bbox_max_lat: 52.01, bbox_max_lng: 104.01,
    });
    expect(row.center_lat).toBeCloseTo((52.0005 + 52.0006 + 52.01) / 3, 6);
  });

  it('writes the metadata the design asks for', () => {
    expect(row.metadata).toMatchObject({
      method: INCIDENT_METHOD,
      cluster_key: '10',
      region: 'Иркутская область',
      region_iso: 'RU-IRK',
      hotspot_count: 3,
      high_count: 1,
      pixel_count: 2,
      frp_max: 20.5,
      frp_sum: 25.5,
      first_seen: hoursAgo(20),
      last_seen: hoursAgo(2),
      status: 'active',
      max_hotspot_id: 12,
    });
  });

  it('is inactive when the newest point is older than 48 h', () => {
    expect(buildNewIncident([point(1, 52, 104, { acquiredAt: hoursAgo(50), confidence: 'high' })], NOW).metadata.status)
      .toBe('inactive');
  });
});

describe('isMatchable', () => {
  const base = stored(1, buildNewIncident([point(1, 52, 104, { acquiredAt: hoursAgo(10), confidence: 'high' })], NOW));
  it('accepts FIRMS incidents with a point in the last 72 h', () => {
    expect(isMatchable(base, NOW)).toBe(true);
    expect(isMatchable({ ...base, metadata: { ...base.metadata, last_seen: hoursAgo(73) } }, NOW)).toBe(false);
  });
  it('never matches rows without metadata.method (seed data)', () => {
    expect(isMatchable({ ...base, metadata: { last_seen: hoursAgo(1) } }, NOW)).toBe(false);
  });
});

describe('mergeIntoIncident', () => {
  const first = [
    point(1, 52.0005, 104.0005, { acquiredAt: hoursAgo(30), frp: 10 }),
    point(2, 52.001, 104.001, { acquiredAt: hoursAgo(29), frp: 4 }),
  ];
  const incident = stored(7, buildNewIncident(first, NOW));

  it('returns null when no point is newer than the watermark (idempotent re-run)', () => {
    expect(mergeIntoIncident(incident, first, NOW)).toBeNull();
  });

  it('adds only new points; a new detection in a known pixel adds no area', () => {
    const next = [
      ...first,
      point(5, 52.0006, 104.0006, { acquiredAt: hoursAgo(3), frp: 30, confidence: 'high', satellite: 'N21' }), // same cell as #1
      point(6, 52.012, 104.001, { acquiredAt: hoursAgo(1), frp: 1 }),
    ];
    const row = mergeIntoIncident(incident, next, NOW)!;
    expect(row.metadata).toMatchObject({
      cluster_key: '1',
      hotspot_count: 4,
      high_count: 1,
      pixel_count: incident.metadata.pixel_count! + 1,
      frp_max: 30,
      frp_sum: 45,
      first_seen: hoursAgo(30),
      last_seen: hoursAgo(1),
      max_hotspot_id: 6,
      status: 'active',
    });
    expect(row.confidence).toBe(0.25);
    expect(row.satellite).toBe('N,N21');
    expect(row.bbox_max_lat).toBe(52.012);
    expect(row.detected_date).toBe(hoursAgo(30).slice(0, 10));
    expect(row.center_lat).toBeCloseTo((52.0005 + 52.001 + 52.0006 + 52.012) / 4, 5);
  });
});

describe('planIncidents', () => {
  it('creates incidents only for qualifying clusters', () => {
    const clusters = clusterPoints([
      point(1, 52, 104), point(2, 52.01, 104), // pair → incident
      point(3, 53, 105, { confidence: 'high' }), // lone high → incident
      point(4, 54, 106), // lone nominal → nothing
    ]);
    const plan = planIncidents(clusters, [], NOW);
    expect(plan.creates.map(r => r.metadata.cluster_key)).toEqual(['1', '3']);
    expect(plan.updates).toEqual([]);
    expect(plan.statusChanges).toEqual([]);
  });

  it('updates an active incident within 2 km instead of creating a new one', () => {
    const incident = stored(7, buildNewIncident([point(1, 52, 104, { acquiredAt: hoursAgo(20) }), point(2, 52.005, 104, { acquiredAt: hoursAgo(20) })], NOW));
    // new lone nominal point 1.9 km north of the box: would not qualify alone, but extends the incident
    const clusters = clusterPoints([point(9, 52.005 + 0.017, 104, { acquiredAt: hoursAgo(1) })]);
    const plan = planIncidents(clusters, [incident], NOW);
    expect(plan.creates).toEqual([]);
    expect(plan.updates.map(u => u.id)).toEqual([7]);
    expect(plan.updates[0].row.metadata.hotspot_count).toBe(3);
  });

  it('creates a new incident when the nearest active one is farther than 2 km', () => {
    const incident = stored(7, buildNewIncident([point(1, 52, 104, { confidence: 'high', acquiredAt: hoursAgo(5) })], NOW));
    const plan = planIncidents(clusterPoints([point(9, 52.03, 104, { confidence: 'high', acquiredAt: hoursAgo(1) })]), [incident], NOW);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toHaveLength(1);
  });

  it('does not reopen incidents whose last point is older than 72 h', () => {
    const old = stored(7, buildNewIncident([point(1, 52, 104, { confidence: 'high', acquiredAt: hoursAgo(80) })], NOW));
    const plan = planIncidents(clusterPoints([point(9, 52, 104, { confidence: 'high', acquiredAt: hoursAgo(1) })]), [old], NOW);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toHaveLength(1);
  });

  it('assigns a cluster to the nearest of several incidents and merges clusters near one incident', () => {
    const near = stored(1, buildNewIncident([point(1, 52, 104, { confidence: 'high', acquiredAt: hoursAgo(5) })], NOW));
    const far = stored(2, buildNewIncident([point(2, 52.03, 104, { confidence: 'high', acquiredAt: hoursAgo(5) })], NOW));
    const clusters = clusterPoints([
      point(10, 52.008, 104, { acquiredAt: hoursAgo(1) }), // 0.9 km from #1, 2.4 km from #2
      point(11, 51.99, 104.0, { acquiredAt: hoursAgo(1) }), // separate cluster (2 km from #10), 1.1 km from #1
    ]);
    expect(clusters).toHaveLength(2);
    const plan = planIncidents(clusters, [near, far], NOW);
    expect(plan.creates).toEqual([]);
    expect(plan.updates.map(u => u.id)).toEqual([1]);
    expect(plan.updates[0].row.metadata.hotspot_count).toBe(3);
  });

  it('flips status of incidents without new points after 48 h, and back when points return', () => {
    const quiet = stored(3, buildNewIncident([point(1, 52, 104, { confidence: 'high', acquiredAt: hoursAgo(49) })], NOW));
    quiet.metadata.status = 'active';
    expect(planIncidents([], [quiet], NOW).statusChanges).toEqual([{ id: 3, status: 'inactive' }]);

    quiet.metadata.status = 'inactive';
    expect(planIncidents([], [quiet], NOW).statusChanges).toEqual([]);
    const plan = planIncidents(clusterPoints([point(5, 52.001, 104, { acquiredAt: hoursAgo(1) })]), [quiet], NOW);
    expect(plan.updates[0].row.metadata.status).toBe('active');
    expect(plan.statusChanges).toEqual([]);
  });

  it('ignores rows without metadata.method (seed data)', () => {
    const seed: ExistingIncident = {
      id: 99, satellite: 'Sentinel-2', center: { lat: 52, lon: 104 },
      bbox: pointsBbox([point(0, 52, 104)]), metadata: { region: 'Иркутская область', status: 'active', last_seen: hoursAgo(100) },
    };
    const plan = planIncidents(clusterPoints([point(1, 52, 104, { confidence: 'high', acquiredAt: hoursAgo(1) })]), [seed], NOW);
    expect(plan.updates).toEqual([]);
    expect(plan.statusChanges).toEqual([]);
    expect(plan.creates).toHaveLength(1);
  });
});
