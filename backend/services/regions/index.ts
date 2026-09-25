/**
 * Production wiring of the regional analytics service: real files, Rosleshoz, Overpass (OOPT),
 * Postgres (NRT history) and GFW. Tests build the service with fakes via createRegionsService().
 */
import pool from '../../config/database';
import { recordRun } from '../../utils/journal';
import { datasetModified, getDatasetRows } from '../rosleskhozService';
import { getOOPT } from '../overpassService';
import { gfwService } from '../globalForestWatch';
import { loadFirmsArchive, type FirmsArchive } from './firmsArchive';
import type { GfwLossInput } from './indicators';
import { loadNrtCells } from './nrtHotspots';
import { loadRegionRegistry } from './registry';
import { createRegionsService, type RegionsDeps } from './service';

/** GFW region codes (globalForestWatch.ts) → ISO; only these 14 have a loss share. */
export const GFW_CODE_TO_ISO: Record<string, string> = {
  irkutsk: 'RU-IRK', buryatia: 'RU-BU', zabaikalye: 'RU-ZAB', krasnoyarsk: 'RU-KYA', yakutia: 'RU-SA',
  khabarovsk: 'RU-KHA', primorye: 'RU-PRI', amur: 'RU-AMU', tomsk: 'RU-TOM', tyumen: 'RU-TYU',
  komi: 'RU-KO', arkhangelsk: 'RU-ARK', vologda: 'RU-VLG', karelia: 'RU-KR',
};

async function gfwLoss(): Promise<GfwLossInput> {
  const byIso: GfwLossInput['byIso'] = {};
  const lastYear = new Date().getUTCFullYear() - 1;
  await Promise.all(Object.entries(GFW_CODE_TO_ISO).map(async ([code, iso]) => {
    const result = await gfwService.getRegionalTreeCoverLoss(code, 2001, lastYear);
    const latest = result.data.reduce<(typeof result.data)[number] | null>((a, b) => (!a || b.year > a.year ? b : a), null);
    if (latest) byIso[iso] = { year: latest.year, areaHa: latest.area_ha, live: result.data_type === 'live', source: result.data_source };
  }));
  return { byIso, hasApiKey: Boolean(process.env.GFW_API_KEY) };
}

// The archive and boundaries ship with the image and only change on deploy (= restart)
let archiveMemo: { value: FirmsArchive | null } | null = null;

const deps: RegionsDeps = {
  registry: () => loadRegionRegistry(),
  archive: () => (archiveMemo ??= { value: loadFirmsArchive() }).value,
  rosleshozRows: key => getDatasetRows(key),
  rosleshozPublished: key => datasetModified(key),
  oopt: () => getOOPT(),
  nrtCells: since => loadNrtCells(pool, since),
  gfwLoss,
  async reportUnmapped(names) {
    console.error(`regions: unmapped Rosleshoz subject names (add them to rosleshozNames.ts): ${names.join('; ')}`);
    const now = new Date().toISOString();
    await recordRun('regions', {
      startedAt: now, finishedAt: now, durationMs: 0, outcome: 'failed', unmapped: names,
      error: `unmapped Rosleshoz names: ${names.join('; ')}`.slice(0, 300),
    });
  },
  now: () => new Date(),
};

export const regionsService = createRegionsService(deps);
