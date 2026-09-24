/**
 * GET /api/sources/status data: registry metadata + load journal + data-derived freshness,
 * combined into a computed fresh/stale/failed state per source.
 */
import { readLastGood } from '../utils/cache';
import { computeState, type FreshnessState, type FreshnessThresholds } from '../utils/freshness';
import { lastAttempt, lastSuccess, readJournal, type JournalEntry } from '../utils/journal';
import { FIRMS_KEY, newestAcquisition, type FIRMSHotspot } from './firmsService';
import { OOPT_KEY, type OOPTResult } from './overpassService';
import { latestDatasetModified } from './rosleskhozService';
import { SOURCE_REGISTRY, type SourceDefinition, type SourceId } from './sourceRegistry';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Only sources with a runtime freshness signal get a threshold; others stay 'unknown'. */
const THRESHOLDS: Partial<Record<SourceId, FreshnessThresholds>> = {
  firms: { staleAfterMs: 4 * HOUR, failedAfterMs: 12 * HOUR },
  oopt: { staleAfterMs: 36 * HOUR, failedAfterMs: 4 * DAY },
  rosleshoz: { staleAfterMs: 60 * DAY, failedAfterMs: 400 * DAY },
  gfw_dist: { staleAfterMs: 10 * DAY, failedAfterMs: 30 * DAY },
};

/** Which sources keep a load journal (the background jobs in jobs/refresh.ts). */
const JOURNALED = new Set<SourceId>(['firms', 'oopt', 'rosleshoz']);

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

const FRESHNESS_FETCHERS: Partial<Record<SourceId, () => Promise<Date | null>>> = {
  firms: firmsFreshness,
  oopt: ooptFreshness,
  rosleshoz: async () => latestDatasetModified(),
  gfw_dist: distFreshness,
};

export interface SourceJournal {
  lastAttempt: JournalEntry | null;
  lastSuccess: JournalEntry | null;
  runs: JournalEntry[];
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
  state: FreshnessState;
  freshness: { timestamp: string; ageMs: number } | null;
  journal: SourceJournal | null;
}

export async function getSourceStatus(def: SourceDefinition, now: Date = new Date()): Promise<SourceStatus> {
  const fetchFreshness = FRESHNESS_FETCHERS[def.id];
  const timestamp = fetchFreshness ? await fetchFreshness().catch(() => null) : null;
  const ageMs = timestamp ? now.getTime() - timestamp.getTime() : null;
  const thresholds = THRESHOLDS[def.id];
  const state = thresholds ? computeState(ageMs, thresholds) : 'unknown';

  let journal: SourceJournal | null = null;
  if (JOURNALED.has(def.id)) {
    const runs = await readJournal(def.id);
    journal = { lastAttempt: lastAttempt(runs), lastSuccess: lastSuccess(runs), runs };
  }

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
    state,
    freshness: timestamp ? { timestamp: timestamp.toISOString(), ageMs: ageMs as number } : null,
    journal,
  };
}

export async function getAllSourcesStatus(now: Date = new Date()): Promise<SourceStatus[]> {
  return Promise.all(SOURCE_REGISTRY.map(def => getSourceStatus(def, now)));
}
