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
