import {
  NONE_REASONS, activityWindow, afterNoneReason, afterWindow, beforeNoneReason, beforeWindow, clearFraction, clearPct,
  isUsable, mostlySnow, nodataFraction, orderCandidates, pickScene, sclStats, toInterval, type SclStats,
} from '../../../backend/services/imagery/selection';
import { scene } from './helpers';

/** SCL values: `counts[class] = how many pixels`. */
function scl(counts: Record<number, number>): number[] {
  return Object.entries(counts).flatMap(([cls, n]) => Array(n).fill(Number(cls)));
}

describe('search windows', () => {
  it('before: 60 days up to one day before the first hotspot', () => {
    expect(beforeWindow('2025-07-20T05:00:00Z')).toEqual({ start: '2025-05-21T05:00:00.000Z', end: '2025-07-19T05:00:00.000Z' });
  });

  it('after: strictly after the last hotspot, up to now', () => {
    expect(afterWindow('2025-07-22T18:30:00Z', new Date('2025-08-01T00:00:00Z')))
      .toEqual({ start: '2025-07-22T18:30:01.000Z', end: '2025-08-01T00:00:00.000Z' });
  });

  it('after: none when the last hotspot is not in the past', () => {
    expect(afterWindow('2025-08-01T00:00:00Z', new Date('2025-08-01T00:00:00Z'))).toBeNull();
  });

  it('activity window and interval string', () => {
    const w = activityWindow('2025-07-20T05:00:00Z', '2025-07-22T18:30:00Z');
    expect(toInterval(w)).toBe('2025-07-20T05:00:00.000Z/2025-07-22T18:30:00.000Z');
  });
});

describe('orderCandidates', () => {
  const a = scene({ id: 'S2A_T48UUE_20250701T043045_L2A', datetime: '2025-07-01T04:33:00Z', cloudCover: 10 });
  const b = scene({ id: 'S2B_T48UUE_20250706T043045_L2A', datetime: '2025-07-06T04:33:00Z', cloudCover: 50 });
  const bNeighbour = scene({ id: 'S2B_T48UVE_20250706T043045_L2A', datetime: '2025-07-06T04:33:05Z', cloudCover: 5 });
  const c = scene({ id: 'S2C_T48UUE_20250711T043045_L2A', datetime: '2025-07-11T04:33:00Z', cloudCover: 1 });

  it('newest first for "before"', () => {
    expect(orderCandidates([a, c, b], 'desc').map(s => s.id)).toEqual([c.id, b.id, a.id]);
  });

  it('earliest first for "after"', () => {
    expect(orderCandidates([c, a, b], 'asc').map(s => s.id)).toEqual([a.id, b.id, c.id]);
  });

  it('same acquisition on neighbouring tiles: the less cloudy tile first', () => {
    expect(orderCandidates([b, bNeighbour], 'desc').map(s => s.id)).toEqual([bNeighbour.id, b.id]);
    expect(orderCandidates([b, bNeighbour], 'asc').map(s => s.id)).toEqual([bNeighbour.id, b.id]);
  });

  it('drops duplicates and keeps at most the limit', () => {
    expect(orderCandidates([a, a, b, c], 'asc', 2).map(s => s.id)).toEqual([a.id, b.id]);
  });
});

describe('sclStats', () => {
  it('counts class 2 (dark area — burn scars) and vegetation as clear', () => {
    const s = sclStats(scl({ 2: 30, 4: 50, 5: 10, 6: 5, 7: 5 }));
    expect(s).toMatchObject({ total: 100, clear: 100 });
    expect(clearFraction(s)).toBe(1);
  });

  it('snow, clouds, cirrus, shadows, saturation and nodata are not clear', () => {
    const s = sclStats(scl({ 0: 1, 1: 2, 3: 3, 8: 4, 9: 5, 10: 6, 11: 7, 4: 72 }));
    expect(s).toEqual({ total: 100, clear: 72, nodata: 1, saturated: 2, shadow: 3, cloud: 15, snow: 7 });
  });

  it('isUsable: ≥ 80 % clear and ≤ 5 % nodata', () => {
    expect(isUsable(sclStats(scl({ 4: 80, 9: 20 })))).toBe(true);
    expect(isUsable(sclStats(scl({ 4: 79, 9: 21 })))).toBe(false);
    expect(isUsable(sclStats(scl({ 4: 94, 0: 6 })))).toBe(false); // edge of the swath
    expect(isUsable(sclStats(scl({ 4: 90, 11: 10 })))).toBe(true);
    expect(isUsable(sclStats(scl({ 4: 70, 11: 30 })))).toBe(false); // snow is not clear
    expect(isUsable(sclStats([]))).toBe(false);
    expect(nodataFraction(sclStats(scl({ 0: 5, 4: 95 })))).toBeCloseTo(0.05);
  });

  it('clearPct floors, so a failing 79.9 % never reads as 80 %', () => {
    expect(clearPct(sclStats(scl({ 4: 799, 9: 201 })))).toBe(79);
    expect(clearPct(sclStats(scl({ 4: 100 })))).toBe(100);
  });
});

describe('mostlySnow and none reasons', () => {
  const snowy = sclStats(scl({ 11: 60, 4: 30, 9: 10 }));
  const cloudy = sclStats(scl({ 9: 60, 4: 40 }));
  const offSwath = sclStats(scl({ 0: 50, 11: 50 }));

  it('snow wins when it spoils most covered candidates', () => {
    expect(mostlySnow([snowy, snowy, cloudy])).toBe(true);
    expect(mostlySnow([snowy, cloudy])).toBe(false);
    expect(mostlySnow([offSwath])).toBe(false); // not covered → not counted
    expect(mostlySnow([])).toBe(false);
  });

  it('before: cloudy or snow', () => {
    expect(beforeNoneReason([])).toBe(NONE_REASONS.beforeCloudy);
    expect(beforeNoneReason([cloudy])).toBe(NONE_REASONS.beforeCloudy);
    expect(beforeNoneReason([snowy])).toBe(NONE_REASONS.snow);
    expect(NONE_REASONS.beforeCloudy).toBe('нет безоблачных снимков за 60 дней до обнаружения');
  });

  it('after: no scenes yet, cloudy or snow', () => {
    expect(afterNoneReason(0, [])).toBe('снимков после обнаружения ещё нет');
    expect(afterNoneReason(3, [cloudy, cloudy, cloudy])).toBe(NONE_REASONS.afterCloudy);
    expect(afterNoneReason(2, [snowy, snowy])).toBe('участок под снегом');
  });
});

describe('pickScene', () => {
  const s1 = scene({ id: 'S2A_T48UUE_20250701T043045_L2A' });
  const s2 = scene({ id: 'S2B_T48UUE_20250706T043045_L2A' });
  const s3 = scene({ id: 'S2C_T48UUE_20250711T043045_L2A' });
  const stats: Record<string, SclStats> = {
    [s1.id]: sclStats(scl({ 9: 50, 4: 50 })),
    [s2.id]: sclStats(scl({ 4: 95, 9: 5 })),
    [s3.id]: sclStats(scl({ 4: 100 })),
  };

  it('returns the first usable candidate and stops reading', async () => {
    const read = jest.fn(async (s: typeof s1) => stats[s.id]);
    const r = await pickScene([s1, s2, s3], read);
    expect(r.scene?.id).toBe(s2.id);
    expect(r.stats).toBe(stats[s2.id]);
    expect(r.checked).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('returns null with everything it checked when nothing is usable', async () => {
    const r = await pickScene([s1], async () => stats[s1.id]);
    expect(r).toEqual({ scene: null, stats: null, checked: [stats[s1.id]] });
  });

  it('propagates read errors (a network failure is not "no clear scene")', async () => {
    await expect(pickScene([s1], async () => { throw new Error('socket hang up'); })).rejects.toThrow('socket hang up');
  });
});
