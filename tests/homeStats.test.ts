import type { Incident } from '../frontend/src/api/incidents';
import {
  countActiveFirmsIncidents, errorStat, findSourceStatus, formatStatNumber, loadingStat, readyStat,
} from '../frontend/src/utils/homeStats';
import type { SourceStatusEntry } from '../frontend/src/map/sourcesStatus';

const baseIncident: Incident = { id: 1, forest_area_id: null, change_type: 'fire', detected_date: '2026-09-24' };
const firms = (status: 'active' | 'inactive'): Incident => ({
  ...baseIncident,
  metadata: { method: 'firms-cluster-v1', status },
});

describe('countActiveFirmsIncidents', () => {
  it('counts only active FIRMS clusters', () => {
    const incidents = [firms('active'), firms('inactive'), firms('active')];
    expect(countActiveFirmsIncidents(incidents)).toBe(2);
  });

  it('ignores incidents without the FIRMS clustering method (seed/manual rows)', () => {
    const incidents = [firms('active'), { ...baseIncident, metadata: { region: 'Бурятия' } }, baseIncident];
    expect(countActiveFirmsIncidents(incidents)).toBe(1);
  });

  it('returns 0 for an empty list, not a falsy display bug', () => {
    expect(countActiveFirmsIncidents([])).toBe(0);
  });
});

describe('formatStatNumber', () => {
  it('shows an ellipsis while loading', () => {
    expect(formatStatNumber(loadingStat)).toBe('…');
  });

  it('shows «нет данных» on a failed request instead of a zero', () => {
    expect(formatStatNumber(errorStat)).toBe('нет данных');
  });

  it('localizes a ready value', () => {
    expect(formatStatNumber(readyStat(12345))).toBe('12 345');
  });

  it('shows 0 as an explicit number, not «нет данных», when the request actually succeeded', () => {
    expect(formatStatNumber(readyStat(0))).toBe('0');
  });
});

describe('findSourceStatus', () => {
  const entry = (id: string): SourceStatusEntry => ({ id, name: id, state: 'fresh', freshness: null });

  it('finds the entry by id', () => {
    const sources = [entry('oopt'), entry('firms'), entry('rosleshoz')];
    expect(findSourceStatus(sources, 'firms')?.id).toBe('firms');
  });

  it('returns null when the id is missing', () => {
    expect(findSourceStatus([entry('oopt')], 'firms')).toBeNull();
  });
});
