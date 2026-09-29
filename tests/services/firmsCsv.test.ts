import {
  FirmsCsvStructureError, MAX_BAD_ROW_SHARE, MIN_ROWS_FOR_RATIO, missingColumns, parseFirmsCsv,
} from '../../backend/services/firmsCsv';

const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const row = (lat: string, lon: string, date = '2026-09-27', time = '0412') =>
  `${lat},${lon},330.1,0.4,0.4,${date},${time},N,VIIRS,n,2.0NRT,290.2,5.6,D`;
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseFirmsCsv', () => {
  it('parses a normal file, tolerating CRLF and blank lines', () => {
    const r = parseFirmsCsv(`${HEADER}\r\n${row('57.6', '105.8')}\r\n\r\n${row('-64.1', '-170.2')}\r\n`);
    expect(r.rows).toBe(2);
    expect(r.rejected).toBe(0);
    expect(r.hotspots[0]).toMatchObject({ latitude: 57.6, longitude: 105.8, brightness: 330.1, frp: 5.6, acq_date: '2026-09-27', satellite: 'N', confidence: 'n' });
    expect(r.hotspots[1].longitude).toBe(-170.2); // Chukotka side of the antimeridian
  });

  it('drops rows with bad position, date or field count without failing the file', () => {
    const rows = Array.from({ length: 200 }, () => row('50.1', '100.2'));
    rows.push(row('NaN', '100'), row('95', '100'), row('50', '181'), row('50', '100', '27.09.2026'), row('50', '100', '2026-09-27', ''), '50,100');
    const r = parseFirmsCsv(csv(...rows));
    expect(r.hotspots).toHaveLength(200);
    expect(r.rejected).toBe(6);
  });

  it('never yields NaN values', () => {
    const r = parseFirmsCsv(csv(`50.1,100.2,,0.4,0.4,2026-09-27,0412,N,VIIRS,n,2.0NRT,,,D`));
    expect(r.hotspots[0].brightness).toBe(0);
    expect(r.hotspots[0].frp).toBe(0);
    expect(r.hotspots[0].bright_t31).toBeUndefined();
  });

  it('rejects the whole file when a required column is gone', () => {
    const renamed = csv(row('50', '100')).replace('latitude', 'lat');
    expect(() => parseFirmsCsv(renamed, 'J1.csv')).toThrow(FirmsCsvStructureError);
    expect(() => parseFirmsCsv(renamed, 'J1.csv')).toThrow(/J1\.csv: header lacks column\(s\) latitude/);
  });

  it('accepts the older brightness column name', () => {
    const old = csv(row('50', '100')).replace('bright_ti4', 'brightness');
    expect(parseFirmsCsv(old).hotspots).toHaveLength(1);
  });

  it('rejects an empty or html response', () => {
    expect(() => parseFirmsCsv('')).toThrow(/empty response/);
    expect(() => parseFirmsCsv('<html><body>Service unavailable</body></html>')).toThrow(FirmsCsvStructureError);
  });

  it('treats a file with too many bad rows as a format change', () => {
    const good = Array.from({ length: MIN_ROWS_FOR_RATIO }, () => row('50', '100'));
    const bad = Array.from({ length: Math.ceil(MIN_ROWS_FOR_RATIO * MAX_BAD_ROW_SHARE) + 2 }, () => row('x', 'y'));
    expect(() => parseFirmsCsv(csv(...good, ...bad))).toThrow(/rows are invalid/);
  });

  it('a small file is not judged by ratio (one bad row of five is just dropped)', () => {
    const r = parseFirmsCsv(csv(row('50', '100'), row('50', '100'), row('50', '100'), row('50', '100'), row('x', 'y')));
    expect(r.hotspots).toHaveLength(4);
    expect(r.rejected).toBe(1);
  });

  it('missingColumns lists what is absent', () => {
    expect(missingColumns(HEADER.split(','))).toEqual([]);
    expect(missingColumns(['latitude', 'longitude'])).toEqual(['acq_date', 'acq_time', 'frp', 'confidence', 'bright_ti4|brightness']);
  });
});
