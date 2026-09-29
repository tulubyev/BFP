/**
 * GET /api/sources/status data: registry metadata + load journal + data-derived freshness,
 * combined into a computed fresh/stale/failed state per source.
 */
import fs from 'fs';
import { readLastGood } from '../utils/cache';
import { computeAccessState, computeState, worseState, type FreshnessState, type FreshnessThresholds } from '../utils/freshness';
import { lastAttempt, lastSuccess, readAccess, readJournal, type AccessSummary, type JournalEntry } from '../utils/journal';
import { BOUNDARY_DIRS, pickNewestRegionsFile } from './firmsHistory/regions';
import { FIRMS_KEY, newestAcquisition, type FIRMSHotspot } from './firmsService';
import { LOSS_VERSION } from './gfwTileLayers';
import type { QueryablePool } from './incidentsService';
import { OOPT_KEY, type OOPTResult } from './overpassService';
import { checkPostgisStatus } from './postgisStatus';
import { latestDatasetModified } from './rosleskhozService';
import { SOURCE_REGISTRY, type SourceDefinition, type SourceId } from './sourceRegistry';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTH = 30.44 * DAY;

/**
 * Age of the source's own data (publication date, newest acquisition, boundaries version).
 * Only sources with such a signal get a threshold.
 * Rosleshoz publishes annual statistics — a dataset is expected to sit unchanged for the better
 * part of a year, so "stale" only kicks in once it's clearly overdue for the next release, not
 * merely a few months old.
 */
const THRESHOLDS: Partial<Record<SourceId, FreshnessThresholds>> = {
  firms: { staleAfterMs: 4 * HOUR, failedAfterMs: 12 * HOUR },
  oopt: { staleAfterMs: 36 * HOUR, failedAfterMs: 4 * DAY },
  rosleshoz: { staleAfterMs: 400 * DAY, failedAfterMs: 800 * DAY },
  gfw_dist: { staleAfterMs: 10 * DAY, failedAfterMs: 30 * DAY },
  // Rebuilt offline (scripts/boundaries/build.sh), roughly quarterly: overdue after 18 months.
  // Old boundaries are still usable boundaries, so this never escalates to 'failed'.
  osm_boundaries: { staleAfterMs: 18 * MONTH, failedAfterMs: Number.POSITIVE_INFINITY },
};

/**
 * Secondary signal, checked alongside publication-date freshness above: are *we* still able to
 * successfully download the source (from its load journal), independent of how old the upstream
 * publication itself is. Catches an actually broken scraper (meta.csv changed shape, site down)
 * that a lenient annual publication threshold would otherwise mask. Rosleshoz is refreshed every
 * 12h (jobs/refresh.ts); a handful of missed cycles is unremarkable, weeks of them isn't.
 */
const DOWNLOAD_THRESHOLDS: Partial<Record<SourceId, FreshnessThresholds>> = {
  rosleshoz: { staleAfterMs: 3 * DAY, failedAfterMs: 14 * DAY },
};

/**
 * Third signal, for sources we only fetch when a user asks (GFW tiles, the Sentinel-2 catalogue;
 * written by services/sourceAccess.ts): are our requests still reaching the source. Measured over
 * the span we actually saw failing — no requests at all is 'unknown', never 'failed'. A few hours
 * of failures is 'stale' («сбои при обращении»), three days without a single success while
 * requests keep failing is 'failed' («источник недоступен для нас»).
 */
export const ACCESS_THRESHOLDS: Partial<Record<SourceId, FreshnessThresholds>> = {
  gfw_loss: { staleAfterMs: 1 * HOUR, failedAfterMs: 3 * DAY },
  gfw_cover: { staleAfterMs: 1 * HOUR, failedAfterMs: 3 * DAY },
  gfw_dist: { staleAfterMs: 1 * HOUR, failedAfterMs: 3 * DAY },
  sentinel2: { staleAfterMs: 1 * HOUR, failedAfterMs: 3 * DAY },
};

/** Which sources keep a load journal (the background jobs in jobs/refresh.ts, on-demand access records). */
const JOURNALED = new Set<SourceId>(['firms', 'oopt', 'rosleshoz', ...(Object.keys(ACCESS_THRESHOLDS) as SourceId[])]);

/** Extra journals shown with a source: FIRMS history writes (gis.fire_hotspots + incidents). */
const HISTORY_JOURNALS: Partial<Record<SourceId, string>> = { firms: 'firms_history' };

async function firmsFreshness(): Promise<Date | null> {
  const hotspots = await readLastGood<FIRMSHotspot[]>(FIRMS_KEY);
  return hotspots ? newestAcquisition(hotspots) : null;
}

async function ooptFreshness(): Promise<Date | null> {
  const result = await readLastGood<OOPTResult>(OOPT_KEY);
  return result?.fetchedAt ? new Date(result.fetchedAt) : null;
}

const DIST_VERSION_RE = /^v(\d{4})(\d{2})(\d{2})$/;

async function distFreshness(): Promise<Date | null> {
  const version = await readLastGood<string>('gfw:dist:version');
  const m = version ? DIST_VERSION_RE.exec(version) : null;
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const BOUNDARIES_VERSION_RE = /^ru-regions\.(\d{4})-(\d{2})\.geojson$/;

/** "2026-09" from "ru-regions.2026-09.geojson", or null. */
export function boundariesVersionOf(file: string | null): string | null {
  const m = file ? BOUNDARIES_VERSION_RE.exec(file) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}`;
}

/** First day (UTC) of the month a boundaries version was built in. */
export function boundariesVersionDate(version: string | null): Date | null {
  if (!version) return null;
  const date = new Date(`${version}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Newest boundaries version shipped with the app (the file names in `dirs`), or null. */
export function shippedBoundariesVersion(dirs: string[] = BOUNDARY_DIRS): string | null {
  let best: string | null = null;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const version = boundariesVersionOf(pickNewestRegionsFile(names));
    if (version && (!best || version > best)) best = version;
  }
  return best;
}

// The files ship with the image and only change on deploy (= restart)
let boundariesVersionMemo: string | null = null;
function boundariesVersion(): string | null {
  boundariesVersionMemo ??= shippedBoundariesVersion();
  return boundariesVersionMemo;
}

const FRESHNESS_FETCHERS: Partial<Record<SourceId, () => Promise<Date | null>>> = {
  firms: firmsFreshness,
  oopt: ooptFreshness,
  rosleshoz: async () => latestDatasetModified(),
  gfw_dist: distFreshness,
  osm_boundaries: async () => boundariesVersionDate(boundariesVersion()),
};

/** Dataset version shown next to the state ("2026-09" boundaries, "v1.13" loss, DIST-ALERT date). */
const VERSION_FETCHERS: Partial<Record<SourceId, () => Promise<string | null>>> = {
  osm_boundaries: async () => boundariesVersion(),
  gfw_loss: async () => LOSS_VERSION,
  gfw_dist: async () => readLastGood<string>('gfw:dist:version'),
};

export interface SourceJournal {
  lastAttempt: JournalEntry | null;
  lastSuccess: JournalEntry | null;
  runs: JournalEntry[];
}

/**
 * One input to a source's state: 'data' = how old the source's own data is, 'access' = whether we
 * can still download or reach it (Rosleshoz downloads, on-demand GFW/Sentinel-2 requests). The
 * frontend uses the kind to tell «данные устарели» from «источник недоступен для нас».
 */
export interface SourceSignal {
  kind: 'data' | 'access';
  state: FreshnessState;
}

export interface SourceAccessStatus extends AccessSummary {
  state: FreshnessState;
  /** now − lastSuccessAt, for "проверено 5 мин назад" without a client clock. */
  lastSuccessAgeMs: number | null;
}

export interface SourceStatus {
  id: SourceId;
  name: string;
  owner: string;
  license: SourceDefinition['license'];
  homepage: string;
  updateFrequency: string;
  spatialResolution: string;
  coverage: string;
  limitations: string[];
  cadence: SourceDefinition['cadence'] | null;
  state: FreshnessState;
  freshness: { timestamp: string; ageMs: number } | null;
  journal: SourceJournal | null;
  /** Journal of the history job that stores this source in the database, if any. */
  historyJournal?: SourceJournal | null;
  /** The signals `state` is the worst of (empty = no signal, state 'unknown'). */
  signals: SourceSignal[];
  /** On-demand access record (GFW tiles, Sentinel-2 catalogue); null when none was ever made. */
  access?: SourceAccessStatus | null;
  /** Dataset version, where the app knows it. */
  version?: string | null;
}

/**
 * `postgisPool` is optional and only meaningful for the 'postgis' source: without it (e.g. an
 * existing caller that hasn't been updated, or a test) postgis simply stays 'unknown' as before.
 * Passed in rather than imported here so this module — and its tests — never need a real database
 * connection; the route wires the real pool (see routes/sources.ts).
 */
export async function getSourceStatus(
  def: SourceDefinition,
  now: Date = new Date(),
  postgisPool?: QueryablePool,
): Promise<SourceStatus> {
  if (def.id === 'postgis') {
    return getPostgisStatus(def, now, postgisPool);
  }

  const fetchFreshness = FRESHNESS_FETCHERS[def.id];
  const timestamp = fetchFreshness ? await fetchFreshness().catch(() => null) : null;
  const ageMs = timestamp ? now.getTime() - timestamp.getTime() : null;
  const signals: SourceSignal[] = [];
  const thresholds = THRESHOLDS[def.id];
  if (thresholds) signals.push({ kind: 'data', state: computeState(ageMs, thresholds) });

  let journal: SourceJournal | null = null;
  if (JOURNALED.has(def.id)) {
    const runs = await readJournal(def.id);
    journal = { lastAttempt: lastAttempt(runs), lastSuccess: lastSuccess(runs), runs };
  }
  const historySource = HISTORY_JOURNALS[def.id];
  let historyJournal: SourceJournal | undefined;
  if (historySource) {
    const runs = await readJournal(historySource);
    historyJournal = { lastAttempt: lastAttempt(runs), lastSuccess: lastSuccess(runs), runs };
  }

  const downloadThresholds = DOWNLOAD_THRESHOLDS[def.id];
  if (downloadThresholds && journal) {
    const successAt = journal.lastSuccess ? new Date(journal.lastSuccess.finishedAt).getTime() : null;
    const downloadAgeMs = successAt !== null ? now.getTime() - successAt : null;
    signals.push({ kind: 'access', state: computeState(downloadAgeMs, downloadThresholds) });
  }

  const accessThresholds = ACCESS_THRESHOLDS[def.id];
  let access: SourceAccessStatus | null | undefined;
  if (accessThresholds) {
    const summary = await readAccess(def.id);
    const accessState = computeAccessState(summary, accessThresholds);
    signals.push({ kind: 'access', state: accessState });
    const successMs = summary?.lastSuccessAt ? Date.parse(summary.lastSuccessAt) : NaN;
    access = summary
      ? { ...summary, state: accessState, lastSuccessAgeMs: Number.isNaN(successMs) ? null : Math.max(0, now.getTime() - successMs) }
      : null;
  }

  const state = signals.reduce<FreshnessState>((worst, signal) => worseState(worst, signal.state), 'unknown');
  const fetchVersion = VERSION_FETCHERS[def.id];
  const version = fetchVersion ? await fetchVersion().catch(() => null) : undefined;

  return {
    id: def.id,
    name: def.name,
    owner: def.owner,
    license: def.license,
    homepage: def.homepage,
    updateFrequency: def.updateFrequency,
    spatialResolution: def.spatialResolution,
    coverage: def.coverage,
    limitations: def.limitations,
    cadence: def.cadence ?? null,
    state,
    freshness: timestamp ? { timestamp: timestamp.toISOString(), ageMs: ageMs as number } : null,
    journal,
    ...(historyJournal ? { historyJournal } : {}),
    signals,
    ...(access !== undefined ? { access } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}

async function getPostgisStatus(def: SourceDefinition, now: Date, postgisPool?: QueryablePool): Promise<SourceStatus> {
  const common = {
    id: def.id,
    name: def.name,
    owner: def.owner,
    license: def.license,
    homepage: def.homepage,
    updateFrequency: def.updateFrequency,
    spatialResolution: def.spatialResolution,
    coverage: def.coverage,
    limitations: def.limitations,
    cadence: def.cadence ?? null,
    journal: null,
  };

  if (!postgisPool) {
    return { ...common, state: 'unknown', freshness: null, signals: [] };
  }

  const check = await checkPostgisStatus(postgisPool);
  if (!check.reachable) {
    return { ...common, state: 'failed', freshness: null, signals: [{ kind: 'access', state: 'failed' }] };
  }
  const freshness = check.newestRecordAt
    ? { timestamp: check.newestRecordAt.toISOString(), ageMs: now.getTime() - check.newestRecordAt.getTime() }
    : null;
  return { ...common, state: 'fresh', freshness, signals: [{ kind: 'access', state: 'fresh' }] };
}

export async function getAllSourcesStatus(now: Date = new Date(), postgisPool?: QueryablePool): Promise<SourceStatus[]> {
  return Promise.all(SOURCE_REGISTRY.map(def => getSourceStatus(def, now, postgisPool)));
}
