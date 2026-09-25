/**
 * Regional analytics service: loads every source behind injected functions (so tests need no
 * database, Redis or network), assembles the indicators for all 83 regions and caches the result
 * with cached() for 12 h. A build in which some source failed is not cached as "good": the last
 * good build is served instead (with its generatedAt), and only when there is none the degraded
 * build is returned, with nulls and reasons for the missing sources.
 */
import { cached as defaultCached } from '../../utils/cache';
import type { FirmsArchive } from './firmsArchive';
import {
  buildRegionDetail, type AssemblyInputs, type GfwLossInput, type NrtInput, type OoptInput, type RegionDetail,
  type RegionSummary, type RosleshozInput,
} from './indicators';
import { countNrtByRegion, NRT_HISTORY_SINCE, type NrtCell } from './nrtHotspots';
import { ooptAreaByRegion, type OoptGeometryLike } from './ooptShare';
import { BAIKAL_ISOS, EXPECTED_REGION_COUNT, ISO_RE, type RegionRegistry } from './registry';
import { extractRegional, ROSLESHOZ_SPECS, type ExtractSpec } from './rosleshozRegional';

export type RosleshozKey = 'forestlandArea' | 'forestFund' | 'woodVolume';

export interface RegionsDeps {
  registry(): RegionRegistry;
  /** Newest FIRMS archive file, null while it has not been built. */
  archive(): FirmsArchive | null;
  rosleshozRows(key: RosleshozKey): Promise<Record<string, string>[]>;
  rosleshozPublished(key: RosleshozKey): Date | null;
  oopt(): Promise<{ features: OoptGeometryLike[]; fetchedAt: string }>;
  nrtCells(since: string): Promise<NrtCell[]>;
  gfwLoss(): Promise<GfwLossInput>;
  /** Called when Rosleshoz names could not be mapped (log + journal). */
  reportUnmapped(names: string[]): Promise<void>;
  now(): Date;
}

export type CachedFn = <T>(key: string, ttlSec: number, fetcher: () => Promise<T>, opts?: { isValid?: (v: T) => boolean }) => Promise<T>;

export interface RegionsData {
  generatedAt: string;
  boundariesFile: string;
  archive: { file: string; generatedAt: string; years: number[]; source: FirmsArchive['source'] } | null;
  regions: RegionDetail[];
  diagnostics: {
    /** Rosleshoz subject names without an ISO code (must be added to rosleshozNames.ts). */
    unmappedRosleshozNames: string[];
    /** Sources that failed in this build. */
    sourceErrors: string[];
  };
}

export interface RegionsListResponse extends Omit<RegionsData, 'regions'> {
  regions: RegionSummary[];
}

export type RegionDetailResponse = RegionDetail & Pick<RegionsData, 'generatedAt' | 'archive' | 'boundariesFile'>;

export const REGIONS_TTL_SEC = 12 * 60 * 60;
/** A degraded (not cached) build is reused in memory this long, so failures don't rebuild per request. */
const DEGRADED_MEMO_MS = 10 * 60 * 1000;

const errorText = (err: unknown) => String((err as any)?.message ?? err).slice(0, 200);

/** Baikal regions first (in BAIKAL_ISOS order), then alphabetically by Russian name. */
export function sortRegions<T extends { iso: string; name: string }>(regions: T[]): T[] {
  const rank = (iso: string) => {
    const i = BAIKAL_ISOS.indexOf(iso);
    return i === -1 ? BAIKAL_ISOS.length : i;
  };
  return [...regions].sort((a, b) => rank(a.iso) - rank(b.iso) || a.name.localeCompare(b.name, 'ru'));
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
}

function rosleshozInput(
  deps: RegionsDeps, key: RosleshozKey, rows: Settled<Record<string, string>[]>, spec: ExtractSpec, unmapped: Set<string>,
): RosleshozInput {
  const published = deps.rosleshozPublished(key);
  if (!rows.ok) return { extraction: null, published, error: 'источник недоступен' };
  const extraction = extractRegional(rows.value, spec);
  extraction.unmapped.forEach(n => unmapped.add(n));
  return { extraction, published };
}

export async function buildRegionsData(deps: RegionsDeps): Promise<RegionsData> {
  const registry = deps.registry();
  const archive = deps.archive();
  const shapes = registry.regions.map(r => r.shape);
  const errors: string[] = [];
  const unmapped = new Set<string>();

  const keys: RosleshozKey[] = ['forestlandArea', 'forestFund', 'woodVolume'];
  const settled = await Promise.all(keys.map(key => settle(deps.rosleshozRows(key))));
  const rows = Object.fromEntries(keys.map((key, i) => [key, settled[i]])) as Record<RosleshozKey, Settled<Record<string, string>[]>>;
  for (const key of keys) {
    const r = rows[key];
    if (!r.ok) errors.push(`rosleshoz:${key}: ${errorText(r.error)}`);
  }
  // Published dates are read after the rows: loading resolves the current file name
  const forestland = rosleshozInput(deps, 'forestlandArea', rows.forestlandArea, ROSLESHOZ_SPECS.forestlandArea, unmapped);
  const forestFund = rosleshozInput(deps, 'forestFund', rows.forestFund, ROSLESHOZ_SPECS.forestFundTotal, unmapped);
  const woodiness = rosleshozInput(deps, 'forestFund', rows.forestFund, ROSLESHOZ_SPECS.woodiness, unmapped);
  const woodVolume = rosleshozInput(deps, 'woodVolume', rows.woodVolume, ROSLESHOZ_SPECS.woodVolume, unmapped);

  const [oopt, nrt, gfw] = await Promise.all([
    deps.oopt().then(
      (r): OoptInput => ({ areaKm2: ooptAreaByRegion(r.features, shapes).areaKm2, fetchedAt: r.fetchedAt }),
      (err): OoptInput => {
        errors.push(`oopt: ${errorText(err)}`);
        return { areaKm2: null, fetchedAt: null, error: 'источник недоступен' };
      },
    ),
    deps.nrtCells(NRT_HISTORY_SINCE).then(
      (cells): NrtInput => ({ ...countNrtByRegion(cells, shapes), since: NRT_HISTORY_SINCE }),
      (err): NrtInput => {
        errors.push(`nrt: ${errorText(err)}`);
        return { counts: null, since: NRT_HISTORY_SINCE, lastDate: null, error: 'база данных недоступна' };
      },
    ),
    deps.gfwLoss().catch<GfwLossInput>(err => {
      errors.push(`gfw: ${errorText(err)}`);
      return { byIso: {}, hasApiKey: false };
    }),
  ]);

  const unmappedNames = [...unmapped].sort();
  if (unmappedNames.length) await deps.reportUnmapped(unmappedNames);

  const inputs: AssemblyInputs = { forestland, forestFund, woodiness, woodVolume, archive, oopt, nrt, gfw };
  const regions = sortRegions(registry.regions).map(r =>
    buildRegionDetail({ iso: r.iso, name: r.name, areaKm2: r.areaKm2 }, BAIKAL_ISOS.includes(r.iso), inputs));

  return {
    generatedAt: deps.now().toISOString(),
    boundariesFile: registry.file,
    archive: archive && { file: archive.file, generatedAt: archive.generatedAt, years: archive.years, source: archive.source },
    regions,
    diagnostics: { unmappedRosleshozNames: unmappedNames, sourceErrors: errors },
  };
}

/** Only complete builds (all 83 regions, no failed source) may become the cached "good" value. */
export const isCompleteBuild = (data: RegionsData) =>
  data.regions.length === EXPECTED_REGION_COUNT && data.diagnostics.sourceErrors.length === 0;

export function toSummary({ hotspotSeries: _s, hotspotSeriesReason: _r, extraIndicators: _e, ...summary }: RegionDetail): RegionSummary {
  return summary;
}

export type IsoCheck = { ok: true; iso: string } | { ok: false; status: 400 | 404; error: string };

/** Validates a path parameter against the ISO format and the registry (case-insensitive). */
export function checkIso(raw: unknown, registry: RegionRegistry): IsoCheck {
  const iso = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!ISO_RE.test(iso)) return { ok: false, status: 400, error: 'Неверный код субъекта: ожидается ISO 3166-2, например RU-IRK' };
  if (!registry.byIso.has(iso)) return { ok: false, status: 404, error: `Субъект ${iso} не входит в 83 субъекта сайта` };
  return { ok: true, iso };
}

export function createRegionsService(deps: RegionsDeps, cachedFn: CachedFn = defaultCached) {
  let memo: { key: string; at: number; data: RegionsData } | null = null;

  async function memoBuild(key: string): Promise<RegionsData> {
    if (memo && memo.key === key && deps.now().getTime() - memo.at < DEGRADED_MEMO_MS) return memo.data;
    const data = await buildRegionsData(deps);
    memo = { key, at: deps.now().getTime(), data };
    return data;
  }

  async function data(): Promise<RegionsData> {
    // A new boundaries or archive file gets a new key, so it shows up without waiting 12 h
    const key = `regions:v1:${deps.registry().file}:${deps.archive()?.file ?? 'no-archive'}`;
    try {
      return await cachedFn(key, REGIONS_TTL_SEC, () => memoBuild(key), { isValid: isCompleteBuild });
    } catch {
      // Degraded and no last-good value yet: serve the degraded build (nulls carry the reasons)
      return memoBuild(key);
    }
  }

  return {
    checkIso: (raw: unknown) => checkIso(raw, deps.registry()),
    async list(): Promise<RegionsListResponse> {
      const d = await data();
      return { ...d, regions: d.regions.map(toSummary) };
    },
    async detail(iso: string): Promise<RegionDetailResponse | null> {
      const { regions, generatedAt, archive, boundariesFile } = await data();
      const region = regions.find(r => r.iso === iso);
      return region ? { ...region, generatedAt, archive, boundariesFile } : null;
    },
  };
}

export type RegionsService = ReturnType<typeof createRegionsService>;
