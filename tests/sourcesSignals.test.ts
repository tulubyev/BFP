import { freshnessText, type MethodologySource } from '../frontend/src/methodology/sources';
import {
  accessLabel, detailText, formatFreshnessLabel, monitoredSources, sourceRowLabel, stateReason, stateText,
  type SourceAccess, type SourceStatusEntry,
} from '../frontend/src/map/sourcesStatus';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const entry = (o: Partial<SourceStatusEntry> = {}): SourceStatusEntry => ({ id: 'x', name: 'X', state: 'unknown', freshness: null, ...o });
const access = (o: Partial<SourceAccess> = {}): SourceAccess => ({
  state: 'fresh', lastSuccessAt: '2026-09-29T11:55:00Z', lastFailureAt: null, failingSince: null, lastSuccessAgeMs: 5 * MIN, ...o,
});

describe('stateReason', () => {
  it('blames access when an access signal is the worst one', () => {
    expect(stateReason(entry({ state: 'failed', signals: [{ kind: 'data', state: 'fresh' }, { kind: 'access', state: 'failed' }] }))).toBe('access');
  });
  it('blames data when the data signal is the worst one', () => {
    expect(stateReason(entry({ state: 'stale', signals: [{ kind: 'data', state: 'stale' }, { kind: 'access', state: 'fresh' }] }))).toBe('data');
  });
  it('is null for fresh/unknown and for responses without signals', () => {
    expect(stateReason(entry({ state: 'fresh', signals: [{ kind: 'data', state: 'fresh' }] }))).toBeNull();
    expect(stateReason(entry({ state: 'unknown', signals: [] }))).toBeNull();
    expect(stateReason(entry({ state: 'failed' }))).toBeNull();
  });
});

describe('stateText: stale data vs. a source we cannot reach', () => {
  it('distinguishes the two', () => {
    expect(stateText(entry({ state: 'stale', signals: [{ kind: 'data', state: 'stale' }] }))).toBe('данные устарели');
    expect(stateText(entry({ state: 'failed', signals: [{ kind: 'data', state: 'failed' }] }))).toBe('данные давно не обновлялись');
    expect(stateText(entry({ state: 'stale', signals: [{ kind: 'access', state: 'stale' }] }))).toBe('сбои при обращении к источнику');
    expect(stateText(entry({ state: 'failed', signals: [{ kind: 'access', state: 'failed' }] }))).toBe('источник недоступен для нас');
  });
  it('fresh: data sources are «актуальны», access-only sources «доступен»', () => {
    expect(stateText(entry({ state: 'fresh', signals: [{ kind: 'data', state: 'fresh' }] }))).toBe('данные актуальны');
    expect(stateText(entry({ state: 'fresh', signals: [{ kind: 'access', state: 'fresh' }] }))).toBe('источник доступен');
  });
  it('unknown: «обращений пока не было» for on-demand sources, not a failure', () => {
    expect(stateText(entry({ signals: [{ kind: 'access', state: 'unknown' }] }))).toBe('обращений к источнику пока не было');
    expect(stateText(entry({ signals: [] }))).toBe('свежесть не отслеживается');
  });
  it('falls back to the old wording without signals', () => {
    expect(stateText(entry({ state: 'failed' }))).toBe('источник недоступен');
  });
});

describe('labels', () => {
  it('a month version replaces the misleading age in days', () => {
    const boundaries = entry({ state: 'fresh', version: '2026-09', freshness: { timestamp: '2026-09-01T00:00:00Z', ageMs: 28 * DAY } });
    expect(formatFreshnessLabel(boundaries)).toBe('версия 2026-09');
  });
  it('other versions follow the age', () => {
    expect(formatFreshnessLabel(entry({ version: 'v20260925', freshness: { timestamp: '2026-09-25T00:00:00Z', ageMs: 4 * DAY } }))).toBe('4 дн назад, версия v20260925');
  });
  it('accessLabel', () => {
    expect(accessLabel(access())).toBe('последний успешный запрос 5 мин назад');
    expect(accessLabel(access({ lastSuccessAt: null, lastSuccessAgeMs: null }))).toBe('успешных запросов не было');
  });
  it('detailText for an access-only source shows the last success and the version', () => {
    expect(detailText(entry({ state: 'fresh', access: access(), version: 'v1.13' }))).toBe('последний успешный запрос 5 мин назад, версия v1.13');
  });
  it('detailText hides access details behind a data date unless access is the problem', () => {
    const dist = {
      freshness: { timestamp: '2026-09-25T00:00:00Z', ageMs: 4 * DAY },
      version: 'v20260925',
      access: access({ state: 'failed', lastSuccessAgeMs: 5 * DAY }),
    };
    expect(detailText(entry({ ...dist, state: 'fresh', signals: [{ kind: 'data', state: 'fresh' }, { kind: 'access', state: 'fresh' }] })))
      .toBe('4 дн назад, версия v20260925');
    expect(detailText(entry({ ...dist, state: 'failed', signals: [{ kind: 'data', state: 'fresh' }, { kind: 'access', state: 'failed' }] })))
      .toBe('4 дн назад, версия v20260925, последний успешный запрос 5 дн назад');
  });
  it('detailText is null without anything to say', () => {
    expect(detailText(entry())).toBeNull();
  });
});

describe('sourceRowLabel (map control)', () => {
  it('fresh rows show only the details', () => {
    expect(sourceRowLabel(entry({ state: 'fresh', signals: [{ kind: 'access', state: 'fresh' }], access: access() })))
      .toBe('последний успешный запрос 5 мин назад');
  });
  it('an unreachable source says so in front of the details', () => {
    const e = entry({ state: 'failed', signals: [{ kind: 'access', state: 'failed' }], access: access({ state: 'failed', lastSuccessAt: null, lastSuccessAgeMs: null }) });
    expect(sourceRowLabel(e)).toBe('источник недоступен для нас, успешных запросов не было');
  });
  it('stale data says so', () => {
    const e = entry({ state: 'stale', signals: [{ kind: 'data', state: 'stale' }], freshness: { timestamp: '2026-09-29T00:00:00Z', ageMs: 6 * 60 * MIN } });
    expect(sourceRowLabel(e)).toBe('данные устарели, 6 ч назад');
  });
  it('a row without details is just the state', () => {
    expect(sourceRowLabel(entry({ state: 'failed', signals: [{ kind: 'access', state: 'failed' }] }))).toBe('источник недоступен для нас');
  });
  it('never-requested on-demand sources stay out of the control', () => {
    expect(monitoredSources([entry({ signals: [{ kind: 'access', state: 'unknown' }], access: null, version: 'v1.13' })])).toEqual([]);
  });
});

describe('methodology freshnessText with signals', () => {
  const base: MethodologySource = {
    id: 'gfw_loss', name: 'GFW', owner: 'UMD', license: { name: 'CC BY 4.0', url: 'https://example.org' }, homepage: 'https://example.org',
    updateFrequency: '', spatialResolution: '', coverage: '', limitations: [], cadence: null, state: 'unknown', freshness: null,
  };
  it('unreachable', () => {
    expect(freshnessText({ ...base, state: 'failed', signals: [{ kind: 'access', state: 'failed' }], access: access({ state: 'failed', lastSuccessAgeMs: 4 * DAY }), version: 'v1.13' }))
      .toBe('источник недоступен для нас, последний успешный запрос 4 дн назад, версия v1.13');
  });
  it('never requested', () => {
    expect(freshnessText({ ...base, signals: [{ kind: 'access', state: 'unknown' }], access: null, version: 'v1.13' }))
      .toBe('обращений к источнику пока не было, версия v1.13');
  });
  it('boundaries', () => {
    expect(freshnessText({ ...base, state: 'fresh', signals: [{ kind: 'data', state: 'fresh' }], version: '2026-09', freshness: { timestamp: '2026-09-01T00:00:00Z', ageMs: 28 * DAY } }))
      .toBe('данные актуальны, версия 2026-09');
  });
});
