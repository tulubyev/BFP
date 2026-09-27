/** Data exports (backend/routes/export.ts): URL building and a fetch-based download. */
import { buildIncidentQuery, type IncidentFilters } from './incidents';

/** Rows one incidents export may hold; must match EXPORT_LIMIT in backend/services/export/provenance.ts (tested). */
export const EXPORT_LIMIT = 5000;

export type IncidentsExportFormat = 'csv' | 'geojson' | 'json';
export type RegionsExportFormat = 'csv' | 'json';

export const INCIDENT_EXPORT_FORMATS: { format: IncidentsExportFormat; label: string }[] = [
  { format: 'csv', label: 'CSV' },
  { format: 'geojson', label: 'GeoJSON' },
  { format: 'json', label: 'JSON' },
];

export const REGION_EXPORT_FORMATS: { format: RegionsExportFormat; label: string }[] = [
  { format: 'csv', label: 'CSV' },
  { format: 'json', label: 'JSON' },
];

/** Export URL with the page's current filters — the feed's query without pagination. */
export function incidentsExportUrl(format: IncidentsExportFormat, filters: IncidentFilters = {}): string {
  const params = buildIncidentQuery(filters);
  params.delete('limit');
  params.delete('offset');
  return `/api/export/incidents.${format}?${params}`;
}

export function regionsExportUrl(format: RegionsExportFormat): string {
  return `/api/export/regions.${format}`;
}

/** File name from `Content-Disposition: attachment; filename="..."`, else the fallback. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="?([^";]+)"?/i.exec(header) : null;
  return match ? match[1] : fallback;
}

export type DownloadResult = { ok: true } | { ok: false; error: string };

/**
 * Downloads an export through fetch(), so a 413 (too many rows) or 503 (database down) is shown as
 * a message instead of being saved as a file.
 */
export async function downloadExport(url: string, fallbackName: string): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return { ok: false, error: 'Сервер недоступен — выгрузка не удалась' };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: false, error: body?.error || `Выгрузка не удалась (HTTP ${response.status})` };
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return { ok: true };
}
