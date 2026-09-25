import { checkPostgisStatus } from '../../backend/services/postgisStatus';
import type { QueryablePool } from '../../backend/services/incidentsService';

function fakePool(overrides: Partial<{ newest: string | null; fail: boolean; delayMs: number }> = {}): QueryablePool {
  const { newest = null, fail = false, delayMs = 0 } = overrides;
  return {
    query: jest.fn(async () => {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (fail) throw new Error('connection refused');
      return { rows: [{ newest }] };
    }),
  };
}

describe('checkPostgisStatus', () => {
  it('reports reachable with the newest record date when the query succeeds', async () => {
    const pool = fakePool({ newest: '2026-09-20T12:00:00.000Z' });
    const result = await checkPostgisStatus(pool);
    expect(result.reachable).toBe(true);
    expect(result.newestRecordAt).toEqual(new Date('2026-09-20T12:00:00.000Z'));
  });

  it('reports reachable with a null date when both tables are empty', async () => {
    const pool = fakePool({ newest: null });
    const result = await checkPostgisStatus(pool);
    expect(result.reachable).toBe(true);
    expect(result.newestRecordAt).toBeNull();
  });

  it('reports unreachable (not a thrown error) when the query fails', async () => {
    const pool = fakePool({ fail: true });
    const result = await checkPostgisStatus(pool);
    expect(result).toEqual({ reachable: false, newestRecordAt: null });
  });

  it('reports unreachable when the query exceeds the timeout', async () => {
    const pool = fakePool({ delayMs: 50 });
    const result = await checkPostgisStatus(pool, 10);
    expect(result).toEqual({ reachable: false, newestRecordAt: null });
  });
});
