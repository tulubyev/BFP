/**
 * Map chrome on narrow screens: on a phone the expanded layer list and the legend would cover most
 * of the map, so both start collapsed there (the layer list opens from its icon, the legend from
 * its title).
 */
export const COMPACT_MAP_MAX_WIDTH = 640;

export function isCompactMap(viewportWidth: number): boolean {
  return Number.isFinite(viewportWidth) && viewportWidth <= COMPACT_MAP_MAX_WIDTH;
}

/**
 * Mouse wheel / trackpad zoom, gentler than Leaflet's defaults (60 px per level, 1 level per notch):
 * a notch now zooms half a level (zoomSnap 0.5) and a bit more scrolling is needed per level.
 * The +/- buttons still step a whole level (zoomDelta 1). The URL keeps an integer `z` (rounded).
 */
export const MAP_ZOOM_OPTIONS = {
  zoomSnap: 0.5,
  zoomDelta: 1,
  wheelPxPerZoomLevel: 200,
  wheelDebounceTime: 60,
} as const;

/** Zoom as written to the URL and compared with it: whole levels. */
export function wholeZoom(zoom: number): number {
  return Math.round(zoom);
}

/** Collapsed/expanded state of the map's info panels, remembered per panel in localStorage. */
export type PanelId = 'layers' | 'legend' | 'sources';
export const PANEL_IDS: readonly PanelId[] = ['layers', 'legend', 'sources'];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const panelStorageKey = (id: PanelId) => `forestwatch.map.panel.${id}`;

/** Saved state, or `fallback` when nothing valid is saved or storage is unavailable (private mode). */
export function readPanelCollapsed(id: PanelId, fallback: boolean, storage?: StorageLike | null): boolean {
  try {
    const value = storage?.getItem(panelStorageKey(id));
    return value === '1' ? true : value === '0' ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writePanelCollapsed(id: PanelId, collapsed: boolean, storage?: StorageLike | null): void {
  try {
    storage?.setItem(panelStorageKey(id), collapsed ? '1' : '0');
  } catch {
    // storage full or blocked: the panel just starts in its default state next time
  }
}

/** Default: on a phone everything starts folded, on a desktop everything is open. */
export function defaultPanelCollapsed(viewportWidth: number): boolean {
  return isCompactMap(viewportWidth);
}
