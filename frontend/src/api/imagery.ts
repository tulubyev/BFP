/**
 * Sentinel-2 before/after images of an incident with NDVI/NBR indices
 * (GET /api/monitoring/forest-changes/:id/imagery) and its summer NDVI series (…/:id/ndvi-series).
 */

export type ImageryRender = 'truecolor' | 'swir' | 'ndvi';

export type ImagerySide =
  | {
    status: 'ok';
    sceneId: string;
    datetime: string;
    /** "Sentinel-2A" / "Sentinel-2B" / "Sentinel-2C" */
    platform: string;
    /** Clear pixels over the area by the scene classification, whole percent. */
    clearPct: number;
    /** The scene was taken while the incident was still producing hotspots. */
    duringActivity?: boolean;
    /** Same-origin paths; prefix with the CDN origin (imageUrl). */
    urls: Record<ImageryRender, string>;
  }
  | { status: 'none'; reason: string };

export type SeverityClass = 'unburned' | 'low' | 'moderate-low' | 'moderate-high' | 'high';

export interface IndexSide {
  /** Mean over the site; null when fewer than half of its pixels are clear. */
  ndvi: number | null;
  nbr: number | null;
  validPct: number;
}

export interface IncidentIndices {
  before: IndexSide | null;
  after: IndexSide | null;
  dNdvi: number | null;
  dNbr: number | null;
  severity: { class: SeverityClass; label: string } | null;
  reasons: string[];
  site: [number, number, number, number];
  note: string;
}

export interface IncidentImagery {
  incidentId: number;
  aoi: [number, number, number, number];
  before: ImagerySide;
  after: ImagerySide;
  indices: IncidentIndices;
  source: { name: string; url: string; license: string; attribution: string };
  generatedAt: string;
}

export class ImageryApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ImageryApiError';
    this.status = status;
  }
}

export async function getIncidentImagery(id: number, signal?: AbortSignal): Promise<IncidentImagery> {
  const response = await fetch(`/api/monitoring/forest-changes/${id}/imagery`, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ImageryApiError(body?.error || 'Не удалось подобрать снимки', response.status);
  return body as IncidentImagery;
}

export interface RegionNdvi {
  ndvi: number | null;
  validPct: number;
}

export type SeriesYear =
  | {
    year: number;
    status: 'ok';
    sceneId: string;
    datetime: string;
    platform: string;
    clearPct: number;
    site: RegionNdvi;
    background: RegionNdvi;
    partial?: boolean;
  }
  | { year: number; status: 'none'; reason: string; partial?: boolean };

export interface NdviSeries {
  incidentId: number;
  status: 'ready' | 'pending';
  years: SeriesYear[];
  progress: { done: number; total: number };
  failedYears?: number[];
  aoi: [number, number, number, number];
  site: [number, number, number, number];
  window: { start: string; end: string };
  source: { name: string; url: string; license: string; attribution: string };
  generatedAt: string;
}

export async function getNdviSeries(id: number, signal?: AbortSignal): Promise<NdviSeries> {
  const response = await fetch(`/api/monitoring/forest-changes/${id}/ndvi-series`, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ImageryApiError(body?.error || 'Не удалось получить ряд NDVI', response.status);
  return body as NdviSeries;
}
