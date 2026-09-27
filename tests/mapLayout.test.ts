import { COMPACT_MAP_MAX_WIDTH, isCompactMap } from '../frontend/src/map/mapLayout';

describe('isCompactMap', () => {
  it('is compact on phones and not on desktops', () => {
    expect(isCompactMap(375)).toBe(true);
    expect(isCompactMap(COMPACT_MAP_MAX_WIDTH)).toBe(true);
    expect(isCompactMap(COMPACT_MAP_MAX_WIDTH + 1)).toBe(false);
    expect(isCompactMap(1280)).toBe(false);
  });

  it('treats an unknown width as a desktop', () => {
    expect(isCompactMap(NaN)).toBe(false);
  });
});
