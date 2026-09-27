/**
 * Sentinel-2 before/after images for incidents: scene selection (STAC search + SCL check over the
 * AOI) and rendering of one image. All I/O comes in through `ImageryDeps`, so tests run offline.
 */
import proj4 from 'proj4';
import { readToGrid, type OpenCog } from './cog';
import {
  bboxIntersects, clipBbox, expandAoi, planGrid, projectBbox, toGridPixel, utmProjDef,
  type Bbox, type Grid, type Project,
} from './geometry';
import { encodePng, outlineSvg, reflectanceScale, swirRgba, truecolorRgba, type Render } from './render';
import { imagePath } from './request';
import {
  MAX_CANDIDATES, MAX_SEARCH_CLOUD_COVER, activityWindow, afterNoneReason, afterWindow, beforeNoneReason, beforeWindow,
  clearPct, orderCandidates, pickScene, sclStats, toInterval, type SclStats, type TimeWindow,
} from './selection';
import { STAC_API_URL, platformLabel, type S2Scene, type StacClient } from './stac';

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
    urls: { truecolor: imagePath(scene.id, 'truecolor', outline), swir: imagePath(scene.id, 'swir', outline) },
  };
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

  const beforeSide = async (): Promise<ImagerySide> => {
    const picked = await pickScene(await candidates(deps, aoi, beforeWindow(incident.firstSeen), 'desc'), readScl);
    return picked.scene && picked.stats
      ? okSide(picked.scene, picked.stats, outline, false)
      : { status: 'none', reason: beforeNoneReason(picked.checked) };
  };

  const afterSide = async (): Promise<ImagerySide> => {
    const window = afterWindow(incident.lastSeen, now);
    const after = window ? await candidates(deps, aoi, window, 'asc') : [];
    const picked = await pickScene(after, readScl);
    if (picked.scene && picked.stats) return okSide(picked.scene, picked.stats, outline, false);
    // Nothing usable after the last hotspot: the newest scene while the incident was burning
    const during = await candidates(deps, aoi, activityWindow(incident.firstSeen, incident.lastSeen), 'desc');
    const pickedDuring = await pickScene(during, readScl);
    if (pickedDuring.scene && pickedDuring.stats) return okSide(pickedDuring.scene, pickedDuring.stats, outline, true);
    return { status: 'none', reason: afterNoneReason(after.length + during.length, [...picked.checked, ...pickedDuring.checked]) };
  };

  const [before, after] = await Promise.all([beforeSide(), afterSide()]);
  const years = [before, after].flatMap(s => (s.status === 'ok' ? [new Date(s.datetime).getUTCFullYear()] : []));
  return {
    incidentId: incident.id,
    aoi,
    before,
    after,
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
  const open = (key: 'visual' | 'swir22' | 'nir08' | 'red') => {
    const href = scene.assets[key]?.href;
    if (!href) throw new Error(`${scene.id}: no ${key} asset`);
    return deps.openCog(href, signal);
  };

  let rgba: Buffer;
  if (render === 'truecolor') {
    const [r, g, b] = await readToGrid(await open('visual'), grid, 'bilinear', signal);
    if (!g || !b) throw new Error(`${scene.id}: visual asset is not RGB`);
    rgba = truecolorRgba(r, g, b);
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
