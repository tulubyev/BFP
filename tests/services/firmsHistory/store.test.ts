import {
  createPgFirmsHistoryStore, INSERT_INCIDENT_SQL, isMissingConflictTarget, MigrationMissingError, SET_STATUS_SQL,
  UPDATE_INCIDENT_SQL, type PgClientLike,
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

describe('isMissingConflictTarget', () => {
  it('recognizes SQLSTATE 42P10 only', () => {
    expect(isMissingConflictTarget(pgError('42P10'))).toBe(true);
    expect(isMissingConflictTarget(pgError('23505'))).toBe(false);
    expect(isMissingConflictTarget(null)).toBe(false);
  });
});
