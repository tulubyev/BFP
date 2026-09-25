import { refreshFirmsWithHistory, startRefreshJobs } from '../../backend/jobs/refresh';

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
