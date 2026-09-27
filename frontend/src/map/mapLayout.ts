/**
 * Map chrome on narrow screens: on a phone the expanded layer list and the legend would cover most
 * of the map, so both start collapsed there (the layer list opens from its icon, the legend from
 * its title).
 */
export const COMPACT_MAP_MAX_WIDTH = 640;

export function isCompactMap(viewportWidth: number): boolean {
  return Number.isFinite(viewportWidth) && viewportWidth <= COMPACT_MAP_MAX_WIDTH;
}
