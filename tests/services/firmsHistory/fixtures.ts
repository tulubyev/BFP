import type { FIRMSHotspot } from '../../../backend/services/firmsService';
import type { ClusterPoint } from '../../../backend/services/firmsHistory/clusters';

export function hotspot(over: Partial<FIRMSHotspot> = {}): FIRMSHotspot {
  return {
    latitude: 52.3, longitude: 104.3, brightness: 330.1, bright_t31: 290.2, frp: 12.5, scan: 0.4, track: 0.37,
    acq_date: '2026-09-24', acq_time: '0512', satellite: 'N20', confidence: 'n', version: '2.0NRT', daynight: 'D',
    ...over,
  };
}

/** ~1.11 km per 0.01° of latitude. */
export function point(id: number, lat: number, lon: number, over: Partial<ClusterPoint> = {}): ClusterPoint {
  return {
    id, lat, lon, satellite: 'N', acquiredAt: '2026-09-24T05:00:00.000Z', confidence: 'nominal', frp: 10,
    regionIso: 'RU-IRK', regionName: 'Иркутская область', ...over,
  };
}

/** Consecutive UTC dates, oldest first: days('2026-09-20', 3) → 20, 21, 22 September. */
export function days(start: string, count: number, step = 1): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(start) + i * step * 86_400_000).toISOString().slice(0, 10));
}

/** Small deterministic geolocation jitter (≤ ~150 m) so repeat detections are not identical. */
const jitter = (i: number, scale: number) => ((i * 7919) % 11 - 5) * scale;

/**
 * A gas flare in northern Irkutsk oblast (oil/gas fields): the same spot on every given day,
 * seen on a day pass and a night pass, by different satellites, with a little jitter.
 */
export const FLARE = { lat: 60.7201, lon: 108.0503 };
export function flareHotspots(dates: string[], at = FLARE): FIRMSHotspot[] {
  return dates.flatMap((d, i) => [
    hotspot({ latitude: at.lat + jitter(i, 0.0002), longitude: at.lon + jitter(i + 3, 0.0003), acq_date: d, acq_time: '0540', satellite: 'N', frp: 8 }),
    hotspot({ latitude: at.lat + jitter(i + 5, 0.0002), longitude: at.lon + jitter(i + 1, 0.0003), acq_date: d, acq_time: '1825', satellite: 'N20', frp: 6 }),
  ]);
}

/**
 * A forest fire whose front moves ~1.4 km north-east each day; three pixels per day, the
 * leading pixel of one day still burning the next, so each spot is seen on two days.
 */
export const MOVING_FIRE = { lat: 58.3, lon: 107.2 };
export function movingFireHotspots(dates: string[], at = MOVING_FIRE): FIRMSHotspot[] {
  return dates.flatMap((d, i) => [0, 1, 2].map(k => hotspot({
    latitude: at.lat + (2 * i + k) * 0.004, longitude: at.lon + (2 * i + k) * 0.006,
    acq_date: d, acq_time: k === 2 ? '1830' : '0535', satellite: k === 1 ? 'N21' : 'N', frp: 30 + k,
  })));
}

/** A fire that flares up once and is out the next day. */
export const ONE_DAY_FIRE = { lat: 57.9, lon: 106.4 };
export function oneDayFireHotspots(date: string, at = ONE_DAY_FIRE): FIRMSHotspot[] {
  return [
    hotspot({ latitude: at.lat, longitude: at.lon, acq_date: date, acq_time: '0540', satellite: 'N', frp: 20 }),
    hotspot({ latitude: at.lat + 0.004, longitude: at.lon + 0.003, acq_date: date, acq_time: '0541', satellite: 'N', frp: 15 }),
  ];
}

/** Hotspots → the rows the heat-cell aggregation reads. */
export const asHistory = (list: FIRMSHotspot[]) =>
  list.map(h => ({ lat: h.latitude, lon: h.longitude, acqDate: h.acq_date }));
