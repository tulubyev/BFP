import { createQualityLog, PERSIST_EVERY_MS, shouldPersist, summarizeForJournal, type QualityHashClient } from '../../../backend/services/quality/log';
import { excerpt, failed, looksLikeMarkup, passed, QualityError } from '../../../backend/services/quality/result';

class FakeHash implements QualityHashClient {
  store = new Map<string, Map<string, string>>();
  writes = 0;
  async hset(key: string, field: string, value: string) {
    this.writes++;
    const h = this.store.get(key) ?? new Map<string, string>();
    h.set(field, value);
    this.store.set(key, h);
    return 1;
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.store.get(key) ?? []);
  }
  async expire() {
    return 1;
  }
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

describe('quality results', () => {
  it('QualityError carries the result and a readable message', () => {
    const err = new QualityError(failed('oopt', 'overpass', 'only 3 protected areas'));
    expect(err.message).toBe('oopt/overpass: only 3 protected areas');
    expect(err.result.ok).toBe(false);
  });

  it('failed() trims long reasons; passed() omits an empty reason', () => {
    expect(failed('a', 'b', 'x'.repeat(1000)).reason).toHaveLength(300);
    expect(passed('a', 'b', 5)).not.toHaveProperty('reason');
  });

  it('excerpt and looksLikeMarkup describe unexpected bodies', () => {
    expect(excerpt('<html>\n  <body>Error</body></html>', 20)).toBe('"<html> <body>Error</"');
    expect(excerpt({ a: 1 })).toBe('"{\\"a\\":1}"');
    expect(looksLikeMarkup('  <!DOCTYPE html>')).toBe(true);
    expect(looksLikeMarkup('region,volume')).toBe(false);
  });
});

describe('shouldPersist', () => {
  it('writes first results, flips and stale entries only', () => {
    expect(shouldPersist(undefined, true, 0)).toBe(true);
    expect(shouldPersist({ ok: true, at: 0 }, true, 1000)).toBe(false);
    expect(shouldPersist({ ok: true, at: 0 }, false, 1000)).toBe(true);
    expect(shouldPersist({ ok: true, at: 0 }, true, PERSIST_EVERY_MS)).toBe(true);
  });
});

describe('summarizeForJournal', () => {
  it('adds up dropped items and lists rejection reasons', () => {
    expect(summarizeForJournal([
      passed('rosleshoz', 'woodVolume', 98, 2),
      failed('rosleshoz', 'forestFund', 'header lacks column(s) woodiness', 98),
      passed('rosleshoz', 'forestlandArea', 98),
    ])).toEqual({ rejected: 2, failures: ['forestFund: header lacks column(s) woodiness'] });
    expect(summarizeForJournal([])).toEqual({ rejected: 0, failures: [] });
  });
});

describe('createQualityLog', () => {
  it('keeps the latest result, the last rejection and counters per check', async () => {
    const log = createQualityLog(() => null, new Date('2026-09-29T00:00:00Z'));
    await log.report(failed('gfw_loss', 'tile', 'text/html'));
    await log.report(passed('gfw_loss', 'tile', 1));
    const [state] = await log.read('gfw_loss');
    expect(state).toMatchObject({ check: 'tile', checks: 2, rejections: 1, since: '2026-09-29T00:00:00.000Z' });
    expect(state.last.ok).toBe(true);
    expect(state.lastRejection?.reason).toBe('text/html');
    expect(await log.read('oopt')).toEqual([]);
  });

  it('drain returns the latest result per check once', async () => {
    const log = createQualityLog(() => null);
    await log.report(failed('rosleshoz', 'woodVolume', 'html'));
    await log.report(passed('rosleshoz', 'woodVolume', 98));
    await log.report(passed('rosleshoz', 'forestFund', 98, 1));
    await log.report(passed('oopt', 'overpass', 130));
    expect(log.drain('rosleshoz').map(r => [r.check, r.ok])).toEqual([['woodVolume', true], ['forestFund', true]]);
    expect(log.drain('rosleshoz')).toEqual([]);
    expect(log.drain('oopt')).toHaveLength(1);
  });

  it('persists to Redis throttled, and reads it back after a restart', async () => {
    const redis = new FakeHash();
    const log = createQualityLog(() => redis);
    await log.report(passed('gfw_dist', 'tile', 1), 0);
    await log.report(passed('gfw_dist', 'tile', 1), 1000);
    await log.report(passed('gfw_dist', 'tile', 1), 2000);
    expect(redis.writes).toBe(1);
    await log.report(failed('gfw_dist', 'tile', 'empty body'), 3000);
    expect(redis.writes).toBe(2);

    const restarted = createQualityLog(() => redis);
    const [state] = await restarted.read('gfw_dist');
    expect(state).toMatchObject({ check: 'tile', checks: null, since: null });
    expect(state.last.reason).toBe('empty body');
    expect(state.lastRejection?.reason).toBe('empty body');

    // A new ok result in the restarted process keeps the stored last rejection visible
    await restarted.report(passed('gfw_dist', 'tile', 1), 0);
    const [after] = await restarted.read('gfw_dist');
    expect(after.last.ok).toBe(true);
    expect(after.lastRejection?.reason).toBe('empty body');
  });

  it('a failing Redis never throws', async () => {
    const broken: QualityHashClient = {
      hset: () => Promise.reject(new Error('down')),
      hgetall: () => Promise.reject(new Error('down')),
      expire: () => Promise.reject(new Error('down')),
    };
    const log = createQualityLog(() => broken);
    await expect(log.report(passed('oopt', 'overpass', 1))).resolves.toBeUndefined();
    expect((await log.read('oopt'))[0].check).toBe('overpass');
  });
});
