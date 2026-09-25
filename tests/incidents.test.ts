import { buildIncidentQuery, getIncidents, IncidentsApiError, type Incident } from '../frontend/src/api/incidents';
import {
  detectedDateLabel, firmsIncidentInfo, formatCacheBanner, formatDateTime, parseIncidentId, parsePage, pluralHotspots, recentStartDate, serializeIncident,
} from '../frontend/src/utils/incidents';

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

  it('produces non-overlapping, gap-free offsets across consecutive pages', () => {
    const limit = 12;
    for (let page = 1; page <= 5; page++) {
      const query = buildIncidentQuery({ page, limit });
      expect(Number(query.get('offset'))).toBe((page - 1) * limit);
    }
  });
});

describe('parsePage', () => {
  it('clamps missing, non-numeric or non-positive values to page 1', () => {
    expect(parsePage(null)).toBe(1);
    expect(parsePage('')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-3')).toBe(1);
  });

  it('accepts positive integers and floors decimals', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('4.9')).toBe(4);
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
describe('recent incidents window for the home page', () => {
  it('starts the window the given number of days back, as a UTC date', () => {
    expect(recentStartDate(new Date('2026-09-24T21:40:00+08:00'), 90)).toBe('2026-06-26');
  });

  it('defaults to 90 days so old seed records never look recent', () => {
    expect(recentStartDate(new Date('2026-09-24T00:00:00Z'))).toBe('2026-06-26');
  });
});

describe('formatCacheBanner', () => {
  it('names the exact moment the cached copy was fetched', () => {
    const message = formatCacheBanner('2026-09-20T08:00:00.000Z');
    expect(message.startsWith('База данных недоступна — показаны данные на ')).toBe(true);
    expect(message).not.toBe('База данных недоступна — показаны данные на 2026-09-20T08:00:00.000Z');
  });

  it('falls back to the raw value for an unparseable timestamp instead of "Invalid Date"', () => {
    expect(formatCacheBanner('not-a-date')).toBe('База данных недоступна — показаны данные на not-a-date');
  });
});

describe('getIncidents', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  function mockFetch(status: number, body: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as typeof fetch;
  }

  it('returns the live response as-is', async () => {
    mockFetch(200, { success: true, count: 0, total: 0, limit: 12, offset: 0, regions: [], data: [], mode: 'live' });
    const result = await getIncidents({});
    expect(result.mode).toBe('live');
  });

  it('surfaces a degraded cache response instead of treating it as an error', async () => {
    mockFetch(200, {
      success: true, count: 1, total: 1, limit: 12, offset: 0, regions: [], data: [],
      mode: 'cache', fetched_at: '2026-09-20T08:00:00.000Z',
    });
    const result = await getIncidents({});
    expect(result.mode).toBe('cache');
    expect(result.fetched_at).toBe('2026-09-20T08:00:00.000Z');
  });

  it('throws IncidentsApiError with the server message and status on 503', async () => {
    mockFetch(503, { success: false, error: 'База данных недоступна, и для этого запроса ещё нет сохранённой копии данных' });
    await expect(getIncidents({})).rejects.toMatchObject({
      name: 'IncidentsApiError',
      status: 503,
      message: 'База данных недоступна, и для этого запроса ещё нет сохранённой копии данных',
    });
  });

  it('falls back to a generic message when the error body is missing', async () => {
    mockFetch(500, null);
    try {
      await getIncidents({});
      throw new Error('expected getIncidents to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(IncidentsApiError);
      expect((err as IncidentsApiError).message).toBe('Не удалось загрузить события');
    }
  });
});

describe('firmsIncidentInfo', () => {
  const base: Incident = { id: 1, forest_area_id: null, change_type: 'fire', detected_date: '2026-09-24' };

  it('is null for seed/other incidents without the FIRMS clustering method', () => {
    expect(firmsIncidentInfo(base)).toBeNull();
    expect(firmsIncidentInfo({ ...base, metadata: { region: 'Бурятия' } })).toBeNull();
  });

  it('reads cluster size, status, first/last seen and FRP from metadata', () => {
    const info = firmsIncidentInfo({
      ...base,
      metadata: {
        method: 'firms-cluster-v1', hotspot_count: 3, status: 'active', frp_max: 40.5,
        first_seen: '2026-09-24T05:00:00.000Z', last_seen: '2026-09-24T06:00:00.000Z',
      },
    });
    expect(info).toEqual({
      hotspotCount: 3, active: true, statusLabel: 'Активен', frpMax: 40.5,
      firstSeen: '2026-09-24T05:00:00.000Z', lastSeen: '2026-09-24T06:00:00.000Z',
      sourceLabel: 'NASA FIRMS, кластер 3 термоточки',
    });
  });

  it('labels inactive incidents and tolerates missing fields', () => {
    const info = firmsIncidentInfo({ ...base, metadata: { method: 'firms-cluster-v1', status: 'inactive' } })!;
    expect(info.statusLabel).toBe('Затих');
    expect(info.frpMax).toBeNull();
    expect(info.firstSeen).toBeNull();
    expect(formatDateTime(info.firstSeen)).toBe('—');
  });
});

describe('pluralHotspots', () => {
  it('uses Russian plural forms', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(n => `${n} ${pluralHotspots(n)}`)).toEqual([
      '1 термоточка', '2 термоточки', '5 термоточек', '11 термоточек', '12 термоточек',
      '21 термоточка', '22 термоточки', '25 термоточек', '111 термоточек',
    ]);
  });
});

describe('detectedDateLabel', () => {
  const base = { id: 1, forest_area_id: null, change_type: 'fire', detected_date: '2026-09-20T00:00:00.000Z' };

  it('uses the first hotspot time for FIRMS incidents, matching the times shown next to it', () => {
    const firms = { ...base, source: 'firms', metadata: { method: 'firms-cluster-v1', first_seen: '2026-09-25T12:00:00Z', last_seen: '2026-09-25T13:00:00Z' } };
    expect(detectedDateLabel(firms as Incident)).toBe('25.09.2026');
  });

  it('falls back to detected_date for other incidents', () => {
    expect(detectedDateLabel({ ...base, detected_date: '2026-09-20T12:00:00Z' } as Incident)).toBe('20.09.2026');
  });
});
