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
import { hotspot } from './fixtures';

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

function setup(snapshot: FIRMSHotspot[], now: string) {
  const db = new FakeDb();
  const journal: { source: string; entry: JournalEntry }[] = [];
  const state = { snapshot, now: new Date(now) };
  const run = () => runFirmsHistory({
    store: db,
    loadSnapshot: async () => state.snapshot,
    loadRegions: () => regions,
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
