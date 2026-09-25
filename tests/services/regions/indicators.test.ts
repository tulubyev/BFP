import path from 'path';
import { ARCHIVE_MISSING_REASON, loadFirmsArchive } from '../../../backend/services/regions/firmsArchive';
import {
  buildHotspotSeries, buildIndicators, buildRegionDetail, formatDate, type AssemblyInputs, type Indicator,
} from '../../../backend/services/regions/indicators';
import { extractRegional, ROSLESHOZ_SPECS } from '../../../backend/services/regions/rosleshozRegional';

const archive = loadFirmsArchive([path.resolve(__dirname, '../../fixtures/regional')])!;
const irk = { iso: 'RU-IRK', name: 'Иркутская область', areaKm2: 775_000 };
const bu = { iso: 'RU-BU', name: 'Бурятия', areaKm2: 351_000 };
const zab = { iso: 'RU-ZAB', name: 'Забайкальский край', areaKm2: 432_000 };
const tom = { iso: 'RU-TOM', name: 'Томская область', areaKm2: 314_000 };

const published = new Date('2026-05-21T00:00:00Z');
const rows = [
  { region: 'Иркутская область', subjects: 'Иркутская область', area: '69420', total_materials: '71500', woodiness: '83,1', volume: '31000' },
  { region: 'Республика Бурятия', subjects: 'Республика Бурятия', area: '', total_materials: '27550', woodiness: '', volume: '4000' },
];

function inputs(overrides: Partial<AssemblyInputs> = {}): AssemblyInputs {
  return {
    forestland: { extraction: extractRegional(rows, ROSLESHOZ_SPECS.forestlandArea), published },
    forestFund: { extraction: extractRegional(rows, ROSLESHOZ_SPECS.forestFundTotal), published },
    woodiness: { extraction: extractRegional(rows, ROSLESHOZ_SPECS.woodiness), published },
    woodVolume: { extraction: extractRegional(rows, ROSLESHOZ_SPECS.woodVolume), published },
    archive,
    oopt: { areaKm2: { 'RU-IRK': 15_500, 'RU-BU': 0 }, fetchedAt: '2026-09-25T06:00:00Z' },
    nrt: { counts: { 'RU-IRK': 12, 'RU-BU': 0 }, since: '2026-09-25', lastDate: '2026-09-26' },
    gfw: { byIso: { 'RU-IRK': { year: 2023, areaHa: 8470, live: false, source: 'оценка' } }, hasApiKey: false },
    ...overrides,
  };
}

const byId = (list: Indicator[]) => Object.fromEntries(list.map(i => [i.id, i]));

describe('buildIndicators: shape', () => {
  it('gives every indicator value, unit, period, source, kind and definition', () => {
    for (const ind of buildIndicators(irk, inputs())) {
      expect(ind).toEqual(expect.objectContaining({
        id: expect.any(String), label: expect.any(String), unit: expect.any(String),
        source: expect.any(String), definition: expect.any(String),
      }));
      expect(['official', 'satellite', 'estimate']).toContain(ind.kind);
      expect(ind).toHaveProperty('value');
      expect(ind).toHaveProperty('period');
      if (ind.value === null) expect(ind.reason).toBeTruthy();
      else expect(ind.period).toBeTruthy();
    }
  });

  it('labels official, satellite and estimate indicators separately', () => {
    const ind = byId(buildIndicators(irk, inputs()));
    expect(ind.forestland_area.kind).toBe('official');
    expect(ind.wood_volume.kind).toBe('official');
    expect(ind.hotspots_vegetation.kind).toBe('satellite');
    expect(ind.hotspots_nrt_season.kind).toBe('satellite');
    expect(ind.oopt_share.kind).toBe('estimate');
    expect(ind.cover_loss.kind).toBe('estimate');
    expect(ind.loss_per_100k_ha.kind).toBe('estimate');
  });
});

describe('buildIndicators: values', () => {
  const ind = byId(buildIndicators(irk, inputs()));

  it('uses official Rosleshoz values with the dataset publication date as period', () => {
    expect(ind.forestland_area).toMatchObject({ value: 69420, unit: 'тыс. га', period: 'набор от 21.05.2026' });
    expect(ind.woodiness.value).toBeCloseTo(83.1);
  });

  it('computes archive indicators for the latest complete year', () => {
    expect(ind.hotspots_vegetation).toMatchObject({ value: 1500, period: '2024' });
    expect(ind.hotspots_per_10k_km2).toMatchObject({ value: 19.35, period: '2024' });
    expect(ind.hotspots_deviation_5y).toMatchObject({ value: -50, period: '2024 к среднему 2019–2023' });
  });

  it('labels the NRT count with its own period, apart from the archive', () => {
    expect(ind.hotspots_nrt_season).toMatchObject({ value: 12, period: 'с 25.09.2026 по 26.09.2026' });
    expect(ind.hotspots_nrt_season.definition).toMatch(/Не сравнивать с годовым архивом/);
  });

  it('computes the OOPT share as approximate', () => {
    expect(ind.oopt_share).toMatchObject({ value: 2, approximate: true, period: 'на 25.09.2026' });
  });

  it('computes losses per 100 000 ha of forest fund as an estimate', () => {
    expect(ind.cover_loss).toMatchObject({ value: 8470, period: '2023', approximate: true });
    expect(ind.loss_per_100k_ha).toMatchObject({ value: 11.8, kind: 'estimate' });
  });

  it('marks live GFW loss as satellite, but the per-100k ratio stays an estimate', () => {
    const live = byId(buildIndicators(irk, inputs({
      gfw: { byIso: { 'RU-IRK': { year: 2024, areaHa: 9000, live: true, source: 'GFW Data API' } }, hasApiKey: true },
    })));
    expect(live.cover_loss).toMatchObject({ kind: 'satellite', value: 9000, period: '2024' });
    expect(live.loss_per_100k_ha.kind).toBe('estimate');
  });
});

describe('buildIndicators: nulls instead of zeros', () => {
  it('without the archive every archive indicator is null with «архив FIRMS ещё не собран»', () => {
    const ind = byId(buildIndicators(irk, inputs({ archive: null })));
    for (const id of ['hotspots_vegetation', 'hotspots_per_10k_km2', 'hotspots_deviation_5y']) {
      expect(ind[id].value).toBeNull();
      expect(ind[id].reason).toBe(ARCHIVE_MISSING_REASON);
    }
  });

  it('keeps an empty Rosleshoz cell null, and a region missing from the dataset null', () => {
    const b = byId(buildIndicators(bu, inputs()));
    expect(b.forestland_area).toMatchObject({ value: null, reason: expect.stringContaining('нет значения') });
    const t = byId(buildIndicators(tom, inputs()));
    expect(t.forest_fund_area).toMatchObject({ value: null, reason: expect.stringContaining('нет в наборе') });
  });

  it('makes every Rosleshoz indicator null with a reason when the source is down', () => {
    const down = { extraction: null, published: null, error: 'источник недоступен' };
    const ind = byId(buildIndicators(irk, inputs({ forestland: down, forestFund: down, woodiness: down, woodVolume: down })));
    for (const id of ['forestland_area', 'forest_fund_area', 'woodiness', 'wood_volume']) {
      expect(ind[id].value).toBeNull();
      expect(ind[id].reason).toMatch(/недоступен/);
    }
    // No forest fund → no per-100k ratio, even though a loss estimate exists
    expect(ind.loss_per_100k_ha.value).toBeNull();
  });

  it('is null (not 0) for NRT and OOPT when their sources fail', () => {
    const ind = byId(buildIndicators(irk, inputs({
      nrt: { counts: null, since: '2026-09-25', lastDate: null, error: 'база данных недоступна' },
      oopt: { areaKm2: null, fetchedAt: null, error: 'источник недоступен' },
    })));
    expect(ind.hotspots_nrt_season.value).toBeNull();
    expect(ind.oopt_share.value).toBeNull();
  });

  it('keeps a real zero when the source answered (no hotspots in the archive year, no OOPT)', () => {
    const ind = byId(buildIndicators(bu, inputs()));
    expect(ind.hotspots_vegetation.value).toBe(0);
    expect(ind.oopt_share.value).toBe(0);
    expect(ind.hotspots_nrt_season.value).toBe(0);
  });

  it('gives a null deviation when a baseline year is missing (Buryatia has no 2019)', () => {
    expect(byId(buildIndicators(bu, inputs())).hotspots_deviation_5y).toMatchObject({ value: null, reason: expect.stringContaining('2019') });
  });

  it('gives a null deviation when the 5-year mean is zero', () => {
    expect(byId(buildIndicators(zab, inputs())).hotspots_deviation_5y.value).toBeNull();
  });

  it('has no loss estimate for regions without a Roslesinforg share', () => {
    const ind = byId(buildIndicators(tom, inputs()));
    expect(ind.cover_loss).toMatchObject({ value: null, reason: expect.stringContaining('GFW_API_KEY') });
    expect(ind.loss_per_100k_ha.value).toBeNull();
  });

  it('is null for a region absent from the archive', () => {
    expect(byId(buildIndicators(tom, inputs())).hotspots_vegetation).toMatchObject({ value: null, reason: 'субъекта нет в архиве FIRMS' });
  });
});

describe('buildHotspotSeries / buildRegionDetail', () => {
  it('returns vegetation and static counts separately per complete year', () => {
    const { series, reason } = buildHotspotSeries(irk, archive);
    expect(reason).toBeNull();
    expect(series.map(s => s.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024]);
    expect(series[5]).toMatchObject({ year: 2024, vegetation: 1500, static: 75, vegetationPer10k: 19.35 });
  });

  it('skips years a region lacks instead of inventing zeros', () => {
    expect(buildHotspotSeries(bu, archive).series.map(s => s.year)).toEqual([2020, 2021, 2022, 2023, 2024]);
  });

  it('is empty with the reason while the archive is missing', () => {
    expect(buildHotspotSeries(irk, null)).toEqual({ series: [], reason: ARCHIVE_MISSING_REASON });
  });

  it('says «нет региональных данных» for reforestation', () => {
    const detail = buildRegionDetail(irk, true, inputs());
    expect(detail.baikal).toBe(true);
    expect(detail.extraIndicators[0]).toMatchObject({ id: 'reforestation', value: null, reason: 'нет региональных данных' });
  });
});

describe('formatDate', () => {
  it('formats DD.MM.YYYY in UTC', () => {
    expect(formatDate('2026-09-25T23:30:00Z')).toBe('25.09.2026');
  });
});
