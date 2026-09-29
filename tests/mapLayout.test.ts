import {
  COMPACT_MAP_MAX_WIDTH, MAP_ZOOM_OPTIONS, defaultPanelCollapsed, isCompactMap, panelStorageKey, readPanelCollapsed,
  wholeZoom, writePanelCollapsed, type StorageLike,
} from '../frontend/src/map/mapLayout';

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

describe('wheel zoom options', () => {
  it('are gentler than the Leaflet defaults but keep whole-level buttons', () => {
    expect(MAP_ZOOM_OPTIONS.wheelPxPerZoomLevel).toBeGreaterThan(60);
    expect(MAP_ZOOM_OPTIONS.zoomSnap).toBe(0.5);
    expect(MAP_ZOOM_OPTIONS.zoomDelta).toBe(1);
  });

  it('the URL and comparisons use whole levels', () => {
    expect(wholeZoom(8.5)).toBe(9);
    expect(wholeZoom(8.49)).toBe(8);
    expect(wholeZoom(9)).toBe(9);
  });
});

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

describe('panel collapsed state', () => {
  it('starts folded on phones and open on desktops', () => {
    expect(defaultPanelCollapsed(375)).toBe(true);
    expect(defaultPanelCollapsed(1280)).toBe(false);
  });

  it('remembers what the user chose, per panel', () => {
    const storage = memoryStorage();
    writePanelCollapsed('legend', true, storage);
    writePanelCollapsed('sources', false, storage);
    expect(storage.data[panelStorageKey('legend')]).toBe('1');
    expect(readPanelCollapsed('legend', false, storage)).toBe(true);
    expect(readPanelCollapsed('sources', true, storage)).toBe(false);
    expect(readPanelCollapsed('layers', true, storage)).toBe(true); // nothing saved: fallback
  });

  it('ignores garbage and survives blocked storage', () => {
    expect(readPanelCollapsed('legend', true, memoryStorage({ [panelStorageKey('legend')]: 'maybe' }))).toBe(true);
    const blocked: StorageLike = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    expect(readPanelCollapsed('legend', false, blocked)).toBe(false);
    expect(() => writePanelCollapsed('legend', true, blocked)).not.toThrow();
    expect(readPanelCollapsed('legend', true, null)).toBe(true);
    expect(() => writePanelCollapsed('legend', true, undefined)).not.toThrow();
  });
});
