import { buildIncidentQuery, type Incident } from '../frontend/src/api/incidents';
import { parseIncidentId, serializeIncident } from '../frontend/src/utils/incidents';

describe('incident query construction', () => {
  it('builds filters and page offset without changing the API defaults for other clients', () => {
    const query = buildIncidentQuery({
      type: 'fire',
      region: 'Иркутская область',
      sort: 'area_desc',
      page: 3,
      limit: 12,
    });
    expect(query.get('change_type')).toBe('fire');
    expect(query.get('region')).toBe('Иркутская область');
    expect(query.get('sort')).toBe('area_desc');
    expect(query.get('limit')).toBe('12');
    expect(query.get('offset')).toBe('24');
  });
});

describe('incident map URL handling', () => {
  it('accepts only positive integer incident IDs', () => {
    expect(parseIncidentId('42')).toBe(42);
    expect(parseIncidentId('<img src=x onerror=alert(1)>')).toBeNull();
    expect(parseIncidentId('-1')).toBeNull();
    expect(parseIncidentId(null)).toBeNull();
  });
});

describe('incident download', () => {
  it('serializes the complete incident as readable JSON', () => {
    const incident: Incident = { id: 7, forest_area_id: null, change_type: 'fire', detected_date: '2026-09-20' };
    expect(JSON.parse(serializeIncident(incident))).toEqual(incident);
    expect(serializeIncident(incident)).toContain('\n  "id": 7');
  });
});