/**
 * Sentinel-2 before/after images for incidents: scene selection (STAC search + SCL check over the
 * AOI), NDVI/NBR indices over the incident site for the picked scenes, and rendering of one image.
 * All I/O comes in through `ImageryDeps`, so tests run offline.
 */
import proj4 from 'proj4';
import { readToGrid, type OpenCog } from './cog';
import {
  bboxIntersects, clipBbox, expandAoi, padBbox, planGrid, projectBbox, toGridPixel, utmProjDef,
  type Bbox, type Grid, type Project,
} from './geometry';
import {
  INDEX_MAX_SIDE, INDEX_PIXEL_M, SITE_PAD_KM, combineIndices, polygonMask, regionIndexStats, subtractMask,
  type IncidentIndices, type RegionIndexStats,
} from './indices';
import { RENDERS, encodePng, ndviRgba, outlineSvg, reflectanceScale, swirRgba, truecolorRgba, type Render } from './render';
import { imagePath } from './request';
import {
  MAX_CANDIDATES, MAX_SEARCH_CLOUD_COVER, activityWindow, afterNoneReason, afterWindow, beforeNoneReason, beforeWindow,
  clearPct, orderCandidates, pickScene, sclStats, toInterval, type SclStats, type TimeWindow,
} from './selection';
import { STAC_API_URL, platformLabel, type S2AssetKey, type S2Scene, type StacClient } from './stac';

export interface ImageryDeps {
  stac: StacClient;
  openCog: OpenCog;
  now?: () => Date;
  /** Wraps each COG read (concurrency limit); identity by default. */
  schedule?: <T>(task: () => Promise<T>) => Promise<T>;
}

/** An incident as the imagery needs it; first/last seen are ISO timestamps. */
export interface IncidentGeo {
  id: number;
  bbox: Bbox;
  firstSeen: string;
  lastSeen: string;
  /** False when `bbox` is only the centre point (not a FIRMS incident): no NDVI series then. */
  hasBbox?: boolean;
}

export type ImagerySide =
  | {
    status: 'ok';
    sceneId: string;
    datetime: string;
    platform: string;
    /** Clear pixels over the AOI, whole percent (SCL). */
    clearPct: number;
    duringActivity?: true;
    urls: Record<Render, string>;
  }
  | { status: 'none'; reason: string };

export interface IncidentImagery {
  incidentId: number;
  aoi: Bbox;
  before: ImagerySide;
  after: ImagerySide;
  /** NDVI/NBR over the incident site for the two scenes, ΔNDVI, dNBR and its USGS class. */
  indices: IncidentIndices;
  source: { name: string; url: string; license: string; attribution: string };
  generatedAt: string;
}

export const SOURCE_NAME = 'Copernicus Sentinel-2 L2A (Collection 1), каталог Earth Search (Element 84), AWS Open Data';
export const LICENSE = 'Copernicus Sentinel data — свободная и открытая лицензия';
/** SCL is a 20 m band; checking it on a coarser grid is enough for a clear share. */
const SCL_MAX_SIDE = 256;

export function attributionFor(years: number[]): string {
  const unique = [...new Set(years)].sort();
  return `Contains modified Copernicus Sentinel data ${unique.join(', ')}`.trim();
}

export function projectorFor(epsg: number): Project {
  const converter = proj4('EPSG:4326', utmProjDef(epsg));
  return p => converter.forward(p) as [number, number];
}

/** Output grid of a scene over an AOI (the AOI's envelope in the scene's UTM zone). */
export function sceneGrid(epsg: number, aoi: Bbox, maxSide?: number, minPixel?: number): { grid: Grid; project: Project } {
  const project = projectorFor(epsg);
  return { grid: planGrid(projectBbox(aoi, project), maxSide, minPixel), project };
}

const run = <T>(deps: ImageryDeps, task: () => Promise<T>) => (deps.schedule ? deps.schedule(task) : task());

export async function readSceneScl(scene: S2Scene, aoi: Bbox, deps: ImageryDeps, signal?: AbortSignal): Promise<SclStats> {
  const href = scene.assets.scl?.href;
  if (!href) throw new Error(`${scene.id}: no scl asset`);
  const { grid } = sceneGrid(scene.epsg, aoi, SCL_MAX_SIDE, 20);
  const [scl] = await run(deps, async () => readToGrid(await deps.openCog(href, signal), grid, 'nearest', signal));
  return sclStats(scl);
}

function okSide(scene: S2Scene, stats: SclStats, outline: Bbox, duringActivity: boolean): ImagerySide {
  return {
    status: 'ok',
    sceneId: scene.id,
    datetime: scene.datetime,
    platform: platformLabel(scene),
    clearPct: clearPct(stats),
    ...(duringActivity ? { duringActivity: true as const } : {}),
    urls: Object.fromEntries(RENDERS.map(r => [r, imagePath(scene.id, r, outline)])) as Record<Render, string>,
  };
}

/** Grid and region masks for index statistics of one scene: the site and the ring around it (AOI minus site). */
export interface IndexPlan {
  grid: Grid;
  site: Uint8Array;
  ring: Uint8Array;
}

export function indexPlan(epsg: number, aoi: Bbox, site: Bbox): IndexPlan {
  const { grid, project } = sceneGrid(epsg, aoi, INDEX_MAX_SIDE, INDEX_PIXEL_M);
  const corners = (b: Bbox) => ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as [number, number][])
    .map(p => toGridPixel(project(p), grid));
  const siteMask = polygonMask(grid, corners(site));
  return { grid, site: siteMask, ring: subtractMask(polygonMask(grid, corners(aoi)), siteMask) };
}

/** Site of an incident for index statistics: bbox of hotspot centres + half a VIIRS pixel, cut to the AOI. */
export const incidentSite = (bbox: Bbox, aoi: Bbox): Bbox => clipBbox(padBbox(bbox, SITE_PAD_KM), aoi);

/** One band of a scene on the grid (nearest neighbour: statistics, not a picture), behind deps.schedule. */
export async function readSceneBand(
  scene: S2Scene, key: S2AssetKey, grid: Grid, deps: ImageryDeps, signal?: AbortSignal,
): Promise<Float32Array> {
  const href = scene.assets[key]?.href;
  if (!href) throw new Error(`${scene.id}: no ${key} asset`);
  const [band] = await run(deps, async () => readToGrid(await deps.openCog(href, signal), grid, 'nearest', signal));
  return band;
}

/**
 * Index statistics of a scene over the site and the ring. `scl` may be passed when already read on
 * `plan.grid`; NBR (B12) only with `nbr: true`.
 */
export async function readSceneIndices(
  scene: S2Scene, plan: IndexPlan, deps: ImageryDeps, opts: { nbr: boolean; scl?: Float32Array; signal?: AbortSignal },
): Promise<{ site: RegionIndexStats; ring: RegionIndexStats }> {
  const read = (key: S2AssetKey) => readSceneBand(scene, key, plan.grid, deps, opts.signal);
  const [scl, red, nir, swir] = await Promise.all([
    opts.scl ?? read('scl'), read('red'), read('nir08'), opts.nbr ? read('swir22') : undefined,
  ]);
  const bands = { red, nir, scl, ...(swir ? { swir } : {}) };
  const scales = {
    red: reflectanceScale(scene.assets.red?.['raster:bands']),
    nir: reflectanceScale(scene.assets.nir08?.['raster:bands']),
    ...(swir ? { swir: reflectanceScale(scene.assets.swir22?.['raster:bands']) } : {}),
  };
  return { site: regionIndexStats(bands, scales, plan.site), ring: regionIndexStats(bands, scales, plan.ring) };
}

async function candidates(deps: ImageryDeps, aoi: Bbox, window: TimeWindow, sort: 'asc' | 'desc'): Promise<S2Scene[]> {
  const found = await deps.stac.search({
    bbox: aoi, datetime: toInterval(window), sort, limit: MAX_CANDIDATES, maxCloudCover: MAX_SEARCH_CLOUD_COVER,
  });
  return orderCandidates(found, sort);
}

export async function getIncidentImagery(incident: IncidentGeo, deps: ImageryDeps): Promise<IncidentImagery> {
  const now = deps.now?.() ?? new Date();
  const aoi = expandAoi(incident.bbox);
  // The outline in image URLs: the incident bbox, cut to the AOI when the incident is > 20 km
  const outline = clipBbox(incident.bbox, aoi);
  const readScl = (scene: S2Scene) => readSceneScl(scene, aoi, deps);

  type Picked = { side: ImagerySide; scene: S2Scene | null };
  const beforeSide = async (): Promise<Picked> => {
    const picked = await pickScene(await candidates(deps, aoi, beforeWindow(incident.firstSeen), 'desc'), readScl);
    return picked.scene && picked.stats
      ? { side: okSide(picked.scene, picked.stats, outline, false), scene: picked.scene }
      : { side: { status: 'none', reason: beforeNoneReason(picked.checked) }, scene: null };
  };

  const afterSide = async (): Promise<Picked> => {
    const window = afterWindow(incident.lastSeen, now);
    const after = window ? await candidates(deps, aoi, window, 'asc') : [];
    const picked = await pickScene(after, readScl);
    if (picked.scene && picked.stats) return { side: okSide(picked.scene, picked.stats, outline, false), scene: picked.scene };
    // Nothing usable after the last hotspot: the newest scene while the incident was burning
    const during = await candidates(deps, aoi, activityWindow(incident.firstSeen, incident.lastSeen), 'desc');
    const pickedDuring = await pickScene(during, readScl);
    if (pickedDuring.scene && pickedDuring.stats) {
      return { side: okSide(pickedDuring.scene, pickedDuring.stats, outline, true), scene: pickedDuring.scene };
    }
    const reason = afterNoneReason(after.length + during.length, [...picked.checked, ...pickedDuring.checked]);
    return { side: { status: 'none', reason }, scene: null };
  };

  const [b, a] = await Promise.all([beforeSide(), afterSide()]);
  const before = b.side;
  const after = a.side;
  // Indices over the site; a read failure rejects, so the selection is not cached without them
  const site = incidentSite(incident.bbox, aoi);
  const siteStats = async (scene: S2Scene | null) =>
    (scene ? (await readSceneIndices(scene, indexPlan(scene.epsg, aoi, site), deps, { nbr: true })).site : null);
  const [beforeStats, afterStats] = await Promise.all([siteStats(b.scene), siteStats(a.scene)]);
  const indices = combineIndices(beforeStats, afterStats, after.status === 'ok' && after.duringActivity === true, site);
  const years = [before, after].flatMap(s => (s.status === 'ok' ? [new Date(s.datetime).getUTCFullYear()] : []));
  return {
    incidentId: incident.id,
    aoi,
    before,
    after,
    indices,
    source: {
      name: SOURCE_NAME,
      url: STAC_API_URL,
      license: LICENSE,
      attribution: attributionFor(years.length ? years : [now.getUTCFullYear()]),
    },
    generatedAt: now.toISOString(),
  };
}

export function sceneCovers(scene: Pick<S2Scene, 'bbox'>, bbox: Bbox): boolean {
  return bboxIntersects(scene.bbox, bbox);
}

/** Renders one image: the AOI derived from `outline`, north-up in the scene's UTM zone, with the outline drawn. */
export async function renderScenePng(
  scene: S2Scene, render: Render, outline: Bbox, deps: ImageryDeps, signal?: AbortSignal,
): Promise<Buffer> {
  const aoi = expandAoi(outline);
  const { grid, project } = sceneGrid(scene.epsg, aoi);
  const open = (key: 'visual' | 'swir22' | 'nir08' | 'red' | 'scl') => {
    const href = scene.assets[key]?.href;
    if (!href) throw new Error(`${scene.id}: no ${key} asset`);
    return deps.openCog(href, signal);
  };

  let rgba: Buffer;
  if (render === 'truecolor') {
    const [r, g, b] = await readToGrid(await open('visual'), grid, 'bilinear', signal);
    if (!g || !b) throw new Error(`${scene.id}: visual asset is not RGB`);
    rgba = truecolorRgba(r, g, b);
  } else if (render === 'ndvi') {
    const [[red], [nir], [scl]] = await Promise.all([
      readToGrid(await open('red'), grid, 'bilinear', signal),
      readToGrid(await open('nir08'), grid, 'bilinear', signal),
      readToGrid(await open('scl'), grid, 'nearest', signal),
    ]);
    rgba = ndviRgba(red, nir, scl, [
      reflectanceScale(scene.assets.red?.['raster:bands']),
      reflectanceScale(scene.assets.nir08?.['raster:bands']),
    ]);
  } else {
    const [[b12], [b8a], [b04]] = await Promise.all(
      (['swir22', 'nir08', 'red'] as const).map(async key => readToGrid(await open(key), grid, 'bilinear', signal)),
    );
    rgba = swirRgba(b12, b8a, b04, [
      reflectanceScale(scene.assets.swir22?.['raster:bands']),
      reflectanceScale(scene.assets.nir08?.['raster:bands']),
      reflectanceScale(scene.assets.red?.['raster:bands']),
    ]);
  }

  const corners = ([[outline[0], outline[1]], [outline[2], outline[1]], [outline[2], outline[3]], [outline[0], outline[3]]] as [number, number][])
    .map(p => toGridPixel(project(p), grid));
  return encodePng(rgba, grid.width, grid.height, outlineSvg(grid.width, grid.height, corners));
}
