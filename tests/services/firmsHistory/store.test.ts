import {
  createPgFirmsHistoryStore, INSERT_INCIDENT_SQL, isMissingConflictTarget, LOAD_HEAT_CELLS_SQL, LOAD_INCIDENT_HOTSPOTS_SQL,
  MARK_STATIC_SQL, MigrationMissingError, SET_STATUS_SQL, UPDATE_INCIDENT_SQL, type PgClientLike,
} from '../../../backend/services/firmsHistory/store';
import { buildNewIncident } from '../../../backend/services/firmsHistory/incidents';
import { hotspot, point } from './fixtures';

function fakePool(handler: (text: string, params?: unknown[]) => { rows: any[] } | Error) {
  const calls: { text: string; params?: unknown[] }[] = [];
  const client: PgClientLike & { released: number } = {
    released: 0,
    async query(text, params) {
      calls.push({ text, params });
      const r = handler(text, params);
      if (r instanceof Error) throw r;
      return r;
    },
    release() { this.released++; },
  };
  return { pool: { connect: async () => client }, calls, client };
}

const pgError = (code: string) => Object.assign(new Error('pg'), { code });

describe('createPgFirmsHistoryStore', () => {
  it('wraps the run in BEGIN + advisory lock … COMMIT and releases the client', async () => {
    const { pool, calls, client } = fakePool(text => ({ rows: text.startsWith('INSERT INTO gis.fire_hotspots') ? [{ id: 1 }] : [] }));
    const store = createPgFirmsHistoryStore(pool);
    const result = await store.transaction(tx => tx.insertHotspots([hotspot(), hotspot({ latitude: NaN })]));
    expect(result).toEqual({ written: 1, rejected: 1 });
    expect(calls.map(c => c.text.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'INSERT', 'COMMIT']);
    expect(calls[1].text).toContain('pg_advisory_xact_lock');
    expect(client.released).toBe(1);
  });

  it('maps a missing ON CONFLICT index (42P10) to MigrationMissingError and rolls back', async () => {
    const { pool, calls, client } = fakePool(text => (text.startsWith('INSERT') ? pgError('42P10') : { rows: [] }));
    const store = createPgFirmsHistoryStore(pool);
    const run = store.transaction(tx => tx.insertHotspots([hotspot()]));
    await expect(run).rejects.toBeInstanceOf(MigrationMissingError);
    await expect(run).rejects.toThrow('migration 011 not applied');
    expect(calls.map(c => c.text)).toContain('ROLLBACK');
    expect(calls.map(c => c.text)).not.toContain('COMMIT');
    expect(client.released).toBe(1);
  });

  it('passes other database errors through', async () => {
    const { pool } = fakePool(text => (text.startsWith('INSERT') ? pgError('53300') : { rows: [] }));
    await expect(createPgFirmsHistoryStore(pool).transaction(tx => tx.insertHotspots([hotspot()])))
      .rejects.toMatchObject({ code: '53300' });
  });

  it('loads stored hotspots with a parameterized query and maps rows', async () => {
    const { pool, calls } = fakePool(text => (text.includes('FROM gis.fire_hotspots')
      ? { rows: [{ id: '5', lat: 52.1, lon: 104.2, satellite: 'N', acq_date: '2026-09-24', acq_time: '0130', confidence: 'high', frp: '3.5' }] }
      : { rows: [] }));
    const rows = await createPgFirmsHistoryStore(pool).transaction(tx =>
      tx.loadHotspots('2026-09-22', { minLat: 49, maxLat: 60, minLon: 95, maxLon: 122 }));
    expect(rows).toEqual([{ id: 5, lat: 52.1, lon: 104.2, satellite: 'N', acqDate: '2026-09-24', acqTime: '0130', confidence: 'high', frp: 3.5 }]);
    const q = calls.find(c => c.text.includes('FROM gis.fire_hotspots'))!;
    expect(q.params).toEqual(['firms_viirs_nrt', '2026-09-22', 49, 60, 95, 122]);
  });

  it('only loads and modifies FIRMS-method incidents', async () => {
    const { pool, calls } = fakePool(text => (text.startsWith('INSERT INTO gis.forest_changes') ? { rows: [{ id: 42 }] } : { rows: [] }));
    const row = buildNewIncident([point(1, 52, 104, { confidence: 'high' })], new Date('2026-09-24T06:00:00Z'));
    const id = await createPgFirmsHistoryStore(pool).transaction(async tx => {
      await tx.loadFirmsIncidents('2026-09-22T12:00:00.000Z');
      const newId = await tx.insertIncident(row);
      await tx.updateIncident(newId, row);
      await tx.setIncidentStatus(newId, 'inactive');
      return newId;
    });
    expect(id).toBe(42);
    const load = calls.find(c => c.text.includes('FROM gis.forest_changes'))!;
    expect(load.params).toEqual(['firms-cluster-v1', '2026-09-22T12:00:00.000Z']);
    expect(UPDATE_INCIDENT_SQL).toContain("WHERE id = $1 AND metadata->>'method' = 'firms-cluster-v1'");
    expect(SET_STATUS_SQL).toContain("metadata->>'method' = 'firms-cluster-v1'");
    const insert = calls.find(c => c.text === INSERT_INCIDENT_SQL)!;
    expect(insert.params).toContain('fire');
    expect(JSON.parse(insert.params![insert.params!.length - 1] as string).method).toBe('firms-cluster-v1');
    const update = calls.find(c => c.text === UPDATE_INCIDENT_SQL)!;
    expect(update.params![0]).toBe(42);
  });
});

describe('static source mask queries', () => {
  const bbox = { minLat: 49, maxLat: 64.5, minLon: 95, maxLon: 122 };

  it('reads per-cell distinct days with a parameterized, index-friendly aggregate', async () => {
    const { pool, calls } = fakePool(text => (text === LOAD_HEAT_CELLS_SQL
      ? { rows: [{ cell_row: 15180, cell_col: 13210, lat: 60.72, lon: 108.05, days: ['2026-09-27', '2026-09-25'] },
        { cell_row: '1', cell_col: '2', lat: '58.1', lon: '107.2', days: '{2026-09-25,2026-09-26}' }] }
      : { rows: [] }));
    const cells = await createPgFirmsHistoryStore(pool).transaction(tx => tx.loadHeatCells('2026-09-25', bbox));
    expect(cells).toEqual([
      { row: 15180, col: 13210, lat: 60.72, lon: 108.05, days: ['2026-09-25', '2026-09-27'] },
      { row: 1, col: 2, lat: 58.1, lon: 107.2, days: ['2026-09-25', '2026-09-26'] },
    ]);
    const q = calls.find(c => c.text === LOAD_HEAT_CELLS_SQL)!;
    expect(q.params).toEqual(['firms_viirs_nrt', 0.004, '2026-09-25', 49, 64.5, 95, 122, 2]);
    expect(LOAD_HEAT_CELLS_SQL).toContain('acquisition_date >= $3::date');
    expect(LOAD_HEAT_CELLS_SQL).toContain('GROUP BY cell_row, cell_col');
    expect(LOAD_HEAT_CELLS_SQL).toContain('HAVING count(DISTINCT day) >= $8');
  });

  it('loads an incident\'s own hotspots by bbox, date range and watermark', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    const incident = {
      id: 7, satellite: 'N', center: { lat: 60.72, lon: 108.05 },
      bbox: { minLat: 60.71, minLon: 108.04, maxLat: 60.73, maxLon: 108.06 },
      metadata: { method: 'firms-cluster-v1', first_seen: '2026-09-25T05:40:00.000Z', last_seen: '2026-10-01T18:25:00.000Z', max_hotspot_id: 812 },
    } as any;
    await createPgFirmsHistoryStore(pool).transaction(tx => tx.loadIncidentHotspots(incident));
    const q = calls.find(c => c.text === LOAD_INCIDENT_HOTSPOTS_SQL)!;
    expect(q.params).toEqual(['firms_viirs_nrt', '2026-09-25', '2026-10-01', 60.71, 60.73, 108.04, 108.06, 812]);
    // No dates → nothing to evaluate, no query.
    const empty = await createPgFirmsHistoryStore(pool).transaction(tx => tx.loadIncidentHotspots({ ...incident, metadata: { method: 'firms-cluster-v1' } }));
    expect(empty).toEqual([]);
  });

  it('marks static sources in metadata only, guarded by metadata.method (row kept)', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    const info = { method: 'static-mask-v1' as const, min_days: 4, window_days: 14, min_span_days: 7, radius_m: 500, marked_at: '2026-10-02T12:00:00.000Z' };
    await createPgFirmsHistoryStore(pool).transaction(tx => tx.markStaticSource(7, info));
    const q = calls.find(c => c.text === MARK_STATIC_SQL)!;
    expect(q.params).toEqual([7, JSON.stringify(info)]);
    expect(MARK_STATIC_SQL).toMatch(/^UPDATE gis\.forest_changes/);
    expect(MARK_STATIC_SQL).not.toMatch(/DELETE/i);
    expect(MARK_STATIC_SQL).toContain("'status', 'static_source'");
    expect(MARK_STATIC_SQL).toContain("WHERE id = $1 AND metadata->>'method' = 'firms-cluster-v1'");
  });
});

describe('isMissingConflictTarget', () => {
  it('recognizes SQLSTATE 42P10 only', () => {
    expect(isMissingConflictTarget(pgError('42P10'))).toBe(true);
    expect(isMissingConflictTarget(pgError('23505'))).toBe(false);
    expect(isMissingConflictTarget(null)).toBe(false);
  });
});
