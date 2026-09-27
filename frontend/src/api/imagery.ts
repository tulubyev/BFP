/** Sentinel-2 before/after images of an incident (GET /api/monitoring/forest-changes/:id/imagery). */

export type ImageryRender = 'truecolor' | 'swir';

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

export interface IncidentImagery {
  incidentId: number;
  aoi: [number, number, number, number];
  before: ImagerySide;
  after: ImagerySide;
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
