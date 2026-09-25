import path from 'path';
import type { FIRMSHotspot } from '../../../backend/services/firmsService';
import { JOURNAL_SOURCE, runFirmsHistory, toClusterPoints } from '../../../backend/services/firmsHistory/ingest';
import { hotspotToRow, HOTSPOT_COLUMNS, HOTSPOT_SOURCE } from '../../../backend/services/firmsHistory/hotspotRows';
import type { ExistingIncident, IncidentRow } from '../../../backend/services/firmsHistory/incidents';
import { loadBaikalRegions } from '../../../backend/services/firmsHistory/regions';
import {
  MigrationMissingError, type FirmsHistoryStore, type FirmsHistoryTx, type StoredHotspot,
} from '../../../backend/services/firmsHistory/store';
import type { JournalEntry } from '../../../backend/utils/journal';
import {
  aggregateCells, cellOf, parseArchiveStaticCells, STATIC_CELL_DEG, type ArchiveStaticCells,
} from '../../../backend/services/firmsHistory/staticSources';
import {
  days, FLARE, flareHotspots, hotspot, MOVING_FIRE, movingFireHotspots, ONE_DAY_FIRE, oneDayFireHotspots,
} from './fixtures';

const { regions } = loadBaikalRegions([path.resolve(__dirname, '../../../frontend/public/data/boundaries')]);

/** In-memory stand-in for gis.fire_hotspots + gis.forest_changes with the migration-011 unique key. */
class FakeDb implements FirmsHistoryStore {
  hotspots: (StoredHotspot & { source: string })[] = [];
  incidents: { id: number; row: Partial<IncidentRow> & { metadata: any } }[] = [];
  migrationApplied = true;
  private nextId = 1;

  async transaction<T>(fn: (tx: FirmsHistoryTx) => Promise<T>): Promise<T> {
    const backup = JSON.stringify([this.hotspots, this.incidents, this.nextId]);
    try {
      return await fn(this.tx());
    } catch (err) {
      [this.hotspots, this.incidents, this.nextId] = JSON.parse(backup);
      throw err;
    }
  }

  private tx(): FirmsHistoryTx {
    return {
      insertHotspots: async (list: FIRMSHotspot[]) => {
        if (!this.migrationApplied && list.length) throw new MigrationMissingError();
        let written = 0;
        let rejected = 0;
        for (const h of list) {
          const row = hotspotToRow(h);
          if (!row) { rejected++; continue; }
          const v = Object.fromEntries(HOTSPOT_COLUMNS.map((c, i) => [c, row[i]])) as any;
          const acqTime = String(v.acquisition_time).slice(0, 5).replace(':', '');
          const dup = this.hotspots.some(s => s.satellite === v.satellite && s.acqDate === v.acquisition_date
            && s.acqTime === acqTime && s.lat === v.latitude && s.lon === v.longitude);
          if (dup) continue;
          this.hotspots.push({
            id: this.nextId++, source: v.source, lat: v.latitude, lon: v.longitude, satellite: v.satellite,
            acqDate: v.acquisition_date, acqTime, confidence: v.confidence, frp: v.frp,
          });
          written++;
        }
        return { written, rejected };
      },
      loadHotspots: async (since, b) => this.hotspots.filter(h => h.source === HOTSPOT_SOURCE && h.acqDate >= since
        && h.lat >= b.minLat && h.lat <= b.maxLat && h.lon >= b.minLon && h.lon <= b.maxLon),
      loadHeatCells: async (since, b) => aggregateCells(this.hotspots.filter(h => h.source === HOTSPOT_SOURCE
        && h.acqDate >= since && h.lat >= b.minLat && h.lat <= b.maxLat && h.lon >= b.minLon && h.lon <= b.maxLon)),
      loadIncidentHotspots: async incident => {
        const m = incident.metadata;
        const from = String(m.first_seen).slice(0, 10);
        const to = String(m.last_seen).slice(0, 10);
        return this.hotspots.filter(h => h.acqDate >= from && h.acqDate <= to && h.id <= Number(m.max_hotspot_id)
          && h.lat >= incident.bbox.minLat && h.lat <= incident.bbox.maxLat
          && h.lon >= incident.bbox.minLon && h.lon <= incident.bbox.maxLon);
      },
      markStaticSource: async (id, info) => {
        const found = this.incidents.find(i => i.id === id && i.row.metadata?.method === 'firms-cluster-v1');
        if (found) found.row.metadata = { ...found.row.metadata, status: 'static_source', static_mask: info };
      },
      loadFirmsIncidents: async lastSeenSince => this.incidents
        .filter(i => i.row.metadata?.method === 'firms-cluster-v1'
          && (i.row.metadata.status === 'active' || i.row.metadata.last_seen >= lastSeenSince))
        .map((i): ExistingIncident => ({
          id: i.id,
          satellite: i.row.satellite ?? null,
          center: { lat: i.row.center_lat!, lon: i.row.center_lng! },
          bbox: { minLat: i.row.bbox_min_lat!, minLon: i.row.bbox_min_lng!, maxLat: i.row.bbox_max_lat!, maxLon: i.row.bbox_max_lng! },
          metadata: JSON.parse(JSON.stringify(i.row.metadata)),
        })),
      insertIncident: async row => {
        const id = 1000 + this.incidents.length;
        this.incidents.push({ id, row: JSON.parse(JSON.stringify(row)) });
        return id;
      },
      updateIncident: async (id, row) => {
        const found = this.incidents.find(i => i.id === id && i.row.metadata?.method === 'firms-cluster-v1');
        if (found) found.row = JSON.parse(JSON.stringify(row));
      },
      setIncidentStatus: async (id, status) => {
        const found = this.incidents.find(i => i.id === id && i.row.metadata?.method === 'firms-cluster-v1');
        if (found) found.row.metadata.status = status;
      },
    };
  }
}

function setup(snapshot: FIRMSHotspot[], now: string, archive?: ArchiveStaticCells) {
  const db = new FakeDb();
  const journal: { source: string; entry: JournalEntry }[] = [];
  const state = { snapshot, now: new Date(now) };
  const run = () => runFirmsHistory({
    store: db,
    loadSnapshot: async () => state.snapshot,
    loadRegions: () => regions,
    ...(archive ? { loadArchiveCells: () => archive } : {}),
    record: async (source, entry) => { journal.push({ source, entry }); },
    now: () => state.now,
  });
  return { db, journal, state, run };
}

// Near Bratsk (Irkutsk oblast): two points ~1 km apart, one high-confidence point near Chita,
// one nominal lone point in Buryatia, one in Krasnoyarsk krai (outside the Baikal regions).
const SNAPSHOT = [
  hotspot({ latitude: 56.1, longitude: 101.6, acq_date: '2026-09-24', acq_time: '0500', satellite: 'N', frp: 10 }),
  hotspot({ latitude: 56.109, longitude: 101.6, acq_date: '2026-09-24', acq_time: '0512', satellite: 'N20', frp: 5 }),
  hotspot({ latitude: 52.2, longitude: 113.2, acq_date: '2026-09-24', acq_time: '0600', confidence: 'h', frp: 40 }),
  hotspot({ latitude: 52.5, longitude: 108.5, acq_date: '2026-09-24', acq_time: '0600' }),
  hotspot({ latitude: 56.0, longitude: 93.0, acq_date: '2026-09-24', acq_time: '0600', confidence: 'h' }),
  hotspot({ latitude: NaN }),
];

describe('runFirmsHistory', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('writes hotspots, creates incidents for qualifying Baikal clusters and journals the run', async () => {
    const { db, journal, run } = setup(SNAPSHOT, '2026-09-24T12:00:00Z');
    const summary = await run();
    expect(summary).toMatchObject({ received: 6, written: 5, rejected: 1, created: 2, updated: 0, deactivated: 0 });
    expect(db.hotspots).toHaveLength(5);
    expect(db.incidents.map(i => i.row.metadata.region_iso).sort()).toEqual(['RU-IRK', 'RU-ZAB']);
    const irk = db.incidents.find(i => i.row.metadata.region_iso === 'RU-IRK')!;
    expect(irk.row.metadata).toMatchObject({ hotspot_count: 2, region: 'Иркутская область', status: 'active' });
    expect(irk.row.satellite).toBe('N,N20');
    expect(journal).toEqual([{ source: JOURNAL_SOURCE, entry: expect.objectContaining({
      outcome: 'updated', items: 6, written: 5, rejected: 1, incidents: { created: 2, updated: 0, deactivated: 0 },
    }) }]);
  });

  it('is idempotent: re-running with the same snapshot writes and changes nothing', async () => {
    const { db, run, state } = setup(SNAPSHOT, '2026-09-24T12:00:00Z');
    await run();
    const before = JSON.stringify(db.incidents);
    state.now = new Date('2026-09-24T12:30:00Z');
    const again = await run();
    expect(again).toMatchObject({ written: 0, created: 0, updated: 0, deactivated: 0 });
    expect(db.hotspots).toHaveLength(5);
    expect(JSON.stringify(db.incidents)).toBe(before);
  });

  it('grows an existing incident with new points and later marks it inactive', async () => {
    const { db, run, state } = setup(SNAPSHOT.slice(0, 2), '2026-09-24T12:00:00Z');
    await run();
    expect(db.incidents).toHaveLength(1);

    state.snapshot = [...SNAPSHOT.slice(0, 2),
      hotspot({ latitude: 56.118, longitude: 101.6, acq_date: '2026-09-25', acq_time: '0400', satellite: 'N21', frp: 7 })];
    state.now = new Date('2026-09-25T06:00:00Z');
    expect(await run()).toMatchObject({ written: 1, created: 0, updated: 1 });
    expect(db.incidents[0].row.metadata).toMatchObject({ hotspot_count: 3, last_seen: '2026-09-25T04:00:00.000Z', frp_sum: 22 });
    expect(db.incidents[0].row.satellite).toBe('N,N20,N21');

    state.snapshot = [];
    state.now = new Date('2026-09-27T05:00:00Z'); // 49 h after the last point
    expect(await run()).toMatchObject({ created: 0, updated: 0, deactivated: 1 });
    expect(db.incidents[0].row.metadata.status).toBe('inactive');
  });

  it('never touches seed incidents without metadata.method', async () => {
    const { db, run } = setup(SNAPSHOT.slice(0, 2), '2026-09-24T12:00:00Z');
    const seed = { id: 1, row: { change_type: 'fire', source: 'firms', center_lat: 56.1, center_lng: 101.6,
      bbox_min_lat: 56.1, bbox_min_lng: 101.6, bbox_max_lat: 56.1, bbox_max_lng: 101.6, metadata: { note: 'demo' } } } as any;
    db.incidents.push(seed);
    const before = JSON.stringify(seed);
    await run();
    expect(JSON.stringify(db.incidents[0])).toBe(before);
    expect(db.incidents).toHaveLength(2);
  });

  it('fails gracefully when migration 011 is not applied', async () => {
    const { db, journal, run } = setup(SNAPSHOT, '2026-09-24T12:00:00Z');
    db.migrationApplied = false;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(run()).resolves.toBeNull();
    warn.mockRestore();
    expect(db.hotspots).toEqual([]);
    expect(db.incidents).toEqual([]);
    expect(journal).toHaveLength(1);
    expect(journal[0].entry.outcome).toBe('failed');
    expect(journal[0].entry.error).toContain('migration 011 not applied');
  });

  it('still writes hotspots when the boundaries are missing, and journals the skipped incidents', async () => {
    const { db, journal, state } = setup(SNAPSHOT, '2026-09-24T12:00:00Z');
    const summary = await runFirmsHistory({
      store: db,
      loadSnapshot: async () => state.snapshot,
      loadRegions: () => { throw new Error('ru-regions.*.geojson not found'); },
      record: async (source, entry) => { journal.push({ source, entry }); },
      now: () => state.now,
    });
    expect(summary).toMatchObject({ written: 5, created: 0 });
    expect(db.incidents).toEqual([]);
    expect(journal[0].entry).toMatchObject({ outcome: 'failed', written: 5 });
    expect(journal[0].entry.error).toContain('incidents skipped: ru-regions.*.geojson not found');
  });
});

describe('static heat source mask over two weeks of history', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  // 25 Sep – 8 Oct, one run a day at 12:00 UTC. The flare is hidden by clouds on day 3 and 6.
  const DATES = days('2026-09-25', 14);
  const FLARE_DATES = DATES.filter((_, i) => i !== 2 && i !== 5);
  const FIRE_DATES = DATES.slice(1, 7);
  const snapshotFor = (date: string) => [
    ...(FLARE_DATES.includes(date) ? flareHotspots([date]) : []),
    ...(FIRE_DATES.includes(date) ? movingFireHotspots([date]).map(h => ({ ...h })) : []),
    ...(date === DATES[9] ? oneDayFireHotspots(date) : []),
  ];
  const near = (row: any, at: { lat: number; lon: number }) =>
    Math.abs(row.center_lat - at.lat) < 0.1 && Math.abs(row.center_lng - at.lon) < 0.1;

  async function simulate() {
    const env = setup([], `${DATES[0]}T12:00:00Z`);
    const seed = { id: 1, row: { change_type: 'fire', source: 'firms', center_lat: FLARE.lat, center_lng: FLARE.lon,
      bbox_min_lat: FLARE.lat, bbox_min_lng: FLARE.lon, bbox_max_lat: FLARE.lat, bbox_max_lng: FLARE.lon,
      metadata: { note: 'demo' } } } as any;
    env.db.incidents.push(seed);
    const summaries = [];
    for (const date of DATES) {
      env.state.snapshot = snapshotFor(date);
      env.state.now = new Date(`${date}T12:00:00Z`);
      summaries.push((await env.run())!);
    }
    const flare = () => env.db.incidents.filter(i => i.id !== 1 && near(i.row, FLARE));
    return { ...env, seed, summaries, flare };
  }

  it('fixtures are inside Irkutsk oblast', () => {
    const pts = toClusterPoints([FLARE, MOVING_FIRE, ONE_DAY_FIRE].map((p, i) => ({
      id: i + 1, lat: p.lat, lon: p.lon, satellite: 'N', acqDate: '2026-09-25', acqTime: '0500', confidence: 'nominal', frp: 1,
    })), regions, new Date('2026-09-24T00:00:00Z'));
    expect(pts.map(p => p.regionIso)).toEqual(['RU-IRK', 'RU-IRK', 'RU-IRK']);
  });

  it('masks nothing for the first week: the flare is an ordinary incident', async () => {
    const { summaries } = await simulate();
    for (const s of summaries.slice(0, 7)) {
      expect(s).toMatchObject({ maskedHotspots: 0, maskedIncidents: 0, staticLocations: 0 });
    }
  });

  it('re-labels the flare incident once its spot passes the rule, and never feeds it again', async () => {
    const { summaries, flare, journal } = await simulate();
    // Day 8 (2 Oct): flare seen on 6 days spanning 7 → static.
    expect(summaries[7]).toMatchObject({ maskedIncidents: 1 });
    expect(summaries[7].maskedHotspots).toBeGreaterThan(0);
    expect(summaries[7].staticLocations).toBeGreaterThan(0);
    for (const s of summaries.slice(8)) expect(s.maskedIncidents).toBe(0);

    const incidents = flare();
    expect(incidents).toHaveLength(1); // no new incident at the flare after masking
    const meta = incidents[0].row.metadata;
    expect(meta.status).toBe('static_source');
    expect(meta.static_mask).toMatchObject({ method: 'static-mask-v1', min_days: 4, window_days: 14, marked_at: '2026-10-02T12:00:00.000Z' });
    // The incident stopped growing when it was re-labelled (last point: 1 Oct evening pass).
    expect(meta.last_seen).toBe('2026-10-01T18:25:00.000Z');

    const last = journal[journal.length - 1].entry;
    expect(last.masked).toEqual({ hotspots: expect.any(Number), incidents: 0, staticLocations: expect.any(Number) });
    expect(last.masked!.hotspots).toBeGreaterThan(0);
    expect(journal[7].entry.masked).toMatchObject({ incidents: 1 });
  });

  it('keeps the moving fire and the one-day fire as ordinary incidents', async () => {
    const { db } = await simulate();
    const fire = db.incidents.filter(i => near(i.row, MOVING_FIRE));
    expect(fire).toHaveLength(1);
    expect(fire[0].row.metadata).toMatchObject({ hotspot_count: 18, status: 'inactive' });
    const oneDay = db.incidents.filter(i => near(i.row, ONE_DAY_FIRE));
    expect(oneDay).toHaveLength(1);
    expect(oneDay[0].row.metadata.status).not.toBe('static_source');
  });

  it('never touches the seed incident without metadata.method, even at the flare', async () => {
    const { db, seed } = await simulate();
    expect(db.incidents.find(i => i.id === 1)!.row.metadata).toEqual({ note: 'demo' });
    expect(seed.row.metadata.status).toBeUndefined();
  });

  it('is idempotent: re-running the last day changes nothing', async () => {
    const { db, run } = await simulate();
    const before = JSON.stringify(db.incidents);
    expect(await run()).toMatchObject({ written: 0, created: 0, updated: 0, maskedIncidents: 0 });
    expect(JSON.stringify(db.incidents)).toBe(before);
  });

  it('does not re-label an incident that also has hotspots away from the static spot', async () => {
    const env = setup([], '2026-09-25T12:00:00Z');
    for (const [i, date] of days('2026-09-25', 9).entries()) {
      // On the first day a real fire burns 1.3 km from the flare and joins its cluster.
      env.state.snapshot = [...flareHotspots([date]), ...(i === 0 ? [hotspot({
        latitude: FLARE.lat + 0.012, longitude: FLARE.lon, acq_date: date, acq_time: '0540',
      })] : [])];
      env.state.now = new Date(`${date}T12:00:00Z`);
      await env.run();
    }
    const incidents = env.db.incidents.filter(i => near(i.row, FLARE));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].row.metadata.status).not.toBe('static_source');
  });
});

describe('static mask with FIRMS archive cells', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  // The yearly archive flagged the flare's pixels as type = 2 (static land source).
  const archivePoints = flareHotspots(days('2024-06-01', 11));
  const archive = parseArchiveStaticCells({
    version: 2024, gridDeg: STATIC_CELL_DEG,
    cells: archivePoints.map(h => cellOf(h.latitude, h.longitude)).map(c => [c.row, c.col]),
  });
  const near = (row: any) => Math.abs(row.center_lat - FLARE.lat) < 0.1 && Math.abs(row.center_lng - FLARE.lon) < 0.1;

  it('masks the flare from the first day, without waiting for a week of history', async () => {
    const { db, run } = setup([...flareHotspots(['2026-09-25']), ...oneDayFireHotspots('2026-09-25')], '2026-09-25T12:00:00Z', archive);
    const summary = await run();
    expect(summary).toMatchObject({ staticLocations: 0, archiveLocations: archive.keys.size, maskedHotspots: 2, created: 1 });
    // Only the one-day fire becomes an incident.
    expect(db.incidents.filter(i => near(i.row))).toEqual([]);
    expect(db.incidents).toHaveLength(1);
  });

  it('re-labels an existing flare incident with the archive year in its provenance', async () => {
    const env = setup(flareHotspots(['2026-09-25']), '2026-09-25T12:00:00Z');
    await env.run(); // no archive yet: an ordinary incident
    expect(env.db.incidents.filter(i => near(i.row))).toHaveLength(1);

    const withArchive = setup([], '2026-09-25T18:00:00Z', archive);
    withArchive.db.hotspots = env.db.hotspots;
    withArchive.db.incidents = env.db.incidents;
    expect(await withArchive.run()).toMatchObject({ maskedIncidents: 1 });
    expect(env.db.incidents[0].row.metadata).toMatchObject({
      status: 'static_source', static_mask: { method: 'static-mask-v1', archive_version: 2024 },
    });
  });
});

describe('toClusterPoints', () => {
  const row = (over: Partial<StoredHotspot>): StoredHotspot => ({
    id: 1, lat: 52.29, lon: 104.28, satellite: 'N', acqDate: '2026-09-24', acqTime: '0500', confidence: 'high', frp: 1, ...over,
  });
  it('keeps points in the window and in a Baikal region, with region names', () => {
    const cutoff = new Date('2026-09-22T12:00:00Z');
    const pts = toClusterPoints([
      row({ id: 1 }),
      row({ id: 2, acqDate: '2026-09-22', acqTime: '1159' }), // just before the cutoff
      row({ id: 3, lat: 56.0, lon: 93.0 }), // Krasnoyarsk krai
    ], regions, cutoff);
    expect(pts.map(p => p.id)).toEqual([1]);
    expect(pts[0]).toMatchObject({ regionIso: 'RU-IRK', acquiredAt: '2026-09-24T05:00:00.000Z', confidence: 'high' });
  });
});
