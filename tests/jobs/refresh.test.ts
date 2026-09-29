import { qualityFields, refreshFirmsWithHistory, startRefreshJobs } from '../../backend/jobs/refresh';
import * as journal from '../../backend/utils/journal';
import { reportQuality } from '../../backend/services/quality/log';
import { failed, passed } from '../../backend/services/quality/result';

describe('startRefreshJobs', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs each job after its first delay and then on its interval', async () => {
    const run = jest.fn().mockResolvedValue(true);
    const stop = startRefreshJobs([{ name: 'a', firstDelayMs: 1000, everyMs: 5000, run }]);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await jest.advanceTimersByTimeAsync(20000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('keeps scheduling after a job throws', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
    const stop = startRefreshJobs([{ name: 'b', firstDelayMs: 0, everyMs: 1000, run }]);
    await jest.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does not start a run while the previous one is still going', async () => {
    let finish!: () => void;
    const run = jest.fn(() => new Promise<boolean>(resolve => { finish = () => resolve(true); }));
    const stop = startRefreshJobs([{ name: 'c', firstDelayMs: 0, everyMs: 1000, run }]);
    await jest.advanceTimersByTimeAsync(3500);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('refreshFirmsWithHistory', () => {
  it('runs the history job only after a successful FIRMS refresh', async () => {
    const history = jest.fn().mockResolvedValue(undefined);
    await expect(refreshFirmsWithHistory(async () => true, history)).resolves.toBe(true);
    expect(history).toHaveBeenCalledTimes(1);
    await expect(refreshFirmsWithHistory(async () => false, history)).resolves.toBe(false);
    expect(history).toHaveBeenCalledTimes(1);
  });

  it('keeps the FIRMS refresh result when the history job throws', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(refreshFirmsWithHistory(async () => true, async () => { throw new Error('db down'); })).resolves.toBe(true);
    warn.mockRestore();
  });
});

describe('quality results in the load journal', () => {
  it('qualityFields: dropped items become `rejected`, a rejected input makes the run failed with the reason', () => {
    const drain = () => [passed('rosleshoz', 'woodVolume', 98, 2), failed('rosleshoz', 'forestFund', 'header lacks column(s) woodiness')];
    expect(qualityFields('rosleshoz', 'kept-cached', drain)).toEqual({
      outcome: 'failed', rejected: 2, error: 'quality check: forestFund: header lacks column(s) woodiness',
    });
    expect(qualityFields('rosleshoz', 'updated', () => [passed('rosleshoz', 'woodVolume', 98)])).toEqual({ outcome: 'updated' });
    expect(qualityFields(undefined, 'updated', () => { throw new Error('not called'); })).toEqual({ outcome: 'updated' });
  });

  it('startRefreshJobs records the gate results reported during the run', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const record = jest.spyOn(journal, 'recordRun').mockResolvedValue(undefined);
    try {
      const run = jest.fn(async () => {
        reportQuality(failed('oopt', 'overpass', 'only 12 protected areas (< 20) — truncated answer?', 12, 3));
        return false;
      });
      const stop = startRefreshJobs([{ name: 'oopt', firstDelayMs: 0, everyMs: 60000, run, qualitySource: 'oopt' }]);
      await jest.advanceTimersByTimeAsync(10);
      stop();
      expect(record).toHaveBeenCalledWith('oopt', expect.objectContaining({
        outcome: 'failed', rejected: 3, error: 'quality check: overpass: only 12 protected areas (< 20) — truncated answer?',
      }));
    } finally {
      record.mockRestore();
      warn.mockRestore();
      log.mockRestore();
      jest.useRealTimers();
    }
  });
});
