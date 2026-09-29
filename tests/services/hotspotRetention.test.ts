import fs from 'fs';
import path from 'path';
import {
  HOTSPOT_RETENTION_DAYS, PURGE_SQL, purgeOldHotspots, retentionCutoff, RetentionMigrationMissingError,
} from '../../backend/services/hotspotRetention';
import { createHotspotRetentionJob } from '../../backend/jobs/refresh';
import { nrtSince } from '../../backend/services/regions/nrtHotspots';
import { retentionNote } from '../../frontend/src/utils/incidentHotspots';

describe('retention window', () => {
  it('is 30 days and the migration deletes exactly that many', () => {
    expect(HOTSPOT_RETENTION_DAYS).toBe(30);
    const sql = fs.readFileSync(path.join(__dirname, '../../database/migrations/012_hotspot_retention.sql'), 'utf8');
    expect(sql).toContain(`acquisition_date < CURRENT_DATE - ${HOTSPOT_RETENTION_DAYS}`);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION gis\.purge_old_hotspots\(\) FROM PUBLIC/);
  });

  it('cutoff is the oldest kept UTC day', () => {
    expect(retentionCutoff(new Date('2026-10-27T12:00:00Z'))).toBe('2026-09-27');
    expect(retentionCutoff(new Date('2026-03-01T00:00:00Z'))).toBe('2026-01-30');
  });

  it('the NRT window starts at the later of history start and cutoff', () => {
    expect(nrtSince(new Date('2026-09-29T00:00:00Z'))).toBe('2026-09-25');
    expect(nrtSince(new Date('2026-10-25T00:00:00Z'))).toBe('2026-09-25');
    expect(nrtSince(new Date('2026-10-26T00:00:00Z'))).toBe('2026-09-26');
  });
});

describe('purgeOldHotspots', () => {
  it('calls the function and returns the deleted count', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ deleted: 4200 }] });
    expect(await purgeOldHotspots({ query })).toBe(4200);
    expect(query).toHaveBeenCalledWith(PURGE_SQL);
  });

  it('reports a missing migration clearly (SQLSTATE 42883)', async () => {
    const query = jest.fn().mockRejectedValue(Object.assign(new Error('function does not exist'), { code: '42883' }));
    await expect(purgeOldHotspots({ query })).rejects.toThrow(RetentionMigrationMissingError);
    await expect(purgeOldHotspots({ query })).rejects.toThrow(/migration 012 not applied/);
  });

  it('propagates other errors unchanged', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connection lost'));
    await expect(purgeOldHotspots({ query })).rejects.toThrow('connection lost');
  });
});

describe('retention job', () => {
  it('runs daily, reports the deleted count as journal items', async () => {
    const job = createHotspotRetentionJob(async () => 17);
    expect(job.name).toBe('hotspot_retention');
    expect(job.everyMs).toBe(24 * 60 * 60 * 1000);
    expect(await job.run()).toBe(true);
    expect(await job.count?.()).toBe(17);
  });

  it('a failing purge rejects, so the journal records a failed run', async () => {
    const job = createHotspotRetentionJob(async () => { throw new RetentionMigrationMissingError(); });
    await expect(job.run()).rejects.toThrow(/migration 012/);
  });
});

describe('retentionNote (incident card)', () => {
  it('says nothing for an incident inside the window', () => {
    expect(retentionNote('2026-09-25', '2026-09-20', 5)).toBeNull();
    expect(retentionNote('2026-09-20', '2026-09-20', 5)).toBeNull();
  });

  it('explains an empty map for an incident older than the window', () => {
    expect(retentionNote('2026-08-01', '2026-09-01', 0)).toMatch(/удалены из базы/);
  });

  it('warns that only part survived when the window straddles the cutoff', () => {
    expect(retentionNote('2026-08-30', '2026-09-01', 3)).toMatch(/Часть термоточек/);
  });

  it('ignores missing or malformed input', () => {
    expect(retentionNote('2026-08-01', undefined, 0)).toBeNull();
    expect(retentionNote('bad', '2026-09-01', 0)).toBeNull();
  });
});
