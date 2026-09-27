/**
 * Numbers quoted on the methodology page. The frontend cannot import backend modules, so they are
 * copied here — tests/methodology.test.ts checks every one against the backend constants
 * (firmsHistory/, regions/, export/provenance.ts), so a change in the code fails CI until the text
 * follows.
 */
export const METHODOLOGY = {
  firms: {
    method: 'firms-cluster-v1',
    /** Regions where hotspots become incidents. */
    incidentRegions: ['RU-IRK', 'RU-BU', 'RU-ZAB'],
    incidentRegionNames: ['Иркутская область', 'Республика Бурятия', 'Забайкальский край'],
    clusterDistanceKm: 2,
    /** New points join an active incident within this distance of its bbox. */
    matchDistanceKm: 2,
    windowHours: 72,
    inactiveAfterHours: 48,
    pixelM: 375,
    pixelHa: 14.06,
    /** Window of the hotspot map layer (the public 24 h CSVs). */
    mapLayerHours: 24,
  },
  staticMask: {
    method: 'static-mask-v1',
    minDays: 4,
    windowDays: 14,
    minSpanDays: 7,
    radiusM: 500,
  },
  regions: {
    count: 83,
    densityPerKm2: 10000,
    deviationYears: 5,
    gfwEstimateRegions: 14,
    /** Years of the Rosleshozinforg regional loss shares behind the GFW estimate. */
    gfwShareYears: '2015–2022',
  },
  export: {
    limit: 5000,
  },
} as const;

/** Days of our own history the flare rule needs: first and last day ≥ minSpanDays apart. */
export const STATIC_HISTORY_DAYS = METHODOLOGY.staticMask.minSpanDays + 1;

/** «10 000» with a narrow no-break space, as in the rest of the UI. */
export function formatInt(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** «14,06» — Russian decimal comma. */
export function formatDecimal(n: number): string {
  return String(n).replace('.', ',');
}
