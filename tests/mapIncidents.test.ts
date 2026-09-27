import {
  INCIDENT_BBOX_MIN_ZOOM,
  INCIDENT_COLORS,
  describeIncident,
  formatUtc,
  incidentActivity,
  incidentBounds,
  incidentCardUrl,
  incidentPointRadius,
  incidentShape,
  incidentStyle,
  incidentsGeojsonUrl,
  isMapIncident,
  windowStartDate,
  type IncidentFeatureProps,
} from '../frontend/src/map/incidents';

const props: IncidentFeatureProps = {
  id: 42,
  change_type: 'fire',
  detected_date: '2026-09-20',
  source: 'firms',
  region: 'Иркутская область',
  method: 'firms-cluster-v1',
  status: 'active',
  hotspot_count: 17,
  first_seen: '2026-09-20T04:28:00Z',
  last_seen: '2026-09-25T18:05:00Z',
  bbox: [104.1, 52.2, 104.3, 52.35],
};

describe('incidentsGeojsonUrl', () => {
  it('asks for fires of the last 30 days without static heat sources', () => {
    const url = new URL(incidentsGeojsonUrl(new Date('2026-09-27T10:00:00Z')), 'https://x');
    expect(url.pathname).toBe('/api/monitoring/forest-changes/geojson');
    expect(Object.fromEntries(url.searchParams)).toEqual({ change_type: 'fire', start_date: '2026-08-28', static_sources: 'exclude' });
  });

  it('windowStartDate counts UTC days', () => {
    expect(windowStartDate(new Date('2026-03-01T00:30:00Z'), 1)).toBe('2026-02-28');
  });
});

describe('isMapIncident', () => {
  it('keeps FIRMS clusters, drops static sources and other records', () => {
    expect(isMapIncident(props)).toBe(true);
    expect(isMapIncident({ ...props, status: 'inactive' })).toBe(true);
    expect(isMapIncident({ ...props, status: 'static_source' })).toBe(false);
    expect(isMapIncident({ ...props, method: null })).toBe(false);
    expect(isMapIncident({ ...props, method: 'manual' })).toBe(false);
  });
});

describe('layer style by status', () => {
  it('active incidents are orange and solid, others grey and dashed', () => {
    expect(incidentActivity(props)).toBe('active');
    expect(incidentActivity({ status: 'inactive' })).toBe('inactive');
    expect(incidentActivity({ status: null })).toBe('inactive');
    const active = incidentStyle('active');
    const inactive = incidentStyle('inactive');
    expect(active.color).toBe(INCIDENT_COLORS.active);
    expect(active.dashArray).toBeUndefined();
    expect(inactive.color).toBe(INCIDENT_COLORS.inactive);
    expect(inactive.dashArray).toBeDefined();
    expect(active.fillOpacity).toBeGreaterThan(inactive.fillOpacity);
    expect(incidentPointRadius('active')).toBeGreaterThan(incidentPointRadius('inactive'));
  });

  it('the selected incident is highlighted, keeping its fill', () => {
    const selected = incidentStyle('inactive', true);
    expect(selected.color).toBe('#facc15');
    expect(selected.weight).toBeGreaterThan(incidentStyle('inactive').weight);
    expect(selected.fillColor).toBe(INCIDENT_COLORS.inactive);
  });

  it('bbox outline from zoom 9, a centre point below', () => {
    expect(incidentShape(INCIDENT_BBOX_MIN_ZOOM - 1)).toBe('point');
    expect(incidentShape(INCIDENT_BBOX_MIN_ZOOM)).toBe('bbox');
    expect(incidentShape(5)).toBe('point');
    expect(incidentShape(14)).toBe('bbox');
  });
});

describe('incidentBounds', () => {
  it('turns [w, s, e, n] into Leaflet [[s, w], [n, e]]', () => {
    expect(incidentBounds(props)).toEqual([[52.2, 104.1], [52.35, 104.3]]);
  });

  it('rejects missing, inverted and non-numeric boxes', () => {
    expect(incidentBounds({ bbox: null })).toBeNull();
    expect(incidentBounds({ bbox: [104.3, 52.2, 104.1, 52.35] })).toBeNull();
    expect(incidentBounds({ bbox: [104.1, 52.4, 104.3, 52.35] })).toBeNull();
    expect(incidentBounds({ bbox: [104.1, NaN, 104.3, 52.35] })).toBeNull();
    expect(incidentBounds({ bbox: ['1', 2, 3, 4] as any })).toBeNull();
  });
});

describe('describeIncident', () => {
  it('neutral title, region, dates, hotspot count, status and a card link', () => {
    const d = describeIncident(props);
    expect(d.title).toBe('Термоточки NASA FIRMS, инцидент #42');
    expect(d.title).not.toMatch(/пожар/i);
    expect(d.rows).toEqual([
      ['Тип', 'кластер термоточек (вероятно, пожар растительности)'],
      ['Регион', 'Иркутская область'],
      ['Первая точка', '20.09.2026 04:28 UTC'],
      ['Последняя точка', '25.09.2026 18:05 UTC'],
      ['Число термоточек', '17'],
      ['Статус', 'активен'],
    ]);
    expect(d.link).toEqual({ href: '/incidents?id=42', text: 'Открыть карточку →' });
  });

  it('shows «—» for missing values and falls back to detected_date', () => {
    const d = describeIncident({ ...props, region: null, hotspot_count: null, first_seen: null, last_seen: null, status: 'inactive' });
    expect(d.rows).toEqual(expect.arrayContaining([
      ['Регион', '—'],
      ['Первая точка', '20.09.2026 00:00 UTC'],
      ['Последняя точка', '—'],
      ['Число термоточек', '—'],
      ['Статус', 'затих'],
    ]));
  });

  it('formatUtc / incidentCardUrl', () => {
    expect(formatUtc('not a date')).toBe('—');
    expect(formatUtc(null)).toBe('—');
    expect(incidentCardUrl(7)).toBe('/incidents?id=7');
  });
});
