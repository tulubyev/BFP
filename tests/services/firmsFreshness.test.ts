import { newestAcquisition, parseAcquisition, type FIRMSHotspot } from '../../backend/services/firmsService';

function hotspot(acq_date: string, acq_time: string): Pick<FIRMSHotspot, 'acq_date' | 'acq_time'> {
  return { acq_date, acq_time };
}

describe('parseAcquisition', () => {
  it('combines acq_date and acq_time (UTC) into a Date', () => {
    expect(parseAcquisition('2026-09-24', '1430')?.toISOString()).toBe('2026-09-24T14:30:00.000Z');
  });

  it('pads a short acq_time', () => {
    expect(parseAcquisition('2026-09-24', '5')?.toISOString()).toBe('2026-09-24T00:05:00.000Z');
  });

  it('is null without a date', () => {
    expect(parseAcquisition('', '1430')).toBeNull();
  });

  it('is null for an unparseable date', () => {
    expect(parseAcquisition('not-a-date', '1430')).toBeNull();
  });
});

describe('newestAcquisition', () => {
  it('picks the latest of several hotspots', () => {
    const hotspots = [hotspot('2026-09-24', '0100'), hotspot('2026-09-24', '1430'), hotspot('2026-09-23', '2300')];
    expect(newestAcquisition(hotspots)?.toISOString()).toBe('2026-09-24T14:30:00.000Z');
  });

  it('is null for an empty list', () => {
    expect(newestAcquisition([])).toBeNull();
  });

  it('skips unparseable entries', () => {
    const hotspots = [hotspot('', ''), hotspot('2026-09-24', '0500')];
    expect(newestAcquisition(hotspots)?.toISOString()).toBe('2026-09-24T05:00:00.000Z');
  });
});
