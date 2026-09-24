import { inBbox } from '../../backend/services/firmsService';

const RUSSIA = { west: 19, south: 40, east: 190, north: 82 };

describe('inBbox', () => {
  it('keeps points inside an ordinary box', () => {
    expect(inBbox(52.2, 104.3, RUSSIA)).toBe(true);
    expect(inBbox(35, 104.3, RUSSIA)).toBe(false);
    expect(inBbox(52.2, 10, RUSSIA)).toBe(false);
  });

  it('wraps across the antimeridian for boxes that extend past 180° (Chukotka)', () => {
    expect(inBbox(65.5, -172.5, RUSSIA)).toBe(true);
    expect(inBbox(65.5, -150, RUSSIA)).toBe(false);
  });
});
