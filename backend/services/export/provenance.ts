/**
 * Provenance block (`metadata`) shared by every data export (spec 2026-09-27, future.md §3: every
 * number has a source, a license and a date). Static source facts come from sourceRegistry.ts, the
 * time of the last successful load from the load journal (utils/journal.ts). The journal reader is
 * injected, so building metadata never needs Redis in tests. No Express here.
 */
import { CLUSTER_DISTANCE_KM, VIIRS_PIXEL_HA, VIIRS_PIXEL_KM } from '../firmsHistory/clusters';
import {
  INACTIVE_AFTER_HOURS, INCIDENT_METHOD, MATCH_DISTANCE_KM, WINDOW_HOURS,
} from '../firmsHistory/incidents';
import { BAIKAL_REGION_ISOS } from '../firmsHistory/regions';
import {
  STATIC_MASK_METHOD, STATIC_MIN_DAYS, STATIC_MIN_SPAN_DAYS, STATIC_RADIUS_KM, STATIC_WINDOW_DAYS,
} from '../firmsHistory/staticSources';
import { getSourceDefinition, type SourceId, type SourceLicense } from '../sourceRegistry';
import type { JournalEntry } from '../../utils/journal';

export const SITE_URL = 'https://forestwatch.ru';
export const METHODOLOGY_URL = `${SITE_URL}/methodology`;
/** Most rows one incidents export may return; above it the API answers 413 instead of truncating. */
export const EXPORT_LIMIT = 5000;

export const FIRMS_INCIDENTS_WARNING =
  'Инциденты FIRMS — кластеры термоточек, не подтверждённые пожары. Термоточка — пиксель со спутниковой тепловой аномалией; причиной могут быть пал, факел или промышленный объект.';
export const FIRMS_AREA_NOTE = 'оценка сверху, пиксели 375 м';
export const COVER_LOSS_WARNING = 'Потеря древесного покрова (GFW/Hansen) не равна незаконной рубке.';

/** Sources whose journal (jobs/refresh.ts) records background loads; the others have no load time. */
const JOURNALED: ReadonlySet<SourceId> = new Set<SourceId>(['firms', 'oopt', 'rosleshoz']);
/** FIRMS is also written to the database by the history job — the load incidents are built from. */
const HISTORY_JOURNALS: Partial<Record<SourceId, string>> = { firms: 'firms_history' };

export type JournalReader = (source: string) => Promise<JournalEntry[]>;

export interface ExportSource {
  id: SourceId;
  name: string;
  owner: string;
  license: SourceLicense;
  homepage: string;
  /** finishedAt of the newest successful background load, null when unknown (no journal, no Redis). */
  lastSuccessfulLoad: string | null;
  /** FIRMS only: newest successful write of hotspots and incidents to the database. */
  lastSuccessfulHistoryWrite?: string | null;
  /** Data file or dataset version used for this export, when there is one. */
  version?: string;
}

function lastSuccessAt(runs: JournalEntry[]): string | null {
  return runs.find(r => r.outcome !== 'failed')?.finishedAt ?? null;
}

async function safeRead(read: JournalReader, source: string): Promise<JournalEntry[]> {
  try {
    return await read(source);
  } catch {
    return [];
  }
}

/** Registry facts + last successful load for each source id, in the given order. */
export async function loadSourceProvenance(
  ids: SourceId[],
  read: JournalReader,
  versions: Partial<Record<SourceId, string | null>> = {},
): Promise<ExportSource[]> {
  return Promise.all(ids.map(async id => {
    const def = getSourceDefinition(id);
    if (!def) throw new Error(`unknown source ${id}`);
    const source: ExportSource = {
      id,
      name: def.name,
      owner: def.owner,
      license: def.license,
      homepage: def.homepage,
      lastSuccessfulLoad: JOURNALED.has(id) ? lastSuccessAt(await safeRead(read, id)) : null,
    };
    const history = HISTORY_JOURNALS[id];
    if (history) source.lastSuccessfulHistoryWrite = lastSuccessAt(await safeRead(read, history));
    const version = versions[id];
    if (version) source.version = version;
    return source;
  }));
}

/** Parameters of the FIRMS incident method, straight from the constants the job uses. */
export function firmsIncidentMethod() {
  return {
    id: INCIDENT_METHOD,
    regions: [...BAIKAL_REGION_ISOS],
    clusterDistanceKm: CLUSTER_DISTANCE_KM,
    windowHours: WINDOW_HOURS,
    matchDistanceKm: MATCH_DISTANCE_KM,
    inactiveAfterHours: INACTIVE_AFTER_HOURS,
    incidentRule: '≥ 2 термоточек или 1 термоточка высокой достоверности',
    area: `оценка сверху: число различных пикселей ${VIIRS_PIXEL_KM * 1000} м × ${VIIRS_PIXEL_HA} га`,
  };
}

/** Parameters of the static heat source (gas flare) mask. */
export function staticMaskMethod(archiveCellsVersion: number | null) {
  return {
    id: STATIC_MASK_METHOD,
    minDays: STATIC_MIN_DAYS,
    windowDays: STATIC_WINDOW_DAYS,
    minSpanDays: STATIC_MIN_SPAN_DAYS,
    radiusKm: STATIC_RADIUS_KM,
    archiveCellsVersion,
  };
}

export interface ExportMetadataBase {
  title: string;
  generatedAt: string;
  count: number;
  sources: ExportSource[];
  methodology: string;
  warnings: string[];
}

/** YYYY-MM-DD (UTC) of an ISO timestamp — the date in download file names. */
export function exportDate(generatedAt: string): string {
  return generatedAt.slice(0, 10);
}

/**
 * JSON for an HTTP header: header values must be ASCII, so every non-ASCII character is written
 * as a \uXXXX escape. The result is still valid JSON that parses back to the same object.
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
