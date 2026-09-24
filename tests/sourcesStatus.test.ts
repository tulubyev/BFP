import { formatRelativeAge, monitoredSources, type SourceStatusEntry } from '../frontend/src/map/sourcesStatus';

describe('formatRelativeAge', () => {
  it('reports under a minute as "меньше минуты назад"', () => {
    expect(formatRelativeAge(0)).toBe('меньше минуты назад');
    expect(formatRelativeAge(59_000)).toBe('меньше минуты назад');
  });

  it('reports minutes for under an hour', () => {
    expect(formatRelativeAge(5 * 60_000)).toBe('5 мин назад');
    expect(formatRelativeAge(59 * 60_000)).toBe('59 мин назад');
  });

  it('reports hours for under a day', () => {
    expect(formatRelativeAge(60 * 60_000)).toBe('1 ч назад');
    expect(formatRelativeAge(23 * 60 * 60_000)).toBe('23 ч назад');
  });

  it('reports days beyond a day', () => {
    expect(formatRelativeAge(24 * 60 * 60_000)).toBe('1 дн назад');
    expect(formatRelativeAge(3 * 24 * 60 * 60_000)).toBe('3 дн назад');
  });
});

function source(overrides: Partial<SourceStatusEntry> = {}): SourceStatusEntry {
  return { id: 'x', name: 'X', state: 'unknown', freshness: null, ...overrides };
}

describe('monitoredSources', () => {
  it('keeps sources with a freshness timestamp', () => {
    const withFreshness = source({ freshness: { timestamp: '2026-09-24T00:00:00Z', ageMs: 1000 } });
    expect(monitoredSources([withFreshness])).toEqual([withFreshness]);
  });

  it('keeps sources with a non-unknown state even without a timestamp', () => {
    const failed = source({ state: 'failed' });
    expect(monitoredSources([failed])).toEqual([failed]);
  });

  it('drops purely static sources (unknown state, no freshness)', () => {
    expect(monitoredSources([source()])).toEqual([]);
  });
});
