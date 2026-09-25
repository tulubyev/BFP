import { hotspot } from './fixtures';
import {
  buildHotspotInserts, HOTSPOT_COLUMNS, HOTSPOT_SOURCE, hotspotToRow, normalizeConfidence, toSqlTime,
} from '../../../backend/services/firmsHistory/hotspotRows';


describe('normalizeConfidence', () => {
  it('maps VIIRS letters and words', () => {
    expect(normalizeConfidence('h')).toBe('high');
    expect(normalizeConfidence('HIGH')).toBe('high');
    expect(normalizeConfidence('n')).toBe('nominal');
    expect(normalizeConfidence('l')).toBe('low');
  });
  it('maps MODIS percentages', () => {
    expect(normalizeConfidence('85')).toBe('high');
    expect(normalizeConfidence('50')).toBe('nominal');
    expect(normalizeConfidence('10')).toBe('low');
  });
  it('returns null for unknown values', () => {
    expect(normalizeConfidence('')).toBeNull();
    expect(normalizeConfidence(undefined)).toBeNull();
    expect(normalizeConfidence('maybe')).toBeNull();
  });
});

describe('toSqlTime', () => {
  it('pads FIRMS HHMM', () => {
    expect(toSqlTime('0512')).toBe('05:12:00');
    expect(toSqlTime('7')).toBe('00:07:00');
    expect(toSqlTime('2359')).toBe('23:59:00');
  });
  it('rejects malformed times', () => {
    expect(toSqlTime('2460')).toBeNull();
    expect(toSqlTime('12:30')).toBeNull();
    expect(toSqlTime(undefined)).toBeNull();
  });
});

describe('hotspotToRow', () => {
  it('orders values as HOTSPOT_COLUMNS with the FIRMS source and normalized fields', () => {
    const row = hotspotToRow(hotspot({ confidence: 'h' }))!;
    expect(row).toHaveLength(HOTSPOT_COLUMNS.length);
    const byColumn = Object.fromEntries(HOTSPOT_COLUMNS.map((c, i) => [c, row[i]]));
    expect(byColumn).toMatchObject({
      source: HOTSPOT_SOURCE, satellite: 'N20', latitude: 52.3, longitude: 104.3,
      acquisition_date: '2026-09-24', acquisition_time: '05:12:00', confidence: 'high', daynight: 'D',
    });
  });
  it('stores NaN measurements as null', () => {
    const row = hotspotToRow(hotspot({ frp: NaN, bright_t31: undefined }))!;
    expect(row[HOTSPOT_COLUMNS.indexOf('frp')]).toBeNull();
    expect(row[HOTSPOT_COLUMNS.indexOf('brightness_t31')]).toBeNull();
  });
  it('rejects points without valid position, date, time or satellite', () => {
    expect(hotspotToRow(hotspot({ latitude: NaN }))).toBeNull();
    expect(hotspotToRow(hotspot({ longitude: 200 }))).toBeNull();
    expect(hotspotToRow(hotspot({ acq_date: '24.09.2026' }))).toBeNull();
    expect(hotspotToRow(hotspot({ acq_time: 'x' }))).toBeNull();
    expect(hotspotToRow(hotspot({ satellite: '' }))).toBeNull();
  });
});

describe('buildHotspotInserts', () => {
  it('builds one parameterized INSERT … ON CONFLICT DO NOTHING per batch', () => {
    const { batches, rejected } = buildHotspotInserts([hotspot(), hotspot({ latitude: 52.31 }), hotspot({ latitude: NaN })]);
    expect(rejected).toBe(1);
    expect(batches).toHaveLength(1);
    const [b] = batches;
    expect(b.rows).toBe(2);
    expect(b.params).toHaveLength(2 * HOTSPOT_COLUMNS.length);
    expect(b.text).toContain('INSERT INTO gis.fire_hotspots (source, satellite, latitude');
    expect(b.text).toContain('($1::varchar, $2::varchar, $3::numeric(9,6), $4::numeric(10,6), $5::numeric');
    expect(b.text).toContain('$10::date, $11::time, $12::varchar, $13::varchar, $14::varchar), ($15::varchar,');
    // already stored observations are filtered out before they can draw a SERIAL id
    expect(b.text).toContain('WHERE NOT EXISTS (SELECT 1 FROM gis.fire_hotspots f WHERE f.satellite = v.satellite'
      + ' AND f.acquisition_date = v.acquisition_date AND f.acquisition_time = v.acquisition_time'
      + ' AND f.latitude = v.latitude AND f.longitude = v.longitude)');
    expect(b.text).toMatch(/ON CONFLICT \(satellite, acquisition_date, acquisition_time, latitude, longitude\) DO NOTHING RETURNING id$/);
    expect(b.text).not.toContain('52.3');
  });
  it('splits into batches', () => {
    const many = Array.from({ length: 5 }, (_, i) => hotspot({ latitude: 50 + i }));
    const { batches } = buildHotspotInserts(many, 2);
    expect(batches.map(b => b.rows)).toEqual([2, 2, 1]);
    expect(batches[2].text).toContain('($1::varchar, ');
    expect(batches[2].text).not.toContain('$15');
  });
  it('builds nothing for an empty snapshot', () => {
    expect(buildHotspotInserts([])).toEqual({ batches: [], rejected: 0 });
  });
});
