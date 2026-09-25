/**
 * Normalization math for regional indicators (future.md §9). Pure; every function returns null
 * when an input is missing — a missing value is never turned into a zero.
 */

/** Count per `per` km² (default 10 000 km²); null without a count or a positive area. */
export function perArea(count: number | null | undefined, areaKm2: number | null | undefined, per = 10_000): number | null {
  if (count == null || !Number.isFinite(count) || !areaKm2 || areaKm2 <= 0) return null;
  return (count / areaKm2) * per;
}

export type DeviationResult =
  | { value: number; baselineMean: number; baselineYears: number[] }
  | { value: null; reason: string };

/**
 * Deviation of `year` from the mean of the `window` preceding years, in percent:
 * (x − mean) / mean × 100. Uses only years in `completeYears`; if the year itself or any of the
 * preceding years is not complete or has no value, the result is null with the reason.
 */
export function deviationFromMean(
  series: Record<number, number | null | undefined>,
  year: number,
  completeYears: number[],
  window = 5,
): DeviationResult {
  const complete = new Set(completeYears);
  const x = series[year];
  if (!complete.has(year) || x == null) return { value: null, reason: `нет полного года ${year} в архиве` };
  const baselineYears = Array.from({ length: window }, (_, i) => year - window + i);
  const missing = baselineYears.filter(y => !complete.has(y) || series[y] == null);
  if (missing.length) {
    return { value: null, reason: `нет полных лет для базы: ${missing.join(', ')}` };
  }
  const baselineMean = baselineYears.reduce((s, y) => s + (series[y] as number), 0) / window;
  if (baselineMean === 0) return { value: null, reason: `среднее за ${baselineYears[0]}–${baselineYears[window - 1]} равно нулю` };
  return { value: ((x - baselineMean) / baselineMean) * 100, baselineMean, baselineYears };
}

/** Loss (ha) per 100 000 ha of forest fund; forest fund given in thousand ha (Rosleshoz unit). */
export function lossPer100kHa(lossHa: number | null | undefined, forestFundThousandHa: number | null | undefined): number | null {
  if (lossHa == null || !Number.isFinite(lossHa) || !forestFundThousandHa || forestFundThousandHa <= 0) return null;
  return (lossHa / (forestFundThousandHa * 1000)) * 100_000;
}

/** Share in percent, clamped to [0, 100] (grid sampling can overshoot slightly). */
export function sharePercent(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || !Number.isFinite(part) || !whole || whole <= 0) return null;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/** Rounds to `digits` decimals, keeping null. */
export function round(value: number | null, digits = 1): number | null {
  if (value == null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
