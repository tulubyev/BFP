import { INCIDENT_GEO_SQL, incidentGeoFromRow } from '../../../backend/services/imagery/incident';

const firms = {
  id: 12,
  center_lat: 53.615, center_lng: 103.07,
  bbox_min_lat: '53.600000', bbox_min_lng: '103.050000', bbox_max_lat: '53.630000', bbox_max_lng: '103.090000',
  detected_date: '2025-07-20',
  first_seen: '2025-07-20T05:00:00Z', last_seen: '2025-07-22T18:30:00Z',
};

describe('incidentGeoFromRow', () => {
  it('uses the bbox and first/last seen of a FIRMS incident', () => {
    expect(incidentGeoFromRow(firms)).toEqual({
      id: 12, bbox: [103.05, 53.6, 103.09, 53.63], firstSeen: '2025-07-20T05:00:00.000Z', lastSeen: '2025-07-22T18:30:00.000Z', hasBbox: true,
    });
  });

  it('falls back to the centre point and detected_date', () => {
    const row = { id: 3, center_lat: '52.1', center_lng: '104.2', detected_date: '2024-06-01' };
    expect(incidentGeoFromRow(row)).toEqual({
      id: 3, bbox: [104.2, 52.1, 104.2, 52.1], firstSeen: '2024-06-01T00:00:00.000Z', lastSeen: '2024-06-01T00:00:00.000Z', hasBbox: false,
    });
  });

  it('ignores an inverted bbox and uses the centre', () => {
    expect(incidentGeoFromRow({ ...firms, bbox_min_lat: 54, bbox_max_lat: 53 })).toMatchObject({ bbox: [103.07, 53.615, 103.07, 53.615], hasBbox: false });
  });

  it.each([
    ['no coordinates', { id: 1, detected_date: '2024-06-01' }],
    ['no date', { id: 1, center_lat: 52, center_lng: 104 }],
    ['garbage coordinates', { id: 1, center_lat: 'abc', center_lng: 104, detected_date: '2024-06-01' }],
    ['out of range', { id: 1, center_lat: 95, center_lng: 104, detected_date: '2024-06-01' }],
  ])('reports no-geometry for %s', (_label, row) => {
    expect(incidentGeoFromRow(row)).toBe('no-geometry');
  });

  it('the query is parameterised by id', () => {
    expect(INCIDENT_GEO_SQL).toMatch(/WHERE id = \$1$/);
  });
});
