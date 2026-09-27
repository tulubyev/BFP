/**
 * Data exports (spec 2026-09-27):
 *   GET /api/export/incidents.csv|.geojson|.json — incidents with the feed's filters, ≤ EXPORT_LIMIT rows
 *   GET /api/export/regions.csv|.json            — regional indicators, one row per region and indicator
 * Every format carries the provenance `metadata` (CSV: X-Export-Metadata header). Read live, never
 * from a cache; when the data is unavailable the answer is 503 with a message, never an empty file.
 */
import { Router, Request, Response } from 'express';
import type { ForestChangesRawQuery } from '../services/forestChangesQuery';
import type { QueryablePool } from '../services/incidentsService';
import type { RegionsService } from '../services/regions/service';
import {
  buildIncidentsMetadata, fetchIncidentsForExport, incidentsToCsv, incidentsToGeoJson, incidentsToJson, toIncidentExportRow,
} from '../services/export/incidentsExport';
import {
  asciiJson, EXPORT_LIMIT, exportDate, loadSourceProvenance, type JournalReader,
} from '../services/export/provenance';
import { buildRegionsMetadata, regionsToCsv, regionsToJson, toRegionRows } from '../services/export/regionsExport';

export interface ExportDeps {
  pool: QueryablePool;
  regions: Pick<RegionsService, 'list'>;
  readJournal: JournalReader;
  /** Year of the FIRMS archive static-cell list in the flare mask, null without one. */
  archiveCellsVersion(): number | null;
  now(): Date;
}

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  geojson: 'application/geo+json; charset=utf-8',
} as const;

type Format = keyof typeof CONTENT_TYPES;

function sendFile(res: Response, name: string, format: Format, generatedAt: string, body: string, metadata: unknown) {
  res.setHeader('Content-Type', CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="forestwatch-${name}-${exportDate(generatedAt)}.${format}"`);
  res.setHeader('Cache-Control', 'no-store');
  if (format === 'csv') {
    res.setHeader('X-Export-Metadata', asciiJson(metadata));
    // Lets the page read the header when the download goes through fetch()
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Metadata, Content-Disposition');
  }
  res.send(body);
}

export function createExportRouter(deps: ExportDeps): Router {
  const router = Router();

  router.get('/incidents.:format(csv|geojson|json)', async (req: Request, res: Response) => {
    const format = req.params.format as Format;
    let result;
    try {
      result = await fetchIncidentsForExport(deps.pool, req.query as ForestChangesRawQuery);
    } catch (err: any) {
      console.error('GET /api/export/incidents failed:', err?.message ?? err);
      return res.status(503).json({
        success: false,
        error: 'База данных недоступна — выгрузка сейчас невозможна. Попробуйте позже.',
      });
    }
    if (!result.ok) {
      return res.status(413).json({
        success: false,
        error: `Под фильтры попадает ${result.total} записей, выгрузка — не больше ${EXPORT_LIMIT}. Сузьте фильтры (регион, тип, даты).`,
        total: result.total,
        limit: EXPORT_LIMIT,
        filters: result.filters,
      });
    }

    const generatedAt = deps.now().toISOString();
    const rows = result.rows.map(toIncidentExportRow);
    const sources = await loadSourceProvenance(['firms', 'osm_boundaries', 'postgis'], deps.readJournal);
    let archiveCellsVersion: number | null = null;
    try {
      archiveCellsVersion = deps.archiveCellsVersion();
    } catch {
      // A missing or unreadable cell list only means "history rule only"
    }
    const metadata = buildIncidentsMetadata({ generatedAt, filters: result.filters, count: rows.length, sources, archiveCellsVersion });

    if (format === 'csv') return sendFile(res, 'incidents', format, generatedAt, incidentsToCsv(rows), metadata);
    const body = format === 'geojson' ? incidentsToGeoJson(metadata, rows) : incidentsToJson(metadata, rows);
    sendFile(res, 'incidents', format, generatedAt, JSON.stringify(body), metadata);
  });

  router.get('/regions.:format(csv|json)', async (req: Request, res: Response) => {
    const format = req.params.format as Format;
    let list;
    try {
      list = await deps.regions.list();
    } catch (err: any) {
      console.error('GET /api/export/regions failed:', err?.message ?? err);
      return res.status(503).json({ success: false, error: 'Региональные данные временно недоступны — выгрузка сейчас невозможна.' });
    }
    if (!list?.regions?.length) {
      return res.status(503).json({ success: false, error: 'Региональные данные временно недоступны — выгрузка сейчас невозможна.' });
    }

    const generatedAt = deps.now().toISOString();
    const rows = toRegionRows(list);
    const sources = await loadSourceProvenance(
      ['rosleshoz', 'firms', 'oopt', 'gfw_loss', 'osm_boundaries', 'postgis'],
      deps.readJournal,
      { firms: list.archive?.file ?? null, osm_boundaries: list.boundariesFile },
    );
    const metadata = buildRegionsMetadata({ generatedAt, list, count: rows.length, sources });

    if (format === 'csv') return sendFile(res, 'regions', format, generatedAt, regionsToCsv(rows), metadata);
    sendFile(res, 'regions', format, generatedAt, JSON.stringify(regionsToJson(metadata, rows)), metadata);
  });

  return router;
}
